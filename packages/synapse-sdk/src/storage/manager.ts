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

import * as Piece from '@filoz/synapse-core/piece'
import { asPieceCID, downloadAndValidate } from '@filoz/synapse-core/piece'
import { randIndex } from '@filoz/synapse-core/utils'
import { ethers } from 'ethers'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CreateContextsOptions,
  DownloadOptions,
  EnhancedDataSetInfo,
  PieceCID,
  PieceRetriever,
  PreflightInfo,
  ProviderInfo,
  StorageContextCallbacks,
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
import type { WarmStorageService } from '../warm-storage/index.ts'
import { StorageContext } from './context.ts'

// Combined callbacks type that can include both creation and upload callbacks
type CombinedCallbacks = StorageContextCallbacks & UploadCallbacks

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
 */
export interface StorageManagerUploadOptions extends StorageServiceOptions {
  // Multiple storage providers: if provided, all other context options are invalid
  contexts?: StorageContext[]

  // Context routing - if provided, all other context options are invalid
  context?: StorageContext

  // Callbacks that can include both creation and upload callbacks
  callbacks?: Partial<CombinedCallbacks>

  /** Optional pre-calculated PieceCID to skip CommP calculation (BYO PieceCID, it will be checked by the server) */
  pieceCid?: PieceCID

  /** Optional AbortSignal to cancel the upload */
  signal?: AbortSignal
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
  private _defaultContexts?: StorageContext[]

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
   * Uses the storage contexts or context provided in the options
   * Otherwise creates/reuses default context
   *
   * Accepts Uint8Array or ReadableStream<Uint8Array>.
   * For large files, prefer streaming to minimize memory usage.
   *
   * Note: Multi-context uploads (uploading to multiple providers simultaneously) currently
   * only support Uint8Array. For streaming uploads with multiple contexts, convert your
   * stream to Uint8Array first or use stream forking (future feature).
   */
  async upload(
    data: Uint8Array | ReadableStream<Uint8Array>,
    options?: StorageManagerUploadOptions
  ): Promise<UploadResult> {
    // Validate options - if context is provided, no other options should be set
    if (options?.context != null || options?.contexts != null) {
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

    if (options?.contexts != null && options.contexts.length > 0) {
      if (options?.context != null) {
        throw createError('StorageManager', 'upload', "Cannot specify both 'context' and 'contexts'")
      }
    }

    // Get the context to use
    const contexts =
      options?.contexts ??
      (options?.context
        ? [options.context]
        : await this.createContexts({
            withCDN: options?.withCDN,
            withIpni: options?.withIpni,
            count: 1, // single context by default for now - this will be changed in a future version
            dev: options?.dev,
            uploadBatchSize: options?.uploadBatchSize,
            forceCreateDataSets: options?.forceCreateDataSet,
            metadata: options?.metadata,
            excludeProviderIds: options?.excludeProviderIds,
            providerIds: options?.providerId ? [options.providerId] : undefined,
            dataSetIds: options?.dataSetId ? [options.dataSetId] : undefined,
            callbacks: options?.callbacks,
          }))

    // Multi-context upload handling
    if (contexts.length > 1) {
      // Multi-context uploads require Uint8Array to calculate pieceCid once
      if (!(data instanceof Uint8Array)) {
        throw createError(
          'StorageManager',
          'upload',
          'Multi-context uploads currently only support Uint8Array. ' +
            'For streaming uploads to multiple providers, convert your stream to Uint8Array first.'
        )
      }

      // Calculate pieceCid once for all contexts
      const pieceCid = Piece.calculate(data)

      // Upload to all contexts with the same pieceCid
      return Promise.all(
        contexts.map((context) =>
          context.upload(data, {
            ...options?.callbacks, // TODO: callbacks should be able to differentiate by provider
            metadata: options?.metadata,
            pieceCid,
            signal: options?.signal,
          })
        )
      ).then((results) => results[0]) // all results should be the same
    } else {
      // Single context upload - supports all data types
      const context = contexts[0]

      // Upload to single context
      return context.upload(data, {
        ...options?.callbacks,
        metadata: options?.metadata,
        signal: options?.signal,
      })
    }
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
    if (this._defaultContexts != null && !withCDN && options?.providerAddress == null) {
      // from the default contexts, select a random storage provider that has the piece
      const contextsWithoutCDN = this._defaultContexts.filter((context) => context.withCDN === false)
      const contextsHavePiece = await Promise.all(contextsWithoutCDN.map((context) => context.hasPiece(parsedPieceCID)))
      const defaultContextsWithPiece = contextsWithoutCDN.filter((_context, i) => contextsHavePiece[i])
      if (defaultContextsWithPiece.length > 0) {
        options = {
          ...options,
          providerAddress:
            defaultContextsWithPiece[randIndex(defaultContextsWithPiece.length)].provider.serviceProvider,
        }
      }
    }

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
   * Creates storage contexts for multi-provider storage deals and other operations.
   *
   * By storing data with multiple independent providers, you reduce dependency on any
   * single provider and improve overall data availability. Use contexts together as a group.
   *
   * Contexts are selected by priority:
   * 1. Specified datasets (`dataSetIds`) - uses their existing providers
   * 2. Specified providers (`providerIds` or `providerAddresses`) - finds or creates matching datasets
   * 3. Automatically selected from remaining approved providers
   *
   * For automatic selection, existing datasets matching the `metadata` are reused unless
   * `forceCreateDataSets` is true. Providers are randomly chosen to distribute across the network.
   *
   * @param synapse - Synapse instance
   * @param warmStorageService - Warm storage service instance
   * @param options - Configuration options
   * @param options.count - Maximum number of contexts to create (default: 2)
   * @param options.dataSetIds - Specific dataset IDs to include
   * @param options.providerIds - Specific provider IDs to use
   * @param options.metadata - Metadata to match when finding/creating datasets
   * @param options.forceCreateDataSets - Always create new datasets instead of reusing existing ones
   * @param options.excludeProviderIds - Provider IDs to skip during selection
   * @returns Promise resolving to array of storage contexts
   */
  async createContexts(options?: CreateContextsOptions): Promise<StorageContext[]> {
    const withCDN = options?.withCDN ?? this._withCDN
    const canUseDefault =
      options == null ||
      (options.providerIds == null &&
        options.dataSetIds == null &&
        options.forceCreateDataSets !== true &&
        options.uploadBatchSize == null)
    if (this._defaultContexts != null) {
      const expectedSize = options?.count ?? 2
      if (
        this._defaultContexts.length === expectedSize &&
        this._defaultContexts.every((context) => options?.excludeProviderIds?.includes(context.provider.id) !== true)
      ) {
        const requestedMetadata = combineMetadata(options?.metadata, withCDN)
        if (
          this._defaultContexts.every((defaultContext) =>
            metadataMatches(defaultContext.dataSetMetadata, requestedMetadata)
          )
        ) {
          if (options?.callbacks != null) {
            for (const defaultContext of this._defaultContexts) {
              try {
                options.callbacks.onProviderSelected?.(defaultContext.provider)
              } catch (error) {
                console.error('Error in onProviderSelected callback:', error)
              }

              if (defaultContext.dataSetId != null) {
                try {
                  options.callbacks.onDataSetResolved?.({
                    isExisting: true, // Always true for cached context
                    dataSetId: defaultContext.dataSetId,
                    provider: defaultContext.provider,
                  })
                } catch (error) {
                  console.error('Error in onDataSetResolved callback:', error)
                }
              }
            }
          }
          return this._defaultContexts
        }
      }
    }

    const contexts = await StorageContext.createContexts(this._synapse, this._warmStorageService, {
      ...options,
      withCDN,
      withIpni: options?.withIpni ?? this._withIpni,
      dev: options?.dev ?? this._dev,
    })

    if (canUseDefault) {
      this._defaultContexts = contexts
    }

    return contexts
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

    if (canUseDefault && this._defaultContexts != null) {
      // Check if we have a default context with compatible metadata

      const requestedMetadata = combineMetadata(options?.metadata, effectiveWithCDN)
      for (const defaultContext of this._defaultContexts) {
        if (options?.excludeProviderIds?.includes(defaultContext.provider.id)) {
          continue
        }
        // Check if the requested metadata matches what the default context was created with
        if (!metadataMatches(defaultContext.dataSetMetadata, requestedMetadata)) {
          continue
        }
        // Fire callbacks for cached context to ensure consistent behavior
        if (options?.callbacks != null) {
          try {
            options.callbacks.onProviderSelected?.(defaultContext.provider)
          } catch (error) {
            console.error('Error in onProviderSelected callback:', error)
          }

          if (defaultContext.dataSetId != null) {
            try {
              options.callbacks.onDataSetResolved?.({
                isExisting: true, // Always true for cached context
                dataSetId: defaultContext.dataSetId,
                provider: defaultContext.provider,
              })
            } catch (error) {
              console.error('Error in onDataSetResolved callback:', error)
            }
          }
        }
        return defaultContext
      }
    }

    // Create a new context with specific options
    const context = await StorageContext.create(this._synapse, this._warmStorageService, {
      ...options,
      withCDN: effectiveWithCDN,
      withIpni: options?.withIpni ?? this._withIpni,
      dev: options?.dev ?? this._dev,
    })

    if (canUseDefault) {
      this._defaultContexts = [context]
    }
    return context
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
            // Forward whether operator is approved so callers can react accordingly
            isApproved: approval.isApproved,
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

      // Create SPRegistryService to get providers
      const registryAddress = this._warmStorageService.getServiceProviderRegistryAddress()
      const spRegistry = new SPRegistryService(this._synapse.getProvider(), registryAddress)

      // Fetch all data in parallel for performance
      const [pricingData, approvedIds, allowances] = await Promise.all([
        this._warmStorageService.getServicePrice(),
        this._warmStorageService.getApprovedProviderIds(),
        getOptionalAllowances(),
      ])

      // Get provider details for approved IDs
      const providers = await spRegistry.getProviders(approvedIds)

      // Calculate pricing per different time units
      const epochsPerMonth = BigInt(pricingData.epochsPerMonth)

      // TODO: StorageInfo needs updating to reflect that CDN costs are usage-based

      // Calculate per-epoch pricing (base storage cost)
      const noCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / epochsPerMonth
      // CDN costs are usage-based (egress charges), so base storage cost is the same
      const withCDNPerEpoch = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / epochsPerMonth

      // Calculate per-day pricing (base storage cost)
      const noCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / TIME_CONSTANTS.DAYS_PER_MONTH
      // CDN costs are usage-based (egress charges), so base storage cost is the same
      const withCDNPerDay = BigInt(pricingData.pricePerTiBPerMonthNoCDN) / TIME_CONSTANTS.DAYS_PER_MONTH

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
          // CDN costs are usage-based (egress charges), base storage cost is the same
          withCDN: {
            perTiBPerMonth: BigInt(pricingData.pricePerTiBPerMonthNoCDN),
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
