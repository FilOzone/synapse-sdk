/**
 * Main Synapse class for interacting with Filecoin storage and other on-chain services
 */

import { ethers } from 'ethers'
import {
  type SynapseOptions,
  type StorageServiceOptions,
  type FilecoinNetworkType,
  type PieceRetriever,
  type SubgraphRetrievalService,
  type CommP,
  type ApprovedProviderInfo,
  type StorageInfo
} from './types.js'
import { StorageService } from './storage/index.js'
import { PaymentsService } from './payments/index.js'
import { WarmStorageService } from './warm-storage/index.js'
import { SubgraphService } from './subgraph/service.js'
import { ChainRetriever, FilCdnRetriever, SubgraphRetriever } from './retriever/index.js'
import { asCommP, downloadAndValidateCommP } from './commp/index.js'
import { CHAIN_IDS, CONTRACT_ADDRESSES, SIZE_CONSTANTS, TIME_CONSTANTS, TOKENS, createError } from './utils/index.js'

export class Synapse {
  private readonly _signer: ethers.Signer
  private readonly _network: FilecoinNetworkType
  private readonly _withCDN: boolean
  private readonly _payments: PaymentsService
  private readonly _provider: ethers.Provider
  private readonly _warmStorageAddress: string
  private readonly _pdpVerifierAddress: string
  private readonly _warmStorageService: WarmStorageService
  private readonly _pieceRetriever: PieceRetriever

  /**
   * Create a new Synapse instance with async initialization.
   * @param options - Configuration options for Synapse
   * @returns A fully initialized Synapse instance
   */
  static async create (options: SynapseOptions): Promise<Synapse> {
    // Validate options
    const providedOptions = [options.privateKey, options.provider, options.signer].filter(Boolean).length
    if (providedOptions !== 1) {
      throw new Error('Must provide exactly one of: privateKey, provider, or signer')
    }

    // Detect network if not provided
    let network: FilecoinNetworkType | undefined = options.network

    // Create or derive signer and provider
    let signer: ethers.Signer
    let provider: ethers.Provider

    if (options.privateKey != null) {
      // Handle private key input
      if (options.rpcUrl == null) {
        throw new Error('rpcUrl is required when using privateKey')
      }

      // Sanitize private key
      let privateKey = options.privateKey
      if (!privateKey.startsWith('0x')) {
        privateKey = '0x' + privateKey
      }

      // Create provider and wallet
      provider = new ethers.JsonRpcProvider(options.rpcUrl)

      // If network wasn't explicitly set, detect it
      if (network == null) {
        const chainId = (await provider.getNetwork()).chainId
        network = chainId === CHAIN_IDS.FILECOIN_MAINNET ? 'mainnet' : 'calibration'
      }

      // Create wallet with provider - always use NonceManager unless disabled
      const wallet = new ethers.Wallet(privateKey, provider)
      signer = options.disableNonceManager === true ? wallet : new ethers.NonceManager(wallet)
    } else if (options.provider != null) {
      // Handle provider input
      provider = options.provider
      const accounts = await provider.listAccounts()
      if (accounts.length === 0) {
        throw new Error('No accounts found in provider')
      }

      // If network wasn't explicitly set, detect it
      if (network == null) {
        const chainId = (await provider.getNetwork()).chainId
        network = chainId === CHAIN_IDS.FILECOIN_MAINNET ? 'mainnet' : 'calibration'
      }

      // Get signer - apply NonceManager unless disabled
      const baseSigner = await provider.getSigner(0)
      signer = options.disableNonceManager === true ? baseSigner : new ethers.NonceManager(baseSigner)
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

      // If network wasn't explicitly set, detect it
      if (network == null) {
        const chainId = (await provider.getNetwork()).chainId
        network = chainId === CHAIN_IDS.FILECOIN_MAINNET ? 'mainnet' : 'calibration'
      }
    } else {
      // This should never happen due to validation above
      throw new Error('No valid authentication method provided')
    }

    // Final network validation
    if (network !== 'mainnet' && network !== 'calibration') {
      throw new Error(`Invalid network: ${network}. Only 'mainnet' and 'calibration' are supported.`)
    }

    // Create payments service
    const payments = new PaymentsService(
      provider,
      signer,
      network,
      options.disableNonceManager === true
    )

    // Create Warm Storage service for the retriever
    const warmStorageAddress = options.warmStorageAddress ?? CONTRACT_ADDRESSES.WARM_STORAGE_SERVICE[network]
    const pdpVerifierAddress = options.pdpVerifierAddress ?? CONTRACT_ADDRESSES.PDP_VERIFIER[network]
    const warmStorageService = new WarmStorageService(provider, warmStorageAddress, pdpVerifierAddress)

    // Initialize piece retriever (use provided or create default)
    let pieceRetriever: PieceRetriever
    if (options.retriever != null) {
      pieceRetriever = options.retriever
    } else if (options.pieceRetriever != null) {
      // Support the legacy option name for backward compatibility
      pieceRetriever = options.pieceRetriever
    } else {
      // Create default retriever chain
      const filCdnRetriever = new FilCdnRetriever()
      const chainRetriever = new ChainRetriever(provider, warmStorageService, warmStorageAddress)

      // Check for subgraph option
      let subgraphRetriever: SubgraphRetrievalService | null = null
      if (options.subgraphUrl != null || options.subgraphApiKey != null) {
        const subgraphService = new SubgraphService(
          options.subgraphUrl ?? CONTRACT_ADDRESSES.SUBGRAPH_URL[network],
          options.subgraphApiKey
        )
        subgraphRetriever = new SubgraphRetriever(subgraphService, provider, warmStorageService)
      }

      // Build retriever chain: FilCDN -> Subgraph (if configured) -> Chain
      if (subgraphRetriever != null) {
        filCdnRetriever.setNext(subgraphRetriever)
        subgraphRetriever.setNext(chainRetriever)
      } else {
        filCdnRetriever.setNext(chainRetriever)
      }

      pieceRetriever = filCdnRetriever
    }

    return new Synapse(
      signer,
      provider,
      network,
      payments,
      options.disableNonceManager === true,
      options.withCDN === true,
      options.warmStorageAddress,
      options.pdpVerifierAddress,
      warmStorageService,
      pieceRetriever
    )
  }

  private constructor (
    signer: ethers.Signer,
    provider: ethers.Provider,
    network: FilecoinNetworkType,
    payments: PaymentsService,
    disableNonceManager: boolean,
    withCDN: boolean,
    warmStorageAddressOverride: string | undefined,
    pdpVerifierAddressOverride: string | undefined,
    warmStorageService: WarmStorageService,
    pieceRetriever: PieceRetriever
  ) {
    this._signer = signer
    this._provider = provider
    this._network = network
    this._payments = payments
    this._withCDN = withCDN
    this._warmStorageService = warmStorageService
    this._pieceRetriever = pieceRetriever

    // Set Warm Storage address (use override or default for network)
    this._warmStorageAddress = warmStorageAddressOverride ?? CONTRACT_ADDRESSES.WARM_STORAGE_SERVICE[network]
    if (this._warmStorageAddress === '' || this._warmStorageAddress === undefined) {
      throw new Error(`No Warm Storage service address configured for network: ${network}`)
    }

    // Set PDPVerifier address (use override or default for network)
    this._pdpVerifierAddress = pdpVerifierAddressOverride ?? CONTRACT_ADDRESSES.PDP_VERIFIER[network]
    if (this._pdpVerifierAddress === '' || this._pdpVerifierAddress === undefined) {
      throw new Error(`No PDPVerifier contract address configured for network: ${network}`)
    }
  }

  /**
   * Gets the current network type
   * @returns The network type ('mainnet' or 'calibration')
   */
  getNetwork (): FilecoinNetworkType {
    return this._network
  }

  /**
   * Gets the signer instance
   * @returns The ethers signer
   */
  getSigner (): ethers.Signer {
    return this._signer
  }

  /**
   * Gets the provider instance
   * @returns The ethers provider
   */
  getProvider (): ethers.Provider {
    return this._provider
  }

  /**
   * Gets the current chain ID
   * @returns The numeric chain ID
   */
  getChainId (): number {
    return this._network === 'mainnet' ? CHAIN_IDS.FILECOIN_MAINNET : CHAIN_IDS.FILECOIN_CALIBRATION
  }

  /**
   * Gets the Warm Storage service address for the current network
   * @returns The Warm Storage service address
   */
  getWarmStorageAddress (): string {
    return this._warmStorageAddress
  }

  /**
   * Gets the PDPVerifier contract address for the current network
   * @returns The PDPVerifier contract address
   */
  getPDPVerifierAddress (): string {
    return this._pdpVerifierAddress
  }

  /**
   * Gets the payment service instance
   * @returns The payment service
   */
  get payments (): PaymentsService {
    return this._payments
  }

  /**
   * Create a storage service instance.
   * Automatically selects the best available storage provider and creates or reuses a data set.
   *
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
  async createStorage (options: StorageServiceOptions = {}): Promise<StorageService> {
    // Apply default withCDN from instance if not specified
    const finalOptions = {
      ...options,
      withCDN: options.withCDN ?? this._withCDN
    }

    return await StorageService.create(this, this._warmStorageService, finalOptions)
  }

  /**
   * Download data from storage providers
   * @param commp - The CommP identifier (string or CommP object)
   * @param options - Download options
   * @returns The downloaded data as Uint8Array
   *
   * @example
   * ```typescript
   * // Download by CommP string
   * const data = await synapse.download('baga6ea4seaqabc...')
   *
   * // Download from specific provider
   * const data = await synapse.download(commp, {
   *   providerAddress: '0x123...'
   * })
   * ```
   */
  async download (commp: string | CommP, options?: {
    providerAddress?: string
    withCDN?: boolean
  }): Promise<Uint8Array> {
    const parsedCommP = asCommP(commp)

    // Use the withCDN setting: option > instance default
    const withCDN = options?.withCDN ?? this._withCDN

    // Use the piece retriever to find and download
    const retrieverContext = {
      providerHint: options?.providerAddress,
      withCDN
    }

    return await downloadAndValidateCommP(
      parsedCommP,
      this._pieceRetriever,
      retrieverContext
    )
  }

  /**
   * Get detailed information about a specific storage provider
   * @param providerAddress - The provider's address or provider ID
   * @returns Provider information including URLs and pricing
   */
  async getProviderInfo (providerAddress: string | number): Promise<ApprovedProviderInfo> {
    return await this._warmStorageService.getApprovedProviderByAddress(providerAddress)
  }

  /**
   * Get comprehensive information about the storage service including
   * approved providers, pricing, contract addresses, and current allowances
   * @returns Complete storage service information
   */
  async getStorageInfo (): Promise<StorageInfo> {
    // Fetch providers, service price, and allowances in parallel
    const [providers, servicePriceInfo, allowances] = await Promise.all([
      this._warmStorageService.getApprovedProviders(),
      this._warmStorageService.getServicePrice(),
      (async () => {
        try {
          const approval = await this._payments.serviceApproval(
            this._warmStorageAddress,
            TOKENS.USDFC
          )
          return {
            service: this._warmStorageAddress,
            rateAllowance: approval.rateAllowance,
            lockupAllowance: approval.lockupAllowance,
            availableFunds: await this._payments.availableFunds(TOKENS.USDFC)
          }
        } catch {
          // If not approved yet, return zero allowances
          return {
            service: this._warmStorageAddress,
            rateAllowance: 0n,
            lockupAllowance: 0n,
            availableFunds: await this._payments.availableFunds(TOKENS.USDFC)
          }
        }
      })()
    ])

    // Calculate pricing based on service price
    const calculatePricing = (epochPrice: bigint, withCDN: boolean) => {
      const perEpoch = epochPrice
      const perDay = perEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
      const perMonth = perEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_MONTH)
      const perTiBPerMonth = (perMonth * BigInt(SIZE_CONSTANTS.TIB_IN_BYTES)) / BigInt(SIZE_CONSTANTS.BYTES_PER_USDFC_PER_EPOCH)
      const perGiBPerMonth = perTiBPerMonth / 1024n

      return {
        withCDN,
        perEpoch,
        perDay,
        perMonth,
        perTiBPerMonth,
        perGiBPerMonth
      }
    }

    return {
      providers,
      pricing: {
        noCDN: calculatePricing(servicePriceInfo.noCDN, false),
        withCDN: calculatePricing(servicePriceInfo.withCDN, true)
      },
      contracts: {
        minUploadSize: SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
        maxUploadSize: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
        warmStorageAddress: this._warmStorageAddress,
        paymentsAddress: CONTRACT_ADDRESSES.PAYMENTS[this._network],
        pdpVerifierAddress: this._pdpVerifierAddress
      },
      allowances
    }
  }
}