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
import { asPieceCID, downloadAndValidate } from '../piece/index.js'
import { SPRegistryService } from '../sp-registry/index.js'
import type { Synapse } from '../synapse.js'
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
} from '../types.js'
import { createError, SIZE_CONSTANTS, TIME_CONSTANTS, TOKENS } from '../utils/index.js'
import { ProviderResolver } from '../utils/provider-resolver.js'
import type { WarmStorageService } from '../warm-storage/index.js'
import { StorageContext } from './context.js'

// Combined callbacks type that can include both creation and upload callbacks
type CombinedCallbacks = StorageCreationCallbacks & UploadCallbacks

interface StorageManagerUploadOptions {
  // Context routing
  context?: StorageContext
  // OR auto-context options (from StorageServiceOptions)
  providerId?: number
  providerAddress?: string
  dataSetId?: number
  withCDN?: boolean
  forceCreateDataSet?: boolean
  uploadBatchSize?: number
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
  private _defaultContext?: StorageContext

  constructor(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    pieceRetriever: PieceRetriever,
    withCDN: boolean
  ) {
    this._synapse = synapse
    this._warmStorageService = warmStorageService
    this._pieceRetriever = pieceRetriever
    this._withCDN = withCDN
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
    const context =
      options?.context ??
      (await this.createContext({
        providerId: options?.providerId,
        providerAddress: options?.providerAddress,
        dataSetId: options?.dataSetId,
        withCDN: options?.withCDN,
        forceCreateDataSet: options?.forceCreateDataSet,
        uploadBatchSize: options?.uploadBatchSize,
        callbacks: options?.callbacks,
      }))

    // Upload using the context
    return await context.upload(data, options?.callbacks)
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
    const clientAddress = await this._synapse.getSigner().getAddress()

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
   * @param options - Optional settings including withCDN flag
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload(size: number, options?: { withCDN?: boolean }): Promise<PreflightInfo> {
    // Use withCDN setting: option > manager default
    const withCDN = options?.withCDN ?? this._withCDN

    // Use the static method from StorageContext for core logic
    return await StorageContext.performPreflightCheck(size, withCDN, this._warmStorageService, this._synapse.payments)
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
    // 2. Only withCDN and/or callbacks are provided (callbacks can fire for cached context)
    const canUseDefault =
      options == null ||
      (options.providerId == null &&
        options.providerAddress == null &&
        options.dataSetId == null &&
        options.forceCreateDataSet !== true &&
        options.uploadBatchSize == null)

    if (canUseDefault) {
      // Check if we have a default context with matching CDN setting
      if (this._defaultContext != null) {
        // Check if the CDN setting matches
        const defaultHasCDN = (this._defaultContext as any).withCDN ?? this._withCDN
        if (defaultHasCDN === effectiveWithCDN) {
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
        withCDN: effectiveWithCDN,
        callbacks: options?.callbacks,
      })
      this._defaultContext = context
      return context
    }

    // Create a new context with specific options (not cached)
    return await StorageContext.create(this._synapse, this._warmStorageService, {
      ...options,
      withCDN: effectiveWithCDN,
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
    const address = clientAddress ?? (await this._synapse.getSigner().getAddress())
    return await this._warmStorageService.getClientDataSetsWithDetails(address)
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
      const validProviders = providers.filter((p: ProviderInfo) => p.address !== ethers.ZeroAddress)

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
