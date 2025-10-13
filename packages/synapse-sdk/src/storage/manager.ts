/**
 * StorageManager - Central facade for all storage operations
 *
 * Manages storage contexts (SP + DataSet pairs) with intelligent caching and reuse.
 * Provides both SP-agnostic operations (download from anywhere) and context-based
 * operations (upload/download to/from specific providers).
 *
 * @example
 * ```typescript
 * // Simple usage - auto-manages context
 * await synapse.storage.upload(data)
 * await synapse.storage.download(pieceCid)
 *
 * // Explicit context
 * const context = await synapse.storage.createContext({ providerId: 1 })
 * await context.upload(data)
 *
 * // Context routing
 * await synapse.storage.upload(data, { context })
 * ```
 */

import { ethers } from 'ethers'
import { asPieceCID, downloadAndValidate } from '../piece/index.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  DownloadOptions,
  EnhancedDataSetInfo,
  PieceCID,
  PieceRetriever,
  PreflightInfo,
  ProviderInfo,
  StorageCreationCallbacks,
  StorageInfo,
  StorageServiceOptions,
  UploadCallbacks,
  UploadResult,
} from '../types.ts'
import {
  combineMetadata,
  createError,
  METADATA_KEYS,
  metadataMatches,
  SIZE_CONSTANTS,
  TIME_CONSTANTS,
  TOKENS,
} from '../utils/index.ts'
import { ProviderResolver } from '../utils/provider-resolver.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'
import { StorageContext } from './context.ts'

// Combined callbacks type that can include both creation and upload callbacks
type CombinedCallbacks = StorageCreationCallbacks & UploadCallbacks

/**
 * Upload options for StorageManager.upload() - the all-in-one upload method
 *
 * This is the "uber-shortcut" method that can handle everything from context
 * creation to piece upload in a single call. It combines:
 * - Storage context creation options (provider selection, data set creation)
 * - Upload callbacks (both creation and upload progress)
 * - Piece-specific metadata
 *
 * Usage patterns:
 * 1. With explicit context: `{ context, callbacks?, metadata? }` - routes to context.upload()
 * 2. Auto-create context: `{ providerId?, dataSetId?, withCDN?, callbacks?, metadata? }` - creates/reuses context
 * 3. Use default context: `{ callbacks?, metadata? }` - uses cached default context
 *
 * @internal This type is intentionally not exported as it's specific to StorageManager
 */
interface StorageManagerUploadOptions extends StorageServiceOptions {
  // Context routing - if provided, all other context options are invalid
  context?: StorageContext

  // Callbacks that can include both creation and upload callbacks
  callbacks?: Partial<CombinedCallbacks>
}

interface StorageManagerDownloadOptions extends DownloadOptions {
  context?: StorageContext
  providerAddress?: string
  withCDN?: boolean
}

export class StorageManager {
  private readonly _synapse: Synapse
  private readonly _warmStorageService: WarmStorageService
  private readonly _pieceRetriever: PieceRetriever
  private readonly _withCDN: boolean
  private readonly _dev: boolean
  private readonly _withIpni: boolean | undefined
  private _defaultContext?: StorageContext

  constructor(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    pieceRetriever: PieceRetriever,
    withCDN: boolean,
    dev: boolean,
    withIpni?: boolean
  ) {
    this._synapse = synapse
    this._warmStorageService = warmStorageService
    this._pieceRetriever = pieceRetriever
    this._withCDN = withCDN
    this._dev = dev
    this._withIpni = withIpni
  }

  /**
   * Upload data to storage
   * If context is provided, routes to context.upload()
   * Otherwise creates/reuses default context
   */
  async upload(data: Uint8Array | ArrayBuffer, options?: StorageManagerUploadOptions): Promise<UploadResult> {
    // Validate options - if context is provided, no other options should be set
    if (options?.context != null) {
      const invalidOptions = []
      if (options.providerId !== undefined) invalidOptions.push('providerId')
      if (options.providerAddress !== undefined) invalidOptions.push('providerAddress')
      if (options.dataSetId !== undefined) invalidOptions.push('dataSetId')
      if (options.withCDN !== undefined) invalidOptions.push('withCDN')
      if (options.forceCreateDataSet !== undefined) invalidOptions.push('forceCreateDataSet')
      if (options.uploadBatchSize !== undefined) invalidOptions.push('uploadBatchSize')

      if (invalidOptions.length > 0) {
        throw createError(
          'StorageManager',
          'upload',
          `Cannot specify both 'context' and other options: ${invalidOptions.join(', ')}`
        )
      }
    }

    // Get the context to use
    const context = options?.context ?? (await this.createContext(options))

    // Upload using the context with piece metadata
    return await context.upload(data, {
      ...options?.callbacks,
      metadata: options?.metadata,
    })
  }

  /**
   * Download data from storage
   * If context is provided, routes to context.download()
   * Otherwise performs SP-agnostic download
   */
  async download(pieceCid: string | PieceCID, options?: StorageManagerDownloadOptions): Promise<Uint8Array> {
    // Validate options - if context is provided, no other options should be set
    if (options?.context != null) {
      const invalidOptions = []
      if (options.providerAddress !== undefined) invalidOptions.push('providerAddress')
      if (options.withCDN !== undefined) invalidOptions.push('withCDN')

      if (invalidOptions.length > 0) {
        throw createError(
          'StorageManager',
          'download',
          `Cannot specify both 'context' and other options: ${invalidOptions.join(', ')}`
        )
      }

      // Route to specific context
      return await options.context.download(pieceCid, options)
    }

    // SP-agnostic download with fast path optimization
    const parsedPieceCID = asPieceCID(pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageManager', 'download', `Invalid PieceCID: ${String(pieceCid)}`)
    }

    // Use withCDN setting: option > manager default > synapse default
    const withCDN = options?.withCDN ?? this._withCDN

    // Fast path: If we have a default context with CDN disabled and no specific provider requested,
    // check if the piece exists on the default context's provider first
    if (this._defaultContext != null && !withCDN && options?.providerAddress == null) {
      // Check if the default context has CDN disabled
      const defaultHasCDN = (this._defaultContext as any)._withCDN ?? this._withCDN
      if (defaultHasCDN === false) {
        // Check if the piece exists on this provider
        const hasPiece = await this._defaultContext.hasPiece(parsedPieceCID)
        if (hasPiece) {
          // Fast path: download directly from the default context's provider
          return await this._defaultContext.download(pieceCid, options)
        }
      }
    }

    // Fall back to normal SP-agnostic download with discovery
    const clientAddress = await this._synapse.getClient().getAddress()

    // Use piece retriever to fetch
    const response = await this._pieceRetriever.fetchPiece(parsedPieceCID, clientAddress, {
      providerAddress: options?.providerAddress,
      withCDN,
    })

    return await downloadAndValidate(response, parsedPieceCID)
  }

  /**
   * Run preflight checks for an upload without creating a context
   * @param size - The size of data to upload in bytes
   * @param options - Optional settings including withCDN flag and/or metadata
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload(
    size: number,
    options?: { withCDN?: boolean; metadata?: Record<string, string> }
  ): Promise<PreflightInfo> {
    // Determine withCDN from metadata if provided, otherwise use option > manager default
    let withCDN = options?.withCDN ?? this._withCDN

    // Check metadata for withCDN key - this takes precedence
    if (options?.metadata != null && METADATA_KEYS.WITH_CDN in options.metadata) {
      // The withCDN metadata entry should always have an empty string value by convention,
      // but the contract only checks for key presence, not value
      const value = options.metadata[METADATA_KEYS.WITH_CDN]
      if (value !== '') {
        console.warn(`Warning: withCDN metadata entry has unexpected value "${value}". Expected empty string.`)
      }
      withCDN = true // Enable CDN when key exists (matches contract behavior)
    }

    // Use the static method from StorageContext for core logic
    return await StorageContext.performPreflightCheck(this._warmStorageService, this._synapse.payments, size, withCDN)
  }

  /**
   * Create a new storage context with specified options
   */
  async createContext(options?: StorageServiceOptions): Promise<StorageContext> {
    // Determine the effective withCDN setting
    const effectiveWithCDN = options?.withCDN ?? this._withCDN

    // Check if we can return the default context
    // We can use the default if:
    // 1. No options provided, OR
    // 2. Only withCDN, metadata and/or callbacks are provided (callbacks can fire for cached context)
    const canUseDefault =
      options == null ||
      (options.providerId == null &&
        options.providerAddress == null &&
        options.dataSetId == null &&
        options.forceCreateDataSet !== true &&
        options.uploadBatchSize == null)

    if (canUseDefault) {
      // Check if we have a default context with compatible metadata
      if (this._defaultContext != null) {
        // Combine the current request metadata with effective withCDN setting
        const requestedMetadata = combineMetadata(options?.metadata, effectiveWithCDN)

        // Check if the requested metadata matches what the default context was created with
        if (metadataMatches(this._defaultContext.dataSetMetadata, requestedMetadata)) {
          // Fire callbacks for cached context to ensure consistent behavior
          if (options?.callbacks != null) {
            try {
              options.callbacks.onProviderSelected?.(this._defaultContext.provider)
            } catch (error) {
              console.error('Error in onProviderSelected callback:', error)
            }

            try {
              options.callbacks.onDataSetResolved?.({
                isExisting: true, // Always true for cached context
                dataSetId: this._defaultContext.dataSetId,
                provider: this._defaultContext.provider,
              })
            } catch (error) {
              console.error('Error in onDataSetResolved callback:', error)
            }
          }
          return this._defaultContext
        }
      }

      // Create new default context with current CDN setting
      const context = await StorageContext.create(this._synapse, this._warmStorageService, {
        ...options,
        withCDN: effectiveWithCDN,
        withIpni: options?.withIpni ?? this._withIpni,
        dev: options?.dev ?? this._dev,
      })
      this._defaultContext = context
      return context
    }

    // Create a new context with specific options (not cached)
    return await StorageContext.create(this._synapse, this._warmStorageService, {
      ...options,
      withCDN: effectiveWithCDN,
      withIpni: options?.withIpni ?? this._withIpni,
      dev: options?.dev ?? this._dev,
    })
  }

  /**
   * Get or create the default context
   */
  async getDefaultContext(): Promise<StorageContext> {
    return await this.createContext()
  }

  /**
   * Query data sets for this client
   * @param clientAddress - Optional client address, defaults to current signer
   * @returns Array of enhanced data set information including management status
   */
  async findDataSets(clientAddress?: string): Promise<EnhancedDataSetInfo[]> {
    const address = clientAddress ?? (await this._synapse.getClient().getAddress())
    return await this._warmStorageService.getClientDataSetsWithDetails(address)
  }

  /**
   * Terminate a data set with given ID that belongs to the synapse signer.
   * This will also result in the removal of all pieces in the data set.
   * @param dataSetId - The ID of the data set to terminate
   * @returns Transaction response
   */
  async terminateDataSet(dataSetId: number): Promise<ethers.TransactionResponse> {
    return this._warmStorageService.terminateDataSet(this._synapse.getSigner(), dataSetId)
  }

  /**
   * Get comprehensive information about the storage service including
   * approved providers, pricing, contract addresses, and current allowances
   * @returns Complete storage service information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    try {
      // Helper function to get allowances with error handling
      const getOptionalAllowances = async (): Promise<StorageInfo['allowances']> => {
        try {
          const warmStorageAddress = this._synapse.getWarmStorageAddress()
          const approval = await this._synapse.payments.serviceApproval(warmStorageAddress, TOKENS.USDFC)
          return {
            service: warmStorageAddress,
            rateAllowance: approval.rateAllowance,
            lockupAllowance: approval.lockupAllowance,
            rateUsed: approval.rateUsed,
            lockupUsed: approval.lockupUsed,
          }
        } catch {
          // Return null if wallet not connected or any error occurs
          return null
        }
      }

      // Create SPRegistryService and ProviderResolver to get providers
      const registryAddress = this._warmStorageService.getServiceProviderRegistryAddress()
      const spRegistry = new SPRegistryService(this._synapse.getProvider(), registryAddress)
      const resolver = new ProviderResolver(this._warmStorageService, spRegistry)

      // Fetch all data in parallel for performance
      const [pricingData, providers, allowances] = await Promise.all([
        this._warmStorageService.getServicePrice(),
        resolver.getApprovedProviders(),
        getOptionalAllowances(),
      ])

      // Calculate pricing per different time units
      const epochsPerMonth = BigInt(pricingData.epochsPerMonth)

      // Calculate per-epoch pricing
      const noCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / epochsPerMonth
      const withCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthWithCDN) / epochsPerMonth

      // Calculate per-day pricing
      const noCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / TIME_CONSTANTS.DAYS_PER_MONTH
      const withCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthWithCDN) / TIME_CONSTANTS.DAYS_PER_MONTH

      // Filter out providers with zero addresses
      const validProviders = providers.filter((p: ProviderInfo) => p.serviceProvider !== ethers.ZeroAddress)

      const network = this._synapse.getNetwork()

      return {
        pricing: {
          noCDN: {
            perTiBPerMonth: BigInt(pricingData.pricePerTiBPerMonthNoCDN),
            perTiBPerDay: noCDNPerDay,
            perTiBPerEpoch: noCDNPerEpoch,
          },
          withCDN: {
            perTiBPerMonth: BigInt(pricingData.pricePerTiBPerMonthWithCDN),
            perTiBPerDay: withCDNPerDay,
            perTiBPerEpoch: withCDNPerEpoch,
          },
          tokenAddress: pricingData.tokenAddress,
          tokenSymbol: 'USDFC', // Hardcoded as we know it's always USDFC
        },
        providers: validProviders,
        serviceParameters: {
          network,
          epochsPerMonth,
          epochsPerDay: TIME_CONSTANTS.EPOCHS_PER_DAY,
          epochDuration: TIME_CONSTANTS.EPOCH_DURATION,
          minUploadSize: SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
          maxUploadSize: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
          warmStorageAddress: this._synapse.getWarmStorageAddress(),
          paymentsAddress: this._warmStorageService.getPaymentsAddress(),
          pdpVerifierAddress: this._warmStorageService.getPDPVerifierAddress(),
        },
        allowances,
      }
    } catch (error) {
      throw new Error(
        `Failed to get storage service information: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }
}
