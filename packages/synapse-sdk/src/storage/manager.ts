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

import {
  calculateAccountDebt,
  isFwssMaxApproved,
  accounts as payAccounts,
  resolveAccountState,
} from '@filoz/synapse-core/pay'
import { getDataSetLeafCounts } from '@filoz/synapse-core/pdp-verifier'
import * as Piece from '@filoz/synapse-core/piece'
import type { UploadPieceStreamingData } from '@filoz/synapse-core/sp'
import { getPDPProviderByAddress } from '@filoz/synapse-core/sp-registry'
import { calculateUploadCosts } from '@filoz/synapse-core/utils'
import {
  getUploadCosts as coreGetUploadCosts,
  getDataSetsById,
  getPriceList,
  metadataMatches,
} from '@filoz/synapse-core/warm-storage'
import { type Address, type Hex, UserRejectedRequestError, zeroAddress } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { CommitError, StoreError } from '../errors/storage.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CopyResult,
  CreateContextsOptions,
  DownloadOptions,
  EnhancedDataSetInfo,
  FailedAttempt,
  GetUploadCostsOptions,
  PDPProvider,
  PieceCID,
  PrepareOptions,
  PrepareResult,
  PullStatus,
  StorageContextCallbacks,
  StorageInfo,
  StorageServiceOptions,
  TerminateServiceOptions,
  TerminateServiceResult,
  UploadCallbacks,
  UploadCosts,
  UploadResult,
} from '../types.ts'
import { combineMetadata, createError, SIZE_CONSTANTS, TIME_CONSTANTS } from '../utils/index.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'
import { StorageContext } from './context.ts'
import {
  type BatchedCommitResult,
  type BatchingHold,
  getPieceBatchingService,
  type PieceBatchingService,
} from './piece-batching.ts'
import { terminateServiceFlow } from './terminate.ts'

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
 * 2. Auto-create contexts: `{ providerIds?, dataSetIds?, copies? }` - creates/reuses contexts
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
  /** Whether to enable CDN services */
  withCDN: boolean
  /** Application identifier for namespace isolation */
  source: string | null
}

export class StorageManager {
  private readonly _synapse: Synapse
  private readonly _warmStorageService: WarmStorageService
  private readonly _withCDN: boolean
  private readonly _source: string | null
  private _defaultContexts?: StorageContext[]

  /**
   * Creates a new StorageManager
   * @param options - The options for the StorageManager {@link StorageManagerOptions}
   */
  constructor(options: StorageManagerOptions) {
    this._synapse = options.synapse
    this._warmStorageService = options.warmStorageService
    this._withCDN = options.withCDN
    this._source = options.source
  }

  /**
   * The application source identifier used for dataset namespace isolation.
   * Set via `Synapse.create({ source })`. Used by `combineMetadata` to tag
   * datasets so that different applications sharing a wallet don't collide.
   */
  get source(): string | null {
    return this._source
  }

  /**
   * Whether CDN rails are enabled for new datasets by default.
   * Set via `Synapse.create({ withCDN })`.
   */
  get withCDN(): boolean {
    return this._withCDN
  }

  /**
   * Upload data to Filecoin Onchain Cloud using a store->pull->commit flow across
   * multiple providers.
   *
   * By default, uploads to 2 providers (primary + secondary) for redundancy.
   * Data is uploaded once to the primary, then secondaries pull from the primary
   * via SP-to-SP transfer.
   *
   * This method only throws if zero copies succeed. Partial success (some but
   * not all copies) is indicated by `result.complete === false`. Check `complete`
   * to determine overall success. Don't use `failedAttempts.length` as a failure
   * signal as `failedAttempts` exists as a diagnostic for intermediate failures.
   *
   * Batching is enabled by default. Compatible concurrent calls can share
   * on-chain transactions, while sequentially awaiting each call prevents those
   * uploads from joining the same batch.
   *
   * For large files, prefer streaming to minimize memory usage.
   *
   * For manual control over providers, signing, or individual phases, use the
   * split operations API directly:
   * createContexts() -> store() -> presignForCommit() -> pull() -> commit()
   *
   * @param data - Raw bytes (Uint8Array) or ReadableStream to upload
   * @param options - Upload options including contexts, callbacks, and abort signal
   * @returns Upload result with pieceCid, copies, and completion status
   * @throws StoreError if primary store fails (before any data is committed)
   * @throws CommitError if all commit attempts fail (data stored but not on-chain)
   */
  async upload(data: UploadPieceStreamingData, options?: StorageManagerUploadOptions): Promise<UploadResult> {
    const batching = getPieceBatchingService(this._synapse)
    if (batching != null) {
      return this._uploadBatched(data, options, batching, batching.hold())
    }

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
    let pullFailures: FailedAttempt[] = []
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
      pullFailures = pullResult.failedAttempts
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

    // Build failed attempts list
    const failedAttempts: FailedAttempt[] = [...pullFailures]
    const pullFailedIds = new Set(pullFailures.map((f) => f.providerId))

    if (primaryCommitError && !pullFailedIds.has(primary.provider.id)) {
      failedAttempts.push({
        providerId: primary.provider.id,
        role: 'primary',
        error: 'Commit failed',
        explicit: explicitProviders,
      })
    }

    for (const failedId of commitFailedSecondaryIds) {
      if (!pullFailedIds.has(failedId)) {
        failedAttempts.push({
          providerId: failedId,
          role: 'secondary',
          error: 'Commit failed',
          explicit: explicitProviders,
        })
      }
    }

    const requestedCopies = contexts.length
    return {
      pieceCid: storeResult.pieceCid,
      size: storeResult.size,
      requestedCopies,
      complete: copies.length >= requestedCopies,
      copies,
      failedAttempts,
    }
  }

  /**
   * Submit all piece-batch windows currently accepted by this Synapse instance.
   *
   * Waits for in-progress uploads and pulls to finish parking before submitting
   * their pending windows. Resolving does not mean every upload was submitted or
   * confirmed successfully; failures are reported by the individual upload
   * promises, which callers must also await. This is a no-op when batching is
   * disabled.
   */
  async flush(): Promise<void> {
    await getPieceBatchingService(this._synapse)?.flush()
  }

  private async _uploadBatched(
    data: UploadPieceStreamingData,
    options: StorageManagerUploadOptions | undefined,
    batching: PieceBatchingService,
    hold: BatchingHold
  ): Promise<UploadResult> {
    let resolved: { contexts: StorageContext[]; explicitProviders: boolean }
    try {
      resolved = await this._resolveUploadContexts(options)
    } catch (error) {
      hold.release()
      throw error
    }
    const { contexts, explicitProviders } = resolved
    const [primary, ...secondaries] = contexts
    const usedProviderIds = new Set(contexts.map((context) => context.provider.id))
    const failedAttempts: FailedAttempt[] = []
    const secondaryOperations: Array<{ context: StorageContext; committed: Promise<BatchedCommitResult> }> = []
    let primaryParked = false
    let storedPieceCid: PieceCID | undefined
    let storedSize: number | undefined

    const primaryTask = batching.upload(primary, {
      data,
      pieceCid: options?.pieceCid,
      metadata: options?.pieceMetadata,
      signal: options?.signal,
      onProgress: options?.callbacks?.onProgress,
      onSubmitted: (submitted) =>
        safeInvoke(options?.callbacks?.onPiecesAdded, submitted.txHash, primary.provider.id, [
          { pieceCid: submitted.pieceCid },
        ]),
      onParked: async (piece) => {
        primaryParked = true
        storedPieceCid = piece.pieceCid
        storedSize = piece.size
        safeInvoke(options?.callbacks?.onStored, primary.provider.id, piece.pieceCid)

        for (const secondary of secondaries) {
          const outcome = await this._parkBatchedSecondary(primary, secondary, piece.pieceCid, {
            batching,
            explicitProviders,
            usedProviderIds,
            failedAttempts,
            signal: options?.signal,
            withCDN: options?.withCDN,
            metadata: options?.metadata,
            pieceMetadata: options?.pieceMetadata,
            callbacks: options?.callbacks,
          })
          if (outcome != null) {
            secondaryOperations.push(outcome)
          }
        }
      },
    })
    hold.release()

    let primaryResult: BatchedCommitResult | undefined
    let primaryError: Error | undefined
    try {
      primaryResult = await primaryTask.committed
    } catch (error) {
      if (error instanceof UserRejectedRequestError) {
        throw error
      }
      if (!primaryParked) {
        throw new StoreError(
          `Failed to store piece on service provider ${primary.provider.id} (${primary.provider.pdp.serviceURL})`,
          {
            cause: error instanceof Error ? error : undefined,
            providerId: primary.provider.id,
            endpoint: primary.provider.pdp.serviceURL,
          }
        )
      }
      primaryError = error instanceof Error ? error : new Error(String(error))
    }

    const secondarySettled = await Promise.allSettled(
      secondaryOperations.map(async (operation) => ({
        context: operation.context,
        result: await operation.committed,
      }))
    )

    const copies: CopyResult[] = []
    if (primaryResult == null) {
      failedAttempts.push({
        providerId: primary.provider.id,
        role: 'primary',
        error: 'Commit failed',
        explicit: explicitProviders,
      })
    } else {
      copies.push({
        providerId: primary.provider.id,
        dataSetId: primaryResult.dataSetId,
        pieceId: primaryResult.pieceId,
        role: 'primary',
        retrievalUrl: primary.getPieceUrl(primaryResult.pieceCid),
        isNewDataSet: primaryResult.isNewDataSet,
      })
      safeInvoke(options?.callbacks?.onPiecesConfirmed, primaryResult.dataSetId, primary.provider.id, [
        { pieceId: primaryResult.pieceId, pieceCid: primaryResult.pieceCid },
      ])
    }

    for (const [index, settled] of secondarySettled.entries()) {
      const operation = secondaryOperations[index]
      if (settled.status === 'fulfilled') {
        const { context, result } = settled.value
        copies.push({
          providerId: context.provider.id,
          dataSetId: result.dataSetId,
          pieceId: result.pieceId,
          role: 'secondary',
          retrievalUrl: context.getPieceUrl(result.pieceCid),
          isNewDataSet: result.isNewDataSet,
        })
        safeInvoke(options?.callbacks?.onPiecesConfirmed, result.dataSetId, context.provider.id, [
          { pieceId: result.pieceId, pieceCid: result.pieceCid },
        ])
      } else {
        failedAttempts.push({
          providerId: operation.context.provider.id,
          role: 'secondary',
          error: 'Commit failed',
          explicit: explicitProviders,
        })
      }
    }

    if (copies.length === 0) {
      throw new CommitError(
        `Failed to commit on primary provider ${primary.provider.id} (${primary.provider.pdp.serviceURL}) - data is stored but not on-chain`,
        {
          cause: primaryError,
          providerId: primary.provider.id,
          endpoint: primary.provider.pdp.serviceURL,
        }
      )
    }
    if (storedPieceCid == null || storedSize == null) {
      throw createError('StorageManager', 'upload', 'Primary upload completed without parked piece information')
    }

    return {
      pieceCid: storedPieceCid,
      size: storedSize,
      requestedCopies: contexts.length,
      complete: copies.length >= contexts.length,
      copies,
      failedAttempts,
    }
  }

  private async _parkBatchedSecondary(
    primary: StorageContext,
    initialSecondary: StorageContext,
    pieceCid: PieceCID,
    options: {
      batching: PieceBatchingService
      explicitProviders: boolean
      usedProviderIds: Set<bigint>
      failedAttempts: FailedAttempt[]
      signal?: AbortSignal
      withCDN?: boolean
      metadata?: Record<string, string>
      pieceMetadata?: Record<string, string>
      callbacks?: Partial<CombinedCallbacks>
    }
  ): Promise<{ context: StorageContext; committed: Promise<BatchedCommitResult> } | undefined> {
    let context = initialSecondary
    let attempts = 0

    while (attempts < MAX_SECONDARY_ATTEMPTS) {
      const providerId = context.provider.id
      const task = options.batching.pull(context, {
        pieceCid,
        sourceUrl: primary.getPieceUrl(pieceCid),
        metadata: options.pieceMetadata,
        signal: options.signal,
        onStatus: (response) => {
          const status = response.pieces.find((piece) => piece.pieceCid === pieceCid.toString())?.status
          if (status != null) {
            safeInvoke(options.callbacks?.onPullProgress, providerId, pieceCid, status)
          }
        },
        onParked: () => safeInvoke(options.callbacks?.onCopyComplete, providerId, pieceCid),
        onSubmitted: (submitted) =>
          safeInvoke(options.callbacks?.onPiecesAdded, submitted.txHash, providerId, [
            { pieceCid: submitted.pieceCid },
          ]),
      })

      try {
        await task.parked
        return { context, committed: task.committed }
      } catch (error) {
        void task.committed.catch(() => undefined)
        if (error instanceof UserRejectedRequestError) {
          throw error
        }
        const message = error instanceof Error ? error.message : String(error)
        options.failedAttempts.push({
          providerId,
          role: 'secondary',
          error: message,
          explicit: options.explicitProviders,
        })
        safeInvoke(
          options.callbacks?.onCopyFailed,
          providerId,
          pieceCid,
          error instanceof Error ? error : new Error(message)
        )
      }

      attempts++
      if (options.explicitProviders || attempts >= MAX_SECONDARY_ATTEMPTS) {
        break
      }
      try {
        const [replacement] = await this.createContexts({
          withCDN: options.withCDN,
          copies: 1,
          metadata: options.metadata,
          callbacks: options.callbacks,
          excludeProviderIds: [...options.usedProviderIds],
        })
        context = replacement
        options.usedProviderIds.add(replacement.provider.id)
      } catch {
        break
      }
    }
    return undefined
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
    const hasExplicitIds =
      (options?.providerIds != null && options.providerIds.length > 0) ||
      (options?.dataSetIds != null && options.dataSetIds.length > 0)
    const explicitProviders = options?.contexts != null || hasExplicitIds

    const contexts =
      options?.contexts ??
      (await this.createContexts({
        withCDN: options?.withCDN,
        copies: hasExplicitIds ? options?.copies : (options?.copies ?? DEFAULT_COPY_COUNT),
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
  ): Promise<{
    successful: StorageContext[]
    failedAttempts: FailedAttempt[]
    extraDataMap: Map<StorageContext, Hex>
  }> {
    const usedProviderIds = new Set<bigint>([primary.provider.id, ...secondaries.map((s) => s.provider.id)])
    const successful: StorageContext[] = []
    const failedAttempts: FailedAttempt[] = []
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
            from: (pieceCid) => primary.getPieceUrl(pieceCid),
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
            failedAttempts.push({
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
          if (error instanceof UserRejectedRequestError) {
            throw error
          }
          const errorMsg = error instanceof Error ? error.message : String(error)
          failedAttempts.push({
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
              copies: 1,
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

    return { successful, failedAttempts, extraDataMap }
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

    const parsedPieceCID = Piece.tryFrom(options.pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageManager', 'download', `Invalid PieceCID: ${String(options.pieceCid)}`)
    }

    const clientAddress = this._synapse.client.account.address
    const withCDN = options.withCDN ?? this._withCDN
    let pieceUrl: string

    if (options.providerAddress) {
      // Direct provider download
      const provider = await getPDPProviderByAddress(this._synapse.readClient, { address: options.providerAddress })

      if (provider == null) {
        throw createError('StorageManager', 'download', `Provider ${options.providerAddress} not found`)
      }
      pieceUrl = Piece.createPieceUrlPDP({ cid: parsedPieceCID.toString(), serviceURL: provider.pdp.serviceURL })
    } else {
      // Resolve piece URL from providers
      try {
        pieceUrl = await Piece.resolvePieceUrl({
          client: this._synapse.readClient,
          address: clientAddress,
          pieceCid: parsedPieceCID,
          resolvers: [
            ...(withCDN ? [Piece.filbeamResolver] : []),
            Piece.chainResolver,
            Piece.providersResolver(this._defaultContexts?.map((context) => context.provider) ?? []),
          ],
        })
      } catch (error) {
        throw createError(
          'StorageManager',
          'download',
          `All provider retrieval attempts failed and no additional retriever method was configured`,
          error
        )
      }
    }
    return Piece.downloadAndValidate({
      expectedPieceCid: parsedPieceCID,
      url: pieceUrl,
    })
  }

  /**
   * Get upload costs including rate, deposit needed, and approval state.
   *
   * Wraps the synapse-core `getUploadCosts()` function, automatically injecting
   * the client address. No StorageContext is needed. For an existing data set,
   * pass its current PDP leaf count, lifecycle reserve balance, and any pending one-time
   * payments. {@link prepare} reads that state automatically from its contexts.
   *
   * @param options - Upload cost options (clientAddress auto-injected)
   * @returns Upload costs including rate, deposit needed, and readiness
   */
  async getUploadCosts(options: Omit<GetUploadCostsOptions, 'clientAddress'>): Promise<UploadCosts> {
    return coreGetUploadCosts(this._synapse.readClient, {
      ...options,
      clientAddress: this._synapse.client.account.address,
    })
  }

  /**
   * Prepare the account for upload by computing costs and returning a transaction to execute.
   *
   * Can accept pre-computed costs (from a prior `getUploadCosts()` call) to skip redundant RPC,
   * or computes them internally. When no context is provided, creates default contexts
   * (mirroring the upload() flow).
   *
   * Aggregates per-context lockup correctly for any number of contexts:
   * - Fetches each existing dataset's aggregate PDP leaf count from chain
   * - Fetches each existing dataset's lifecycle reserve and pending fees
   * - Sums lockup across all contexts
   * - Computes debt, runway, and buffer once at the account level
   * - Prices the known `pieceSizes` committed to each context
   * - Conservatively treats every piece as a separate add-pieces operation
   *
   * @param options - {@link PrepareOptions}
   * @returns {@link PrepareResult} with costs and an optional transaction
   * @throws When `pieceSizes` is empty or contains a non-positive size
   */
  async prepare(options: PrepareOptions): Promise<PrepareResult> {
    let costs: UploadCosts

    if (options.costs == null) {
      // Get or create contexts — mirrors upload() behavior
      const contexts = options.context
        ? Array.isArray(options.context)
          ? options.context
          : [options.context]
        : await this.createContexts()

      costs = await this.calculateMultiContextCosts(contexts, options)
    } else {
      costs = options.costs
    }

    if (costs.ready) {
      return { costs, transaction: null }
    }

    return {
      costs,
      transaction: {
        depositAmount: costs.depositNeeded,
        includesApproval: costs.needsFwssMaxApproval,
        execute: (options) =>
          this._synapse.payments.fundSync({
            amount: costs.depositNeeded,
            needsFwssMaxApproval: costs.needsFwssMaxApproval,
            onHash: options?.onHash,
          }),
      },
    }
  }

  /**
   * Calculate upload costs aggregated across multiple storage contexts.
   *
   * Each context creates its own PDP payment rail with its own lockup. This method
   * resolves the on-chain state for every context, then delegates to the shared
   * pure cost utility. The utility sums per-context costs while applying account-level
   * debt, runway, available funds, and buffer only once.
   *
   * Dataset leaf counts, pending one-time fees, and lifecycle reserve balances are
   * fetched from chain for existing datasets so rates and reserve
   * replenishments are accurate. Multi-piece fee and reserve estimates are
   * conservative because actual batch boundaries depend on runtime timing and metadata.
   *
   * @param contexts - Storage contexts to aggregate costs for
   * @param options - Upload options (pieceSizes, extraRunwayEpochs, bufferEpochs)
   * @returns Aggregated upload costs with summed rates and single deposit/approval
   * @throws When `pieceSizes` is empty or contains a non-positive size
   */
  async calculateMultiContextCosts(
    contexts: StorageContext[],
    options: Pick<PrepareOptions, 'pieceSizes' | 'extraRunwayEpochs' | 'bufferEpochs'>
  ): Promise<UploadCosts> {
    const client = this._synapse.client
    const readClient = this._synapse.readClient
    const clientAddress = client.account.address

    // Identify existing data sets that need leaf-count lookups.
    const existingDataSetIds = contexts.filter((ctx) => ctx.dataSetId != null).map((ctx) => ctx.dataSetId as bigint)

    // Fetch all needed data in parallel
    const [accountInfo, priceList, currentEpoch, leafCounts, dataSetsById] = await Promise.all([
      payAccounts(readClient, { address: clientAddress }),
      getPriceList(readClient),
      getBlockNumber(readClient, { cacheTime: 0 }),
      getDataSetLeafCounts(readClient, { dataSetIds: existingDataSetIds }),
      getDataSetsById(readClient, { dataSetIds: existingDataSetIds }),
    ])

    // Reuse the fetched price list's lockup period so the approval check
    // doesn't read getPriceList again.
    const approved = await isFwssMaxApproved(readClient, {
      clientAddress,
      requiredMaxLockupPeriod: priceList.lockups.defaultLockupPeriod,
    })

    const accountParams = {
      funds: accountInfo.funds,
      lockupCurrent: accountInfo.lockupCurrent,
      lockupRate: accountInfo.lockupRate,
      lockupLastSettledAt: accountInfo.lockupLastSettledAt,
      currentEpoch,
    }
    const debt = calculateAccountDebt(accountParams)
    const { availableFunds, runwayInEpochs } = resolveAccountState(accountParams)

    const resolvedContexts = contexts.map((context): calculateUploadCosts.ContextType => {
      if (context.dataSetId == null) {
        return { pieceSizes: options.pieceSizes, withCDN: context.withCDN, dataSet: null }
      }

      const dataSetState = dataSetsById.get(context.dataSetId)
      if (dataSetState == null) {
        throw new Error(`Data set ${context.dataSetId} does not exist`)
      }

      return {
        pieceSizes: options.pieceSizes,
        withCDN: context.withCDN,
        dataSet: {
          leafCount: leafCounts.get(context.dataSetId) ?? 0n,
          lifecycleReserveBalance: dataSetState.lifecycleReserveBalance,
          pendingOneTimePayments: dataSetState.pendingOneTimePayments,
        },
      }
    })

    return calculateUploadCosts({
      contexts: resolvedContexts,
      priceList,
      account: {
        currentLockupRate: accountInfo.lockupRate,
        debt,
        availableFunds,
        runwayInEpochs,
        fwssMaxApproved: approved,
      },
      extraRunwayEpochs: options.extraRunwayEpochs,
      bufferEpochs: options.bufferEpochs,
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
   * @param options.copies - Number of storage copies to create (default: 2)
   * @param options.dataSetIds - Specific dataset IDs to include
   * @param options.providerIds - Specific provider IDs to use
   * @param options.metadata - Metadata to match when finding/creating datasets
   * @param options.excludeProviderIds - Provider IDs to skip during selection
   * @returns Promise resolving to array of storage contexts
   */
  async createContexts(options?: CreateContextsOptions): Promise<StorageContext[]> {
    const withCDN = options?.withCDN ?? this._withCDN
    const combinedMetadata = combineMetadata(options?.metadata, { withCDN, source: this._source })
    const canUseDefault = options == null || (options.providerIds == null && options.dataSetIds == null)
    if (this._defaultContexts != null) {
      const expectedSize = options?.copies ?? DEFAULT_COPY_COUNT
      if (
        this._defaultContexts.length === expectedSize &&
        this._defaultContexts.every((context) => options?.excludeProviderIds?.includes(context.provider.id) !== true)
      ) {
        if (
          this._defaultContexts.every((defaultContext) =>
            metadataMatches(defaultContext.dataSetMetadata, combinedMetadata)
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
      metadata: combinedMetadata,
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
    const combinedMetadata = combineMetadata(options?.metadata, { withCDN: effectiveWithCDN, source: this._source })

    // Check if we can return the default context
    // We can use the default if:
    // 1. No options provided, OR
    // 2. Only withCDN, metadata and/or callbacks are provided (callbacks can fire for cached context)
    const canUseDefault = options == null || (options.providerId == null && options.dataSetId == null)

    if (canUseDefault && this._defaultContexts != null) {
      for (const defaultContext of this._defaultContexts) {
        if (options?.excludeProviderIds?.includes(defaultContext.provider.id)) {
          continue
        }
        // Check if the requested metadata matches what the default context was created with
        if (!metadataMatches(defaultContext.dataSetMetadata, combinedMetadata)) {
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
      metadata: combinedMetadata,
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
   * Terminate the storage service for a data set belonging to the synapse signer.
   *
   * By default the request is relayed through the data set's service provider:
   * the client signs an EIP-712 authorization and the provider submits the
   * transaction (paying the gas), in exchange for a small fee drawn from the
   * payer's account. Provider-relayed termination takes effect immediately;
   * it requires the payer's account to cover settlement in full and fails
   * otherwise, rather than falling back to a lockup wind-down.
   *
   * With `skipProvider: true` the transaction is submitted directly from the
   * signer's wallet. No provider cooperation is needed, but the service and
   * its payments run to the end of the lockup period (typically ~30 days;
   * the actual end is `endEpoch` in the result).
   *
   * Either way, termination ends the service and its payments; the data set's
   * remaining on-chain state is cleaned up later by the provider, not by this
   * call.
   *
   * @param options - {@link TerminateServiceOptions}
   * @returns The termination outcome {@link TerminateServiceResult}
   */
  async terminateService(options: TerminateServiceOptions): Promise<TerminateServiceResult> {
    return terminateServiceFlow(
      this._synapse,
      options,
      () => this._resolveServiceURL(options.dataSetId),
      'StorageManager'
    )
  }

  /**
   * Resolve the PDP endpoint of the provider holding a data set.
   * Validates existence, liveness and ownership along the way.
   */
  private async _resolveServiceURL(dataSetId: bigint): Promise<string> {
    const spRegistry = new SPRegistryService({ client: this._synapse.client })
    const { provider } = await StorageContext.resolveByDataSetId(
      dataSetId,
      this._warmStorageService,
      spRegistry,
      this._synapse.client.account.address
    )
    return provider.pdp.serviceURL
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
            maxLockupPeriod: approval.maxLockupPeriod,
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
        this._warmStorageService.getPriceList(),
        this._warmStorageService.getApprovedProviderIds(),
        getOptionalAllowances(),
      ])

      // Get provider details for approved IDs
      const providers = await spRegistry.getProviders({ providerIds: approvedIds })

      // Calculate pricing per different time units
      const epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH

      // TODO: StorageInfo needs updating to reflect that CDN costs are usage-based

      // Calculate per-epoch pricing (base storage cost)
      const noCDNPerEpoch = pricingData.rates.storagePerTibPerMonth / epochsPerMonth
      // CDN costs are usage-based (egress charges), so base storage cost is the same
      const withCDNPerEpoch = pricingData.rates.storagePerTibPerMonth / epochsPerMonth

      // Calculate per-day pricing (base storage cost)
      const noCDNPerDay = pricingData.rates.storagePerTibPerMonth / TIME_CONSTANTS.DAYS_PER_MONTH
      // CDN costs are usage-based (egress charges), so base storage cost is the same
      const withCDNPerDay = pricingData.rates.storagePerTibPerMonth / TIME_CONSTANTS.DAYS_PER_MONTH

      // Filter out providers with zero addresses
      const validProviders = providers.filter((p: PDPProvider) => p.serviceProvider !== zeroAddress)

      return {
        pricing: {
          noCDN: {
            perTiBPerMonth: pricingData.rates.storagePerTibPerMonth,
            perTiBPerDay: noCDNPerDay,
            perTiBPerEpoch: noCDNPerEpoch,
          },
          // CDN costs are usage-based (egress charges), base storage cost is the same
          withCDN: {
            perTiBPerMonth: pricingData.rates.storagePerTibPerMonth,
            perTiBPerDay: withCDNPerDay,
            perTiBPerEpoch: withCDNPerEpoch,
          },
          tokenAddress: pricingData.token,
          tokenSymbol: 'USDFC', // Hardcoded as we know it's always USDFC
          priceList: pricingData,
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
