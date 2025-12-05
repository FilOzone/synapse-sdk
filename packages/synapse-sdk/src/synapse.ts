/**
 * Main Synapse class for interacting with Filecoin storage and other on-chain services
 */

import { ethers } from 'ethers'
import { FilBeamService } from './filbeam/index.ts'
import { PaymentsService } from './payments/index.ts'
import { ChainRetriever, FilBeamRetriever, SubgraphRetriever } from './retriever/index.ts'
import { SessionKey } from './session/key.ts'
import { SPRegistryService } from './sp-registry/index.ts'
import type { StorageService } from './storage/index.ts'
import { StorageManager } from './storage/manager.ts'
import { SubgraphService } from './subgraph/service.ts'
import type { TelemetryService } from './telemetry/service.ts'
import { getGlobalTelemetry, initGlobalTelemetry } from './telemetry/singleton.ts'
import type {
  FilecoinNetworkType,
  PieceCID,
  PieceRetriever,
  ProviderInfo,
  StorageInfo,
  StorageServiceOptions,
  SubgraphConfig,
  SynapseOptions,
} from './types.ts'
import { CHAIN_IDS, CONTRACT_ADDRESSES, getFilecoinNetworkType } from './utils/index.ts'
import { WarmStorageService } from './warm-storage/index.ts'

export class Synapse {
  private readonly _signer: ethers.Signer
  private readonly _network: FilecoinNetworkType
  private readonly _withCDN: boolean
  private readonly _payments: PaymentsService
  private readonly _provider: ethers.Provider
  private readonly _warmStorageAddress: string
  private readonly _warmStorageService: WarmStorageService
  private readonly _pieceRetriever: PieceRetriever
  private readonly _storageManager: StorageManager
  private readonly _filbeamService: FilBeamService
  private _session: SessionKey | null = null

  /**
   * Create a new Synapse instance with async initialization.
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static async create(options: SynapseOptions): Promise<Synapse> {
    // Validate options
    const providedOptions = [options.privateKey, options.provider, options.signer].filter(Boolean).length
    if (providedOptions !== 1) {
      throw new Error('Must provide exactly one of: privateKey, provider, or signer')
    }

    // Detect network from chain
    let network: FilecoinNetworkType | undefined

    // Create or derive signer and provider
    let signer: ethers.Signer
    let provider: ethers.Provider

    if (options.privateKey != null) {
      // Handle private key input
      const rpcURL = options.rpcURL ?? options.rpcURL
      if (rpcURL == null) {
        throw new Error('rpcURL is required when using privateKey')
      }

      // Sanitize private key
      let privateKey = options.privateKey
      if (!privateKey.startsWith('0x')) {
        privateKey = `0x${privateKey}`
      }

      // Create provider and wallet
      // if websockets, use correct provider
      if (/^ws(s)?:\/\//i.test(rpcURL)) {
        provider = new ethers.WebSocketProvider(rpcURL)
      } else {
        provider = new ethers.JsonRpcProvider(rpcURL)
      }

      network = await getFilecoinNetworkType(provider)

      // Create wallet with provider - always use NonceManager unless disabled
      const wallet = new ethers.Wallet(privateKey, provider)
      signer = options.disableNonceManager === true ? wallet : new ethers.NonceManager(wallet)
    } else if (options.provider != null) {
      // Handle provider input
      provider = options.provider

      network = await getFilecoinNetworkType(provider)

      // Get signer - apply NonceManager unless disabled
      // For ethers v6, we need to check if provider has getSigner method
      if ('getSigner' in provider && typeof provider.getSigner === 'function') {
        const baseSigner = await (provider as any).getSigner(0)
        signer = options.disableNonceManager === true ? baseSigner : new ethers.NonceManager(baseSigner)
      } else {
        throw new Error('Provider does not support signing operations')
      }
    } else if (options.signer != null) {
      // Handle signer input
      signer = options.signer

      // Apply NonceManager wrapper unless disabled
      if (options.disableNonceManager !== true && !(signer instanceof ethers.NonceManager)) {
        signer = new ethers.NonceManager(signer)
      }

      // Get provider from signer
      if (signer.provider == null) {
        throw new Error('Signer must have a provider')
      }
      provider = signer.provider

      network = await getFilecoinNetworkType(provider)
    } else {
      // This should never happen due to validation above
      throw new Error('No valid authentication method provided')
    }

    // Final network validation
    if (network !== 'mainnet' && network !== 'calibration') {
      throw new Error(`Invalid network: ${String(network)}. Only 'mainnet' and 'calibration' are supported.`)
    }

    // Create Warm Storage service with initialized addresses
    const warmStorageAddress = options.warmStorageAddress ?? CONTRACT_ADDRESSES.WARM_STORAGE[network]
    if (!warmStorageAddress) {
      throw new Error(`No Warm Storage address configured for network: ${network}`)
    }
    const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)

    // Create payments service with discovered addresses
    const paymentsAddress = warmStorageService.getPaymentsAddress()
    const usdfcAddress = warmStorageService.getUSDFCTokenAddress()
    const payments = new PaymentsService(
      provider,
      signer,
      paymentsAddress,
      usdfcAddress,
      options.disableNonceManager === true
    )

    // Create SPRegistryService for use in retrievers
    const registryAddress = warmStorageService.getServiceProviderRegistryAddress()
    const spRegistry = new SPRegistryService(provider, registryAddress)

    // Initialize piece retriever (use provided or create default)
    let pieceRetriever: PieceRetriever
    if (options.pieceRetriever != null) {
      pieceRetriever = options.pieceRetriever
    } else {
      // Create default retriever chain: FilBeam wraps the base retriever
      const chainRetriever = new ChainRetriever(warmStorageService, spRegistry)

      // Check for subgraph option
      let baseRetriever: PieceRetriever = chainRetriever
      if (options.subgraphConfig != null || options.subgraphService != null) {
        const subgraphService =
          options.subgraphService != null
            ? options.subgraphService
            : new SubgraphService(options.subgraphConfig as SubgraphConfig)
        baseRetriever = new SubgraphRetriever(subgraphService)
      }

      // Wrap with FilBeam retriever
      pieceRetriever = new FilBeamRetriever(baseRetriever, network)
    }

    // Create FilBeamService
    const filbeamService = new FilBeamService(network)

    // Create and initialize the global TelemetryService.
    // If telemetry is disabled, this will do nothing.
    await initGlobalTelemetry(options.telemetry || {}, { filecoinNetwork: network })

    return new Synapse(
      signer,
      provider,
      network,
      payments,
      options.withCDN === true,
      warmStorageAddress,
      warmStorageService,
      pieceRetriever,
      filbeamService,
      options.dev === false,
      options.withIpni
    )
  }

  private constructor(
    signer: ethers.Signer,
    provider: ethers.Provider,
    network: FilecoinNetworkType,
    payments: PaymentsService,
    withCDN: boolean,

    warmStorageAddress: string,
    warmStorageService: WarmStorageService,
    pieceRetriever: PieceRetriever,
    filbeamService: FilBeamService,
    dev: boolean,
    withIpni?: boolean
  ) {
    this._signer = signer
    this._provider = provider
    this._network = network
    this._payments = payments
    this._withCDN = withCDN
    this._warmStorageService = warmStorageService
    this._pieceRetriever = pieceRetriever
    this._warmStorageAddress = warmStorageAddress
    this._filbeamService = filbeamService
    this._session = null

    // Initialize StorageManager
    this._storageManager = new StorageManager(
      this,
      this._warmStorageService,
      this._pieceRetriever,
      this._withCDN,
      dev,
      withIpni
    )
  }

  /**
   * Gets the current network type
   * @returns The network type ('mainnet' or 'calibration')
   */
  getNetwork(): FilecoinNetworkType {
    return this._network
  }

  /**
   * Gets the TelemetryService for error tracking and debugging.
   * @returns The global TelemetryService instance
   * @example
   * ```typescript
   * // Get debug dump for support tickets
   * const dump = synapse.telemetry.debugDump()
   * console.log(JSON.stringify(dump, null, 2))
   *
   * // Track custom events
   * synapse.telemetry.sentry.captureCustomEvent('user-action', { action: 'upload' })
   * ```
   */
  get telemetry(): TelemetryService | null {
    return getGlobalTelemetry()
  }

  /**
   * Gets the signer instance, possibly a session key
   * @returns The ethers signer
   */
  getSigner(): ethers.Signer {
    if (this._session == null) {
      return this._signer
    } else {
      return this._session.getSigner()
    }
  }

  /**
   * Gets the client signer instance
   * @returns the ethers signer
   */
  getClient(): ethers.Signer {
    return this._signer
  }

  /**
   * Wraps the signer as a session key
   * @param sessionKeySigner The signer for the session key
   * @returns The SessionKey object for this signer
   */
  createSessionKey(sessionKeySigner: ethers.Signer): SessionKey {
    return new SessionKey(
      this._provider,
      this._warmStorageService.getSessionKeyRegistryAddress(),
      sessionKeySigner,
      this._signer
    )
  }

  /**
   * Sets the signer as the session key for storage actions
   * @param sessionKey The session key used by storage contexts
   * @example
   * ```typescript
   * const sessionKey = synapse.createSessionKey(privateKey)
   *
   * // check for previous login
   * const expiries = await sessionKey.fetchExpiries(PDP_PERMISSIONS)
   * const HOUR_MILLIS = BigInt(1000 * 60 * 60)
   * if (expiries[ADD_PIECES_TYPEHASH] * BigInt(1000) < BigInt(Date.now()) + HOUR_MILLIS) {
   *   const DAY_MILLIS = BigInt(24) * HOUR_MILLIS
   *   const loginTx = await sessionKey.login(BigInt(Date.now()) / BigInt(1000 + 30 * DAY_MILLIS), PDP_PERMISSIONS, "example.com")
   *   const loginReceipt = await loginTx.wait()
   * }
   *
   * synapse.setSession(sessionKey)
   * const context = await synapse.storage.createContext()
   * ```
   */
  setSession(sessionKey: SessionKey | null) {
    this._session = sessionKey
  }

  /**
   * Gets the provider instance
   * @returns The ethers provider
   */
  getProvider(): ethers.Provider {
    return this._provider
  }

  /**
   * Gets the current chain ID
   * @returns The numeric chain ID
   */
  getChainId(): number {
    return this._network === 'mainnet' ? CHAIN_IDS.mainnet : CHAIN_IDS.calibration
  }

  /**
   * Gets the Warm Storage service address for the current network
   * @returns The Warm Storage service address
   */
  getWarmStorageAddress(): string {
    return this._warmStorageAddress
  }

  /**
   * Gets the Payments contract address for the current network
   * @returns The Payments contract address
   */
  getPaymentsAddress(): string {
    return this._warmStorageService.getPaymentsAddress()
  }

  /**
   * Gets the PDPVerifier contract address for the current network
   * @returns The PDPVerifier contract address
   */
  getPDPVerifierAddress(): string {
    return this._warmStorageService.getPDPVerifierAddress()
  }

  /**
   * Gets the payment service instance
   * @returns The payment service
   */
  get payments(): PaymentsService {
    return this._payments
  }

  /**
   * Gets the storage manager instance
   *
   * @returns The storage manager for all storage operations
   */
  get storage(): StorageManager {
    return this._storageManager
  }

  /**
   * Gets the FilBeam service instance
   *
   * @returns The FilBeam service for interacting with FilBeam infrastructure
   */
  get filbeam(): FilBeamService {
    return this._filbeamService
  }

  /**
   * Create a storage service instance.
   *
   * Automatically selects the best available service provider and creates or reuses a data set.
   *
   * @deprecated Use synapse.storage.createContext() instead. This method will be removed in a future version.
   * @param options - Optional storage configuration
   * @returns A configured StorageService instance ready for uploads/downloads
   *
   * @example
   * ```typescript
   * // Basic usage - auto-selects provider
   * const storage = await synapse.createStorage()
   * const result = await storage.upload(data)
   *
   * // With specific provider
   * const storage = await synapse.createStorage({
   *   providerId: 123
   * })
   *
   * // With CDN enabled
   * const storage = await synapse.createStorage({
   *   withCDN: true
   * })
   * ```
   */
  async createStorage(options: StorageServiceOptions = {}): Promise<StorageService> {
    // Use StorageManager to create context
    return await this._storageManager.createContext(options)
  }

  /**
   * Download data from service providers
   * @deprecated Use synapse.storage.download() instead. This method will be removed in a future version.
   * @param pieceCid - The PieceCID identifier (string or PieceCID object)
   * @param options - Download options
   * @returns The downloaded data as Uint8Array
   *
   * @example
   * ```typescript
   * // Download by PieceCID string
   * const data = await synapse.download('bafkzcib...')
   *
   * // Download from specific provider
   * const data = await synapse.download(pieceCid, {
   *   providerAddress: '0x123...'
   * })
   * ```
   */
  async download(
    pieceCid: string | PieceCID,
    options?: {
      providerAddress?: string
      withCDN?: boolean
    }
  ): Promise<Uint8Array> {
    console.warn('synapse.download() is deprecated. Use synapse.storage.download() instead.')
    return await this._storageManager.download(pieceCid, options)
  }

  /**
   * Get detailed information about a specific service provider
   * @param providerAddress - The provider's address or provider ID
   * @returns Provider information including URLs and pricing
   */
  async getProviderInfo(providerAddress: string | number): Promise<ProviderInfo> {
    try {
      // Validate address format if string provided
      if (typeof providerAddress === 'string') {
        try {
          ethers.getAddress(providerAddress) // Will throw if invalid
        } catch {
          throw new Error(`Invalid provider address: ${providerAddress}`)
        }
      }

      // Create SPRegistryService
      const registryAddress = this._warmStorageService.getServiceProviderRegistryAddress()
      const spRegistry = new SPRegistryService(this._provider, registryAddress)

      let providerInfo: ProviderInfo | null
      if (typeof providerAddress === 'string') {
        providerInfo = await spRegistry.getProviderByAddress(providerAddress)
      } else {
        providerInfo = await spRegistry.getProvider(providerAddress)
      }

      // Check if provider was found in registry
      if (providerInfo == null) {
        throw new Error(`Provider ${providerAddress} not found in registry`)
      }

      return providerInfo
    } catch (error) {
      if (error instanceof Error && error.message.includes('Invalid provider address')) {
        throw error
      }
      if (error instanceof Error && error.message.includes('not found')) {
        throw error
      }
      throw new Error(`Failed to get provider info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get comprehensive information about the storage service including
   * approved providers, pricing, contract addresses, and current allowances
   * @deprecated Use synapse.storage.getStorageInfo() instead. This method will be removed in a future version.
   * @returns Complete storage service information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    console.warn('synapse.getStorageInfo() is deprecated. Use synapse.storage.getStorageInfo() instead.')
    return await this._storageManager.getStorageInfo()
  }
}
