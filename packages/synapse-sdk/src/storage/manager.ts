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
 * await synapse.storage.download({ pieceCid })
 *
 * // Explicit context
 * const context = await synapse.storage.createContext({ providerId: 1 })
 * await context.upload(data)
 *
 * // Context routing
 * await synapse.storage.upload(data, { contexts: [ctx1, ctx2] })
 * ```
 */

import { asPieceCID, downloadAndValidate } from '@filoz/synapse-core/piece'
import type { UploadPieceStreamingData } from '@filoz/synapse-core/sp'
import { randIndex } from '@filoz/synapse-core/utils'
import { type Address, type Hash, type Hex, zeroAddress } from 'viem'
import { CommitError, StoreError } from '../errors/storage.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CopyResult,
  CreateContextsOptions,
  DownloadOptions,
  EnhancedDataSetInfo,
  FailedCopy,
  PDPProvider,
  PieceCID,
  PieceRetriever,
  PreflightInfo,
  PullStatus,
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
} from '../utils/index.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'
import { StorageContext } from './context.ts'

// Multi-copy upload constants
const MAX_SECONDARY_ATTEMPTS = 5
const DEFAULT_COPY_COUNT = 2

/**
 * Safely invoke a user-provided callback without interrupting flow.
 * Logs a warning if the callback throws.
 */
function safeInvoke<T extends unknown[]>(fn: ((...args: T) => void) | undefined, ...args: T): void {
  if (fn == null) return
  try {
    fn(...args)
  } catch (error) {
    console.warn('Callback error (ignored):', error instanceof Error ? error.message : error)
  }
}

/**
 * Combined callbacks for StorageManager.upload().
 *
 * Lifecycle stages:
 * - Context creation: onProviderSelected, onDataSetResolved  (from StorageContextCallbacks)
 * - Store (primary):  onProgress, onStored                   (from UploadCallbacks)
 * - Pull (secondary): onPullProgress, onCopyComplete, onCopyFailed
 * - Commit:           onPiecesAdded, onPiecesConfirmed
 */
export type CombinedCallbacks = StorageContextCallbacks & UploadCallbacks

/**
 * Upload options for StorageManager.upload()
 *
 * Extends CreateContextsOptions to inherit multi-copy provider selection.
 * Adds upload-specific options: explicit contexts, pre-calculated PieceCID, and abort signal.
 *
 * Usage patterns:
 * 1. With explicit contexts: `{ contexts }` - uses the given contexts directly
 * 2. Auto-create contexts: `{ providerIds?, dataSetIds?, count? }` - creates/reuses contexts
 * 3. Use default contexts: no options - uses cached default contexts (2 copies)
 */
export interface StorageManagerUploadOptions extends CreateContextsOptions {
  /** Pre-created contexts to use. If provided, other selection options are invalid. */
  contexts?: StorageContext[]

  /** Callbacks for both context creation and upload lifecycle */
  callbacks?: Partial<CombinedCallbacks>

  /** Optional pre-calculated PieceCID to skip CommP calculation (verified by server) */
  pieceCid?: PieceCID

  /** Optional AbortSignal to cancel the upload */
  signal?: AbortSignal

  /** Custom metadata for pieces being uploaded (key-value pairs) */
  pieceMetadata?: Record<string, string>
}

export interface StorageManagerDownloadOptions extends DownloadOptions {
  context?: StorageContext
  providerAddress?: Address
}

export interface StorageManagerOptions {
  /** The Synapse instance */
  synapse: Synapse
  /** The WarmStorageService instance */
  warmStorageService: WarmStorageService
  /** The PieceRetriever instance */
  pieceRetriever: PieceRetriever
  /** Whether to enable CDN services */
  withCDN: boolean
}

export class StorageManager {
  private readonly _synapse: Synapse
  private readonly _warmStorageService: WarmStorageService
  private readonly _pieceRetriever: PieceRetriever
  private readonly _withCDN: boolean
  private _defaultContexts?: StorageContext[]

  /**
   * Creates a new StorageManager
   * @param options - The options for the StorageManager {@link StorageManagerOptions}
   */
  constructor(options: StorageManagerOptions) {
    this._synapse = options.synapse
    this._warmStorageService = options.warmStorageService
    this._pieceRetriever = options.pieceRetriever
    this._withCDN = options.withCDN
  }

  /**
   * Upload data to Filecoin Onchain Cloud using a store->pull->commit flow across
   * multiple providers.
   *
   * By default, uploads to 2 providers (primary + secondary) for redundancy.
   * Data is uploaded once to the primary, then secondaries pull from the primary
   * via SP-to-SP transfer.
   *
   * This method only throws if zero copies succeed. Individual copy failures
   * are recorded in `result.failures`. Always check `result.copies.length`
   * against your requested count.
   *
   * For large files, prefer streaming to minimize memory usage.
   *
   * For uploading multiple files, use the split operations API directly:
   * createContexts() -> store() -> presignForCommit() -> pull() -> commit()
   *
   * @param data - Raw bytes (Uint8Array) or ReadableStream to upload
   * @param options - Upload options including contexts, callbacks, and abort signal
   * @returns Upload result with pieceCid, size, copies array, and failures array
   * @throws StoreError if primary store fails (before any data is committed)
   * @throws CommitError if all commit attempts fail (data stored but not on-chain)
   */
  async upload(data: UploadPieceStreamingData, options?: StorageManagerUploadOptions): Promise<UploadResult> {
    const { contexts, explicitProviders } = await this._resolveUploadContexts(options)
    const [primary, ...secondaries] = contexts

    // Store on primary provider
    let storeResult: { pieceCid: PieceCID; size: number }
    try {
      storeResult = await primary.store(data, {
        pieceCid: options?.pieceCid,
        signal: options?.signal,
        onProgress: options?.callbacks?.onProgress,
      })
      safeInvoke(options?.callbacks?.onStored, primary.provider.id, storeResult.pieceCid)
    } catch (error) {
      throw new StoreError(
        `Failed to store on primary provider ${primary.provider.id} (${primary.provider.pdp.serviceURL})`,
        {
          cause: error instanceof Error ? error : undefined,
          providerId: primary.provider.id,
          endpoint: primary.provider.pdp.serviceURL,
        }
      )
    }

    const pieceInputs = [{ pieceCid: storeResult.pieceCid, pieceMetadata: options?.pieceMetadata }]

    // Pull to secondaries via SP-to-SP transfer
    let successfulSecondaries: StorageContext[] = []
    let pullFailures: FailedCopy[] = []
    let extraDataMap = new Map<StorageContext, Hex>()

    if (secondaries.length > 0) {
      const pullResult = await this._pullToSecondariesWithRetry(primary, secondaries, [storeResult.pieceCid], {
        explicitProviders,
        signal: options?.signal,
        withCDN: options?.withCDN,
        metadata: options?.metadata,
        pieceMetadata: options?.pieceMetadata,
        callbacks: options?.callbacks,
        onProgress: options?.callbacks?.onPullProgress,
        onSuccess: options?.callbacks?.onCopyComplete,
        onFailure: options?.callbacks?.onCopyFailed,
        pieceInputs,
      })
      successfulSecondaries = pullResult.successful
      pullFailures = pullResult.failures
      extraDataMap = pullResult.extraDataMap
    }

    // Commit on all providers in parallel
    const commitPromises = [
      { ctx: primary, role: 'primary' as const },
      ...successfulSecondaries.map((ctx) => ({ ctx, role: 'secondary' as const })),
    ].map(async ({ ctx, role }) => {
      const result = await ctx.commit({
        pieces: pieceInputs,
        extraData: extraDataMap.get(ctx),
        onSubmitted: (txHash) =>
          safeInvoke(options?.callbacks?.onPiecesAdded, txHash, ctx.provider.id, [{ pieceCid: storeResult.pieceCid }]),
      })
      return { ctx, role, result }
    })

    const commitResults = await Promise.allSettled(commitPromises)

    // Process commit results — failures are recorded, throw only if all fail
    type CommitResultType = { txHash: string; pieceIds: bigint[]; dataSetId: bigint; isNewDataSet: boolean }
    let primaryCommit: CommitResultType | undefined
    let primaryCommitError: Error | undefined
    const secondaryCommits: Array<{ context: StorageContext; result: CommitResultType }> = []
    const commitFailedSecondaryIds: Set<bigint> = new Set()

    for (const settled of commitResults) {
      if (settled.status === 'fulfilled') {
        const { ctx, role, result } = settled.value
        if (role === 'primary') {
          primaryCommit = result
        } else {
          secondaryCommits.push({ context: ctx, result })
        }
      } else {
        const failedIndex = commitResults.indexOf(settled)
        if (failedIndex === 0) {
          primaryCommitError = settled.reason instanceof Error ? settled.reason : new Error(String(settled.reason))
        } else {
          // Data is already on this SP (pull succeeded) but commit failed.
          // A targeted addPieces retry could recover without re-uploading.
          // Not currently implemented; the piece will be GC'd by the SP.
          const failedSecondary = successfulSecondaries[failedIndex - 1]
          commitFailedSecondaryIds.add(failedSecondary.provider.id)
        }
      }
    }

    // Build result
    const copies: CopyResult[] = []

    if (primaryCommit) {
      copies.push({
        providerId: primary.provider.id,
        dataSetId: primaryCommit.dataSetId,
        pieceId: primaryCommit.pieceIds[0],
        role: 'primary',
        retrievalUrl: primary.getPieceUrl(storeResult.pieceCid),
        isNewDataSet: primaryCommit.isNewDataSet,
      })
    }

    for (const { context, result } of secondaryCommits) {
      copies.push({
        providerId: context.provider.id,
        dataSetId: result.dataSetId,
        pieceId: result.pieceIds[0],
        role: 'secondary',
        retrievalUrl: context.getPieceUrl(storeResult.pieceCid),
        isNewDataSet: result.isNewDataSet,
      })
    }

    // Throw if no copies succeeded
    if (copies.length === 0) {
      throw new CommitError(
        `Failed to commit on primary provider ${primary.provider.id} (${primary.provider.pdp.serviceURL}) - data is stored but not on-chain`,
        {
          cause: primaryCommitError,
          providerId: primary.provider.id,
          endpoint: primary.provider.pdp.serviceURL,
        }
      )
    }

    // Fire onPiecesConfirmed callbacks for successful commits
    if (primaryCommit) {
      safeInvoke(options?.callbacks?.onPiecesConfirmed, primaryCommit.dataSetId, primary.provider.id, [
        { pieceId: primaryCommit.pieceIds[0], pieceCid: storeResult.pieceCid },
      ])
    }
    for (const { context, result } of secondaryCommits) {
      safeInvoke(options?.callbacks?.onPiecesConfirmed, result.dataSetId, context.provider.id, [
        { pieceId: result.pieceIds[0], pieceCid: storeResult.pieceCid },
      ])
    }

    // Build failures list
    const failures: FailedCopy[] = [...pullFailures]
    const pullFailedIds = new Set(pullFailures.map((f) => f.providerId))

    if (primaryCommitError && !pullFailedIds.has(primary.provider.id)) {
      failures.push({
        providerId: primary.provider.id,
        role: 'primary',
        error: 'Commit failed',
        explicit: explicitProviders,
      })
    }

    for (const failedId of commitFailedSecondaryIds) {
      if (!pullFailedIds.has(failedId)) {
        failures.push({
          providerId: failedId,
          role: 'secondary',
          error: 'Commit failed',
          explicit: explicitProviders,
        })
      }
    }

    return { pieceCid: storeResult.pieceCid, size: storeResult.size, copies, failures }
  }

  /**
   * Resolve and validate upload contexts from options.
   * Handles contexts passthrough, option validation, and context creation.
   */
  private async _resolveUploadContexts(options?: StorageManagerUploadOptions): Promise<{
    contexts: StorageContext[]
    explicitProviders: boolean
  }> {
    if (options?.contexts != null) {
      const invalidOptions = []
      if (options.providerIds !== undefined) invalidOptions.push('providerIds')
      if (options.dataSetIds !== undefined) invalidOptions.push('dataSetIds')
      if (options.withCDN !== undefined) invalidOptions.push('withCDN')

      if (invalidOptions.length > 0) {
        throw createError(
          'StorageManager',
          'upload',
          `Cannot specify both 'contexts' and other options: ${invalidOptions.join(', ')}`
        )
      }
    }

    // Explicit providers disables auto-retry on failure
    const explicitProviders =
      options?.contexts != null ||
      (options?.providerIds != null && options.providerIds.length > 0) ||
      (options?.dataSetIds != null && options.dataSetIds.length > 0)

    const contexts =
      options?.contexts ??
      (await this.createContexts({
        withCDN: options?.withCDN,
        count: options?.count ?? DEFAULT_COPY_COUNT,
        metadata: options?.metadata,
        excludeProviderIds: options?.excludeProviderIds,
        providerIds: options?.providerIds,
        dataSetIds: options?.dataSetIds,
        callbacks: options?.callbacks,
      }))

    return { contexts, explicitProviders }
  }

  /**
   * Pull pieces from primary to secondaries with retry logic.
   *
   * For each secondary: attempt pull, and if failed with non-explicit providers,
   * try a replacement provider up to MAX_SECONDARY_ATTEMPTS times.
   */
  private async _pullToSecondariesWithRetry(
    primary: StorageContext,
    secondaries: StorageContext[],
    pieceCids: PieceCID[],
    options: {
      explicitProviders: boolean
      signal?: AbortSignal
      withCDN?: boolean
      metadata?: Record<string, string>
      pieceMetadata?: Record<string, string>
      callbacks?: Partial<CombinedCallbacks>
      onProgress?: (providerId: bigint, pieceCid: PieceCID, status: PullStatus) => void
      onSuccess?: (providerId: bigint, pieceCid: PieceCID) => void
      onFailure?: (providerId: bigint, pieceCid: PieceCID, error: Error) => void
      pieceInputs?: Array<{ pieceCid: PieceCID; pieceMetadata?: Record<string, string> }>
    }
  ): Promise<{ successful: StorageContext[]; failures: FailedCopy[]; extraDataMap: Map<StorageContext, Hex> }> {
    const usedProviderIds = new Set<bigint>([primary.provider.id, ...secondaries.map((s) => s.provider.id)])
    const successful: StorageContext[] = []
    const failures: FailedCopy[] = []
    const extraDataMap = new Map<StorageContext, Hex>()

    for (let i = 0; i < secondaries.length; i++) {
      let currentSecondary = secondaries[i]
      let attempts = 0
      let succeeded = false

      while (!succeeded && attempts < MAX_SECONDARY_ATTEMPTS) {
        try {
          // Pre-sign extraData so the same blob is reused for commit
          let extraData: Hex | undefined
          if (options.pieceInputs) {
            extraData = await currentSecondary.presignForCommit(options.pieceInputs)
          }

          const providerId = currentSecondary.provider.id
          const pullResult = await currentSecondary.pull({
            pieces: pieceCids,
            from: primary,
            signal: options.signal,
            extraData,
            onProgress: options.onProgress
              ? (cid, status) => safeInvoke(options.onProgress, providerId, cid, status)
              : undefined,
          })

          if (pullResult.status === 'complete') {
            succeeded = true
            successful.push(currentSecondary)
            if (extraData) {
              extraDataMap.set(currentSecondary, extraData)
            }

            for (const pieceCid of pieceCids) {
              safeInvoke(options.onSuccess, providerId, pieceCid)
            }
          } else {
            const failedPieces = pullResult.pieces.filter((p) => p.status !== 'complete')
            const errorMsg =
              failedPieces.length > 0
                ? `Pull failed for ${failedPieces.length} piece(s): ${failedPieces.map((p) => p.pieceCid).join(', ')}`
                : 'Pull failed'
            failures.push({
              providerId,
              role: 'secondary',
              error: errorMsg,
              explicit: options.explicitProviders,
            })
            const err = new Error(errorMsg)
            for (const pieceCid of pieceCids) {
              safeInvoke(options.onFailure, providerId, pieceCid, err)
            }
          }
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error)
          failures.push({
            providerId: currentSecondary.provider.id,
            role: 'secondary',
            error: errorMsg,
            explicit: options.explicitProviders,
          })
          const err = error instanceof Error ? error : new Error(errorMsg)
          for (const pieceCid of pieceCids) {
            safeInvoke(options.onFailure, currentSecondary.provider.id, pieceCid, err)
          }
        }

        attempts++

        // If failed and not explicit, try to get a replacement provider
        if (!succeeded && !options.explicitProviders && attempts < MAX_SECONDARY_ATTEMPTS) {
          try {
            const [newContext] = await this.createContexts({
              withCDN: options.withCDN,
              count: 1,
              metadata: options.metadata,
              callbacks: options.callbacks,
              excludeProviderIds: [...usedProviderIds],
            })
            currentSecondary = newContext
            usedProviderIds.add(newContext.provider.id)
          } catch {
            // No more providers available
            break
          }
        } else if (!succeeded && options.explicitProviders) {
          break
        }
      }
    }

    return { successful, failures, extraDataMap }
  }

  /**
   * Download data from storage
   * If context is provided, routes to context.download()
   * Otherwise performs SP-agnostic download
   */
  async download(options: StorageManagerDownloadOptions): Promise<Uint8Array> {
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
      return await options.context.download({
        pieceCid: options.pieceCid,
        withCDN: options.withCDN ?? this._withCDN,
      })
    }

    // SP-agnostic download with fast path optimization
    const parsedPieceCID = asPieceCID(options.pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageManager', 'download', `Invalid PieceCID: ${String(options.pieceCid)}`)
    }

    // Use withCDN setting: option > manager default > synapse default
    const withCDN = options?.withCDN ?? this._withCDN

    let finalProviderAddress: Address | undefined = options?.providerAddress
    // Fast path: If we have a default context with CDN disabled and no specific provider requested,
    // check if the piece exists on the default context's provider first
    if (this._defaultContexts != null && !withCDN && finalProviderAddress == null) {
      // from the default contexts, select a random storage provider that has the piece
      const contextsWithoutCDN = this._defaultContexts.filter((context) => context.withCDN === false)
      const contextsHavePiece = await Promise.all(
        contextsWithoutCDN.map((context) => context.hasPiece({ pieceCid: parsedPieceCID }))
      )
      const defaultContextsWithPiece = contextsWithoutCDN.filter((_context, i) => contextsHavePiece[i])
      if (defaultContextsWithPiece.length > 0) {
        finalProviderAddress =
          defaultContextsWithPiece[randIndex(defaultContextsWithPiece.length)].provider.serviceProvider
      }
    }

    const clientAddress = this._synapse.client.account.address

    // Use piece retriever to fetch
    const response = await this._pieceRetriever.fetchPiece({
      pieceCid: parsedPieceCID,
      client: clientAddress,
      providerAddress: finalProviderAddress,
      withCDN,
    })

    return await downloadAndValidate(response, parsedPieceCID)
  }

  /**
   * Run preflight checks for an upload without creating a context
   * @param options - The options for the preflight upload
   * @param options.size - The size of data to upload in bytes
   * @param options.withCDN - Whether to enable CDN services
   * @param options.metadata - The metadata for the preflight upload
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload(options: {
    size: number
    withCDN?: boolean
    metadata?: Record<string, string>
  }): Promise<PreflightInfo> {
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
    return await StorageContext.performPreflightCheck({
      warmStorageService: this._warmStorageService,
      size: options.size,
      withCDN,
    })
  }

  /**
   * Creates storage contexts for multi-provider storage deals and other operations.
   *
   * By storing data with multiple independent providers, you reduce dependency on any
   * single provider and improve overall data availability. Use contexts together as a group.
   *
   * Contexts are selected by priority:
   * 1. Specified datasets (`dataSetIds`) - uses their existing providers
   * 2. Specified providers (`providerIds`) - finds or creates matching datasets
   * 3. Automatically selected from remaining approved providers
   *
   * For automatic selection, existing datasets matching the `metadata` are reused.
   * Providers are randomly chosen to distribute across the network.
   *
   * @param options - Configuration options {@link CreateContextsOptions}
   * @param options.count - Maximum number of contexts to create (default: 2)
   * @param options.dataSetIds - Specific dataset IDs to include
   * @param options.providerIds - Specific provider IDs to use
   * @param options.metadata - Metadata to match when finding/creating datasets
   * @param options.excludeProviderIds - Provider IDs to skip during selection
   * @returns Promise resolving to array of storage contexts
   */
  async createContexts(options?: CreateContextsOptions): Promise<StorageContext[]> {
    const withCDN = options?.withCDN ?? this._withCDN
    const canUseDefault = options == null || (options.providerIds == null && options.dataSetIds == null)
    if (this._defaultContexts != null) {
      const expectedSize = options?.count ?? DEFAULT_COPY_COUNT
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

    const contexts = await StorageContext.createContexts({
      synapse: this._synapse,
      warmStorageService: this._warmStorageService,
      ...options,
      withCDN,
    })

    if (canUseDefault) {
      this._defaultContexts = contexts
    }

    return contexts
  }

  /**
   * Create a single storage context with specified options
   */
  async createContext(options?: StorageServiceOptions): Promise<StorageContext> {
    // Determine the effective withCDN setting
    const effectiveWithCDN = options?.withCDN ?? this._withCDN

    // Check if we can return the default context
    // We can use the default if:
    // 1. No options provided, OR
    // 2. Only withCDN, metadata and/or callbacks are provided (callbacks can fire for cached context)
    const canUseDefault = options == null || (options.providerId == null && options.dataSetId == null)

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
    const context = await StorageContext.create({
      synapse: this._synapse,
      warmStorageService: this._warmStorageService,
      ...options,
      withCDN: effectiveWithCDN,
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
   * @param options - The options for the find data sets
   * @param options.address - The client address, defaults to current signer
   * @returns Array of enhanced data set information including management status
   */
  async findDataSets(options: { address?: Address } = {}): Promise<EnhancedDataSetInfo[]> {
    const { address = this._synapse.client.account.address } = options
    return await this._warmStorageService.getClientDataSetsWithDetails({ address })
  }

  /**
   * Terminate a data set with given ID that belongs to the synapse signer.
   * This will also result in the removal of all pieces in the data set.
   * @param options - The options for the terminate data set
   * @param options.dataSetId - The ID of the data set to terminate
   * @returns Transaction hash
   */
  async terminateDataSet(options: { dataSetId: bigint }): Promise<Hash> {
    return this._warmStorageService.terminateDataSet(options)
  }

  /**
   * Get comprehensive information about the storage service including
   * approved providers, pricing, contract addresses, and current allowances
   * @returns Complete storage service information
   */
  async getStorageInfo(): Promise<StorageInfo> {
    const chain = this._synapse.client.chain
    try {
      // Helper function to get allowances with error handling
      const getOptionalAllowances = async (): Promise<StorageInfo['allowances']> => {
        try {
          const approval = await this._synapse.payments.serviceApproval()
          return {
            service: chain.contracts.fwss.address,
            // Forward whether operator is approved so callers can react accordingly
            isApproved: approval.isApproved,
            rateAllowance: approval.rateAllowance,
            lockupAllowance: approval.lockupAllowance,
            rateUsed: approval.rateUsage,
            lockupUsed: approval.lockupUsage,
          }
        } catch {
          // Return null if wallet not connected or any error occurs
          return null
        }
      }

      // Create SPRegistryService to get providers
      const spRegistry = new SPRegistryService({ client: this._synapse.client })

      // Fetch all data in parallel for performance
      const [pricingData, approvedIds, allowances] = await Promise.all([
        this._warmStorageService.getServicePrice(),
        this._warmStorageService.getApprovedProviderIds(),
        getOptionalAllowances(),
      ])

      // Get provider details for approved IDs
      const providers = await spRegistry.getProviders({ providerIds: approvedIds })

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
      const validProviders = providers.filter((p: PDPProvider) => p.serviceProvider !== zeroAddress)

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
          epochsPerMonth,
          epochsPerDay: TIME_CONSTANTS.EPOCHS_PER_DAY,
          epochDuration: TIME_CONSTANTS.EPOCH_DURATION,
          minUploadSize: SIZE_CONSTANTS.MIN_UPLOAD_SIZE,
          maxUploadSize: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
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
