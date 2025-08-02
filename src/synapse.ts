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
import { PandoraService } from './pandora/index.js'
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
  private readonly _pandoraAddress: string
  private readonly _pdpVerifierAddress: string
  private readonly _pandoraService: PandoraService
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
    if (options.privateKey != null && options.rpcURL == null) {
      throw new Error('rpcURL is required when using privateKey')
    }

    // Initialize provider and signer
    let provider: ethers.Provider
    let signer: ethers.Signer

    if (options.privateKey != null && options.rpcURL != null) {
      // Create provider from RPC URL
      if (options.rpcURL.startsWith('ws://') || options.rpcURL.startsWith('wss://')) {
        provider = new ethers.WebSocketProvider(options.rpcURL)
      } else {
        // For HTTP/HTTPS URLs, check if authorization is provided
        if (options.authorization != null) {
          const fetchRequest = new ethers.FetchRequest(options.rpcURL)
          fetchRequest.setHeader('Authorization', options.authorization)
          provider = new ethers.JsonRpcProvider(fetchRequest)
        } else {
          provider = new ethers.JsonRpcProvider(options.rpcURL)
        }
      }

      // Create wallet from private key
      const wallet = new ethers.Wallet(options.privateKey, provider)

      // Apply NonceManager if not disabled
      if (options.disableNonceManager !== true) {
        signer = new ethers.NonceManager(wallet)
      } else {
        signer = wallet
      }
    } else if (options.provider != null) {
      provider = options.provider

      // Get signer from provider
      if ('getSigner' in provider && typeof provider.getSigner === 'function') {
        const providerSigner = await (provider as any).getSigner()

        // Apply NonceManager if not disabled
        if (options.disableNonceManager !== true) {
          signer = new ethers.NonceManager(providerSigner)
        } else {
          signer = providerSigner
        }
      } else {
        throw new Error('Provider must support getSigner() method')
      }
    } else if (options.signer != null) {
      signer = options.signer

      if (signer.provider != null) {
        provider = signer.provider
      } else {
        throw new Error('Signer must have a provider attached')
      }

      // Apply NonceManager if not disabled
      if (options.disableNonceManager !== true) {
        signer = new ethers.NonceManager(signer)
      }
    } else {
      throw new Error('Invalid configuration')
    }

    // Detect network
    let network: FilecoinNetworkType
    try {
      const ethersNetwork = await provider.getNetwork()
      const chainId = Number(ethersNetwork.chainId)

      if (chainId === CHAIN_IDS.mainnet) {
        network = 'mainnet'
      } else if (chainId === CHAIN_IDS.calibration) {
        network = 'calibration'
      } else {
        throw new Error(
          `Unsupported network with chain ID ${chainId}. Synapse SDK only supports Filecoin mainnet (${CHAIN_IDS.mainnet}) and calibration (${CHAIN_IDS.calibration}) networks.`
        )
      }
    } catch (error) {
      throw new Error(
        `Failed to detect network from provider. Please ensure your RPC endpoint is accessible and responds to network queries. ${
          error instanceof Error ? `Underlying error: ${error.message}` : ''
        }`
      )
    }

    // Create Pandora service for the retriever
    const pandoraAddress = options.pandoraAddress ?? CONTRACT_ADDRESSES.PANDORA_SERVICE[network]
    const pdpVerifierAddress = options.pdpVerifierAddress ?? CONTRACT_ADDRESSES.PDP_VERIFIER[network]
    const pandoraService = new PandoraService(provider, pandoraAddress, pdpVerifierAddress)

    // Initialize piece retriever (use provided or create default)
    let pieceRetriever: PieceRetriever
    if (options.pieceRetriever != null) {
      pieceRetriever = options.pieceRetriever
    } else {
      const chainRetriever = new ChainRetriever(pandoraService /*, no child here */)
      let underlyingRetriever: PieceRetriever = chainRetriever

      // Handle subgraph piece retriever - can provide either a service or configuration
      if (options.subgraphService != null || options.subgraphConfig != null) {
        try {
          let subgraphService: SubgraphRetrievalService

          if (options.subgraphService != null) {
            subgraphService = options.subgraphService
          } else if (options.subgraphConfig != null) {
            subgraphService = new SubgraphService(options.subgraphConfig)
          } else {
            // This shouldn't happen due to the if condition above, but TypeScript doesn't know that
            throw new Error('Invalid subgraph configuration: neither service nor config provided')
          }

          underlyingRetriever = new SubgraphRetriever(subgraphService, chainRetriever)
        } catch (error) {
          throw new Error(
            `Failed to initialize subgraph piece retriever: ${
              error instanceof Error ? error.message : String(error)
            }`
          )
        }
      }

      pieceRetriever = new FilCdnRetriever(underlyingRetriever, network)
    }

    return new Synapse(
      provider,
      signer,
      network,
      options.disableNonceManager === true,
      options.withCDN === true,
      options.pandoraAddress,
      options.pdpVerifierAddress,
      pandoraService,
      pieceRetriever
    )
  }

  private constructor (
    provider: ethers.Provider,
    signer: ethers.Signer,
    network: FilecoinNetworkType,
    disableNonceManager: boolean,
    withCDN: boolean,
    pandoraAddressOverride: string | undefined,
    pdpVerifierAddressOverride: string | undefined,
    pandoraService: PandoraService,
    pieceRetriever: PieceRetriever
  ) {
    this._provider = provider
    this._signer = signer
    this._network = network
    this._withCDN = withCDN
    this._payments = new PaymentsService(provider, signer, network, disableNonceManager)
    this._pandoraService = pandoraService
    this._pieceRetriever = pieceRetriever

    // Set Pandora address (use override or default for network)
    this._pandoraAddress = pandoraAddressOverride ?? CONTRACT_ADDRESSES.PANDORA_SERVICE[network]
    if (this._pandoraAddress === '' || this._pandoraAddress === undefined) {
      throw new Error(`No Pandora service address configured for network: ${network}`)
    }

    // Set PDPVerifier address (use override or default for network)
    this._pdpVerifierAddress = pdpVerifierAddressOverride ?? CONTRACT_ADDRESSES.PDP_VERIFIER[network]
    if (this._pdpVerifierAddress === '' || this._pdpVerifierAddress === undefined) {
      throw new Error(`No PDPVerifier contract address configured for network: ${network}`)
    }
  }

  /**
   * Get the payments instance for payment operations
   * @returns The PaymentsService instance
   */
  get payments (): PaymentsService {
    return this._payments
  }

  /**
   * Get the provider instance
   * @internal
   * @returns The ethers Provider instance
   */
  getProvider (): ethers.Provider {
    return this._provider
  }

  /**
   * Get the signer instance
   * @internal
   * @returns The ethers Signer instance
   */
  getSigner (): ethers.Signer {
    return this._signer
  }

  /**
   * Get the chain ID as bigint
   * @internal
   * @returns The chain ID
   */
  getChainId (): bigint {
    return BigInt(CHAIN_IDS[this._network])
  }

  /**
   * Get the Pandora service address
   * @internal
   * @returns The Pandora service address
   */
  getPandoraAddress (): string {
    return this._pandoraAddress
  }

  /**
   * Get the PDPVerifier contract address
   * @internal
   * @returns The PDPVerifier contract address
   */
  getPDPVerifierAddress (): string {
    return this._pdpVerifierAddress
  }

  /**
   * Create a storage service instance for interacting with PDP storage
   * @param options - Configuration options for the storage service
   * @returns A fully initialized StorageService instance
   */
  async createStorage (options?: StorageServiceOptions): Promise<StorageService> {
    try {
      // Merge instance-level CDN preference with provided options
      const mergedOptions: StorageServiceOptions = {
        ...options,
        withCDN: options?.withCDN ?? this._withCDN
      }

      // Create the storage service with proper initialization
      const storageService = await StorageService.create(this, this._pandoraService, mergedOptions)
      return storageService
    } catch (error) {
      throw createError(
        'Synapse',
        'createStorage',
        'Failed to create storage service',
        error
      )
    }
  }

  /**
   * Get the network this instance is connected to
   * @returns The network type ('mainnet' or 'calibration')
   */
  getNetwork (): FilecoinNetworkType {
    return this._network
  }

  /**
   * Get information about a storage provider
   * @param providerAddress - The Ethereum address of the provider
   * @returns Provider metadata including owner, URLs, and approval timestamps
   * @throws Error if provider is not found or not approved
   */
  async getProviderInfo (providerAddress: string): Promise<ApprovedProviderInfo> {
    try {
      // Validate address format
      if (!ethers.isAddress(providerAddress)) {
        throw new Error(`Invalid provider address: ${String(providerAddress)}`)
      }

      // Get provider ID from address
      const providerId = await this._pandoraService.getProviderIdByAddress(providerAddress)
      if (providerId === 0) {
        throw new Error(`Provider ${providerAddress} is not approved`)
      }

      // Get provider info
      const providerInfo = await this._pandoraService.getApprovedProvider(providerId)
      if (providerInfo.owner === ethers.ZeroAddress) {
        throw new Error(`Provider ${providerAddress} not found`)
      }

      return providerInfo
    } catch (error) {
      throw createError(
        'Synapse',
        'getProviderInfo',
        `Failed to get provider info for ${providerAddress}`,
        error
      )
    }
  }

  /**
   * Download a piece from storage providers
   * @param commp - The CommP identifier (as string or CommP object)
   * @param options - Optional download parameters
   * @returns The downloaded data as Uint8Array
   */
  async download (
    commp: string | CommP,
    options?: {
      withCDN?: boolean
      providerAddress?: string
    }
  ): Promise<Uint8Array> {
    // Validate CommP
    const parsedCommP = asCommP(commp)
    if (parsedCommP == null) {
      throw createError('Synapse', 'download', `Invalid CommP: ${String(commp)}`)
    }

    const client = await this._signer.getAddress()
    const response = await this._pieceRetriever.fetchPiece(
      parsedCommP,
      client,
      {
        withCDN: options?.withCDN ?? this._withCDN, // Use instance withCDN if not provided
        providerAddress: options?.providerAddress
      }
    )

    return await downloadAndValidateCommP(response, parsedCommP)
  }

  /**
   * Get comprehensive storage service information including pricing, providers, and allowances
   * @returns Storage service information
   */
  async getStorageInfo (): Promise<StorageInfo> {
    try {
      // Helper function to get allowances with error handling
      const getOptionalAllowances = async (): Promise<StorageInfo['allowances']> => {
        try {
          const approval = await this._payments.serviceApproval(
            this._pandoraAddress,
            TOKENS.USDFC
          )
          return {
            service: this._pandoraAddress,
            rateAllowance: approval.rateAllowance,
            lockupAllowance: approval.lockupAllowance,
            rateUsed: approval.rateUsed,
            lockupUsed: approval.lockupUsed
          }
        } catch (error) {
          // Return null if wallet not connected or any error occurs
          return null
        }
      }

      // Fetch all data in parallel for performance
      const [pricingData, providers, allowances] = await Promise.all([
        this._pandoraService.getServicePrice(),
        this._pandoraService.getAllApprovedProviders(),
        getOptionalAllowances()
      ])

      // Calculate pricing per different time units
      const epochsPerMonth = BigInt(pricingData.epochsPerMonth)
      const epochsPerDay = TIME_CONSTANTS.EPOCHS_PER_DAY

      // Calculate per-epoch pricing
      const noCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / epochsPerMonth
      const withCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthWithCDN) / epochsPerMonth

      // Calculate per-day pricing
      const noCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / TIME_CONSTANTS.DAYS_PER_MONTH
      const withCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthWithCDN) / TIME_CONSTANTS.DAYS_PER_MONTH

      // Filter out providers with zero addresses
      const validProviders = providers.filter((p: ApprovedProviderInfo) => p.owner !== ethers.ZeroAddress)

      return {
        pricing: {
          noCDN: {
            perTiBPerMonth: BigInt(pricingData.pricePerTiBPerMonthNoCDN),
            perTiBPerDay: noCDNPerDay,
            perTiBPerEpoch: noCDNPerEpoch
          },
          withCDN: {
            perTiBPerMonth: BigInt(pricingData.pricePerTiBPerMonthWithCDN),
            perTiBPerDay: withCDNPerDay,
            perTiBPerEpoch: withCDNPerEpoch
          },
          tokenAddress: pricingData.tokenAddress,
          tokenSymbol: 'USDFC' // Hardcoded as we know it's always USDFC
        },
        providers: validProviders,
        serviceParameters: {
          network: this._network,
          epochsPerMonth,
          epochsPerDay,
          epochDuration: TIME_CONSTANTS.EPOCH_DURATION,
          minUploadSize: SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
          maxUploadSize: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
          pandoraAddress: this._pandoraAddress,
          paymentsAddress: CONTRACT_ADDRESSES.PAYMENTS[this._network],
          pdpVerifierAddress: this._pdpVerifierAddress
        },
        allowances
      }
    } catch (error) {
      throw createError(
        'Synapse',
        'getStorageInfo',
        'Failed to get storage service information',
        error
      )
    }
  }
}

// Export as default
export { Synapse as default }
