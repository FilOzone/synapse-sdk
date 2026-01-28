import type { Chain as SynapseChain } from '@filoz/synapse-core/chains'
import { ethers } from 'ethers'
import type { Account, Address, Client, Transport } from 'viem'
import { EndorsementsService } from './endorsements/index.ts'
import { FilBeamService } from './filbeam/index.ts'
import { PaymentsService } from './payments/index.ts'
import { ChainRetriever, FilBeamRetriever } from './retriever/index.ts'
import { SessionKey } from './session/key.ts'
import { SPRegistryService } from './sp-registry/index.ts'
import type { StorageContext } from './storage/index.ts'
import { StorageManager } from './storage/manager.ts'
import type {
  FilecoinNetworkType,
  PDPProvider,
  PieceCID,
  PieceRetriever,
  StorageInfo,
  StorageServiceOptions,
  SynapseOptions,
} from './types.ts'
import { CHAIN_IDS, CONTRACT_ADDRESSES, getFilecoinNetworkType } from './utils/index.ts'
import { signerToConnectorClient } from './utils/viem.ts'
import { WarmStorageService } from './warm-storage/index.ts'

/**
 * Class for interacting with Filecoin storage and other on-chain services
 */
export class Synapse {
  private readonly _signer: ethers.Signer
  private readonly _network: FilecoinNetworkType
  private readonly _withCDN: boolean
  private readonly _payments: PaymentsService
  private readonly _provider: ethers.Provider
  private readonly _warmStorageAddress: Address
  private readonly _warmStorageService: WarmStorageService
  private readonly _pieceRetriever: PieceRetriever
  private readonly _storageManager: StorageManager
  private readonly _filbeamService: FilBeamService
  private _session: SessionKey | null = null
  private readonly _multicall3Address: Address

  connectorClient: Client<Transport, SynapseChain, Account>

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
    if (network !== 'mainnet' && network !== 'calibration' && network !== 'devnet') {
      throw new Error(`Invalid network: ${String(network)}. Only 'mainnet', 'calibration', and 'devnet' are supported.`)
    }

    const multicall3Address = options.multicall3Address ?? CONTRACT_ADDRESSES.MULTICALL3[network]
    if (!multicall3Address) {
      throw new Error(
        network === 'devnet'
          ? 'multicall3Address is required when using devnet'
          : `No Multicall3 address configured for network: ${network}`
      )
    }

    const endorsementsAddress = options.endorsementsAddress ?? CONTRACT_ADDRESSES.ENDORSEMENTS[network]
    if (!endorsementsAddress) {
      throw new Error(
        network === 'devnet'
          ? 'endorsements is required when using devnet'
          : `No Endorsements address configured for network: ${network}`
      )
    }

    const connectorClient = await signerToConnectorClient(signer, provider)
    const endorsementsService = new EndorsementsService(connectorClient)

    // Create Warm Storage service with initialized addresses
    const warmStorageAddress = options.warmStorageAddress ?? CONTRACT_ADDRESSES.WARM_STORAGE[network]
    if (!warmStorageAddress) {
      throw new Error(
        network === 'devnet'
          ? 'warmStorageAddress is required when using devnet'
          : `No Warm Storage address configured for network: ${network}`
      )
    }
    const warmStorageService = await WarmStorageService.create(connectorClient)

    // Create payments service with discovered addresses
    const payments = new PaymentsService(connectorClient)

    // Create SPRegistryService for use in retrievers
    const spRegistry = new SPRegistryService(connectorClient)

    // Initialize piece retriever (use provided or create default)
    let pieceRetriever: PieceRetriever
    if (options.pieceRetriever != null) {
      pieceRetriever = options.pieceRetriever
    } else {
      // Create default retriever chain: FilBeam wraps the base retriever
      const chainRetriever = new ChainRetriever(warmStorageService, spRegistry)

      // Wrap with FilBeam retriever
      pieceRetriever = new FilBeamRetriever(baseRetriever, connectorClient.chain)
    }

    // Create FilBeamService
    const filbeamService = new FilBeamService(network)

    return new Synapse(
      signer,
      provider,
      network,
      payments,
      options.withCDN === true,
      connectorClient,
      warmStorageAddress,
      warmStorageService,
      pieceRetriever,
      filbeamService,
      endorsementsService,
      options.dev === false,
      options.withIpni,
      multicall3Address
    )
  }

  private constructor(
    signer: ethers.Signer,
    provider: ethers.Provider,
    network: FilecoinNetworkType,
    payments: PaymentsService,
    withCDN: boolean,
    connectorClient: Client<Transport, SynapseChain, Account>,
    warmStorageAddress: Address,
    warmStorageService: WarmStorageService,
    pieceRetriever: PieceRetriever,
    filbeamService: FilBeamService,
    endorsementsService: EndorsementsService,
    dev: boolean,
    withIpni: boolean | undefined,
    multicall3Address: Address
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
    this._multicall3Address = multicall3Address

    this.connectorClient = connectorClient
    // Initialize StorageManager
    this._storageManager = new StorageManager(
      this,
      this._warmStorageService,
      endorsementsService,
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
  createSessionKey(account: Account): SessionKey {
    return new SessionKey(this.connectorClient, account)
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
    if (this._network === 'mainnet') {
      return CHAIN_IDS.mainnet
    } else if (this._network === 'calibration') {
      return CHAIN_IDS.calibration
    }
    return CHAIN_IDS.devnet
  }

  /**
   * Gets the Warm Storage service address for the current network
   * @returns The Warm Storage service address
   */
  getWarmStorageAddress(): Address {
    return this._warmStorageAddress
  }

  /**
   * Gets the Payments contract address for the current network
   * @returns The Payments contract address
   */
  getPaymentsAddress(): Address {
    return this._warmStorageService.getPaymentsAddress()
  }

  /**
   * Gets the PDPVerifier contract address for the current network
   * @returns The PDPVerifier contract address
   */
  getPDPVerifierAddress(): Address {
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
  async createStorage(options: StorageServiceOptions = {}): Promise<StorageContext> {
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
      providerAddress?: Address
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
  async getProviderInfo(providerAddress: Address | bigint): Promise<PDPProvider> {
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
      const spRegistry = new SPRegistryService(this.connectorClient)

      let providerInfo: PDPProvider | null
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
