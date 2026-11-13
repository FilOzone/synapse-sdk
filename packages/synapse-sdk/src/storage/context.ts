/**
 * StorageContext - Represents a specific Service Provider + Data Set pair
 *
 * This class provides a connection to a specific service provider and data set,
 * handling uploads and downloads within that context. It manages:
 * - Provider selection and data set creation/reuse
 * - PieceCID calculation and validation
 * - Payment rail setup through Warm Storage
 *
 * The upload flow is decomposed into store -> pull -> commit:
 * - store(): Upload data to SP (no on-chain state)
 * - pull(): SP-to-SP transfer from another provider
 * - commit(): Add piece to on-chain data set
 * - upload(): Convenience that does store + commit
 *
 * @example
 * ```typescript
 * // Create storage context (auto-selects provider)
 * const context = await synapse.storage.createContext()
 *
 * // Upload data to this context's provider
 * const result = await context.upload(data)
 * console.log('Stored at:', result.pieceCid)
 *
 * // Download data from this context's provider
 * const retrieved = await context.download(result.pieceCid)
 * ```
 */

import type { AccountClient, ReadClient } from '@filoz/synapse-core'
import { paginate } from '@filoz/synapse-core'
import type { FilecoinChain } from '@filoz/synapse-core/chains'
import {
  FindPieceError,
  InvalidPieceCIDError,
  NoEndorsedProviderError,
  PDPProviderUnavailableError,
} from '@filoz/synapse-core/errors'
import * as PDPVerifier from '@filoz/synapse-core/pdp-verifier'
import * as Piece from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { schedulePieceDeletions, type UploadPieceStreamingData } from '@filoz/synapse-core/sp'
import {
  assertAddPiecesFit,
  calculateLastProofDate,
  createPieceUrlPDP,
  dedupePieces,
  epochToDate,
  getPayerAddress,
  type MetadataObject,
  pieceMetadataObjectToEntry,
  readAllBytes,
  timeUntilEpoch,
} from '@filoz/synapse-core/utils'
import {
  getPdpDataSet,
  metadataMatches,
  type ResolvedLocation,
  resolveProviderLocations,
  selectReachableProviders,
} from '@filoz/synapse-core/warm-storage'
import type { Address, Hash, Hex } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CommitOptions,
  CommitResult,
  ContextCreateContextsOptions,
  DownloadOptions,
  DownloadStreamOptions,
  PDPProvider,
  PieceCID,
  PieceRecord,
  PieceStatus,
  ProviderSelectionResult,
  PullOptions,
  PullResult,
  StorageContextCreateOptions,
  StorageServiceOptions,
  StoreOptions,
  StoreResult,
  TerminateServiceOptions,
  TerminateServiceResult,
  UploadOptions,
  UploadResult,
} from '../types.ts'
import { createError, SIZE_CONSTANTS, throwIfAborted } from '../utils/index.ts'
import { combineMetadata } from '../utils/metadata.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'
import { type BatchedUploadResult, getPieceBatchingService } from './piece-batching.ts'
import { terminateServiceFlow } from './terminate.ts'

const NO_REMAINING_PROVIDERS_ERROR_MESSAGE = 'No approved service providers available'

export interface StorageContextOptions {
  /** The Synapse instance */
  synapse: Synapse
  /** The WarmStorageService instance */
  warmStorageService: WarmStorageService
  /** The provider */
  provider: PDPProvider
  /** The data set ID */
  dataSetId: bigint | undefined
  /** The options for the storage context */
  options: StorageServiceOptions
  /** The data set metadata */
  dataSetMetadata: Record<string, string>
}

export class StorageContext {
  private readonly _client: AccountClient
  private readonly _readClient: ReadClient
  private readonly _chain: FilecoinChain
  private readonly _synapse: Synapse
  private readonly _provider: PDPProvider
  private readonly _pdpEndpoint: string
  private readonly _warmStorageService: WarmStorageService
  private readonly _withCDN: boolean
  private _dataSetId: bigint | undefined
  private _clientDataSetId: bigint | undefined
  private readonly _dataSetMetadata: Record<string, string>

  // Public properties from interface
  public readonly serviceProvider: Address

  // Getter for withCDN
  get withCDN(): boolean {
    return this._withCDN
  }

  get provider(): PDPProvider {
    return this._provider
  }

  // Getter for data set metadata
  get dataSetMetadata(): Record<string, string> {
    return this._dataSetMetadata
  }

  // Getter for data set ID
  get dataSetId(): bigint | undefined {
    return this._dataSetId
  }

  /** @internal Synchronize state after a shared piece batcher creates or resolves a data set. */
  syncBatcherDataSet(dataSetId: bigint, clientDataSetId: bigint): void {
    this._dataSetId = dataSetId
    this._clientDataSetId = clientDataSetId
  }

  /** @internal Resolve the minimal data-set state required by a piece batcher. */
  async getBatcherDataSet(): Promise<SP.PieceBatcher['dataSet']> {
    if (this._dataSetId == null) {
      return undefined
    }
    const dataSet = await getPdpDataSet(this._readClient, { dataSetId: this._dataSetId })
    if (dataSet == null) {
      throw createError('StorageContext', 'getBatcherDataSet', 'Data set not found')
    }
    this._clientDataSetId = dataSet.clientDataSetId
    return dataSet
  }

  private assertPiecesFitMessage(pieces: Array<{ pieceCid: PieceCID; metadata?: MetadataObject }>): void {
    assertAddPiecesFit(
      this._dataSetId
        ? {
            kind: 'addPieces',
            dataSetId: this._dataSetId,
            legacyPieceStorageIdLimit: this._chain.legacyPieceStorageIdLimit,
            pieces,
          }
        : {
            kind: 'createDataSetAndAddPieces',
            metadata: this._dataSetMetadata,
            cdn: this._withCDN,
            pieces,
          }
    )
  }

  /**
   * Get the client data set nonce ("clientDataSetId"), either from cache or by fetching from the chain
   * @returns The client data set nonce
   * @throws Error if data set nonce is not set
   */
  private async getClientDataSetId(): Promise<bigint> {
    if (this._clientDataSetId !== undefined) {
      return this._clientDataSetId
    }
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'getClientDataSetId', 'Data set not found')
    }
    const dataSetInfo = await this._warmStorageService.getDataSet({ dataSetId: this.dataSetId })
    if (dataSetInfo == null) {
      throw createError('StorageContext', 'getClientDataSetId', 'Data set not found')
    }
    this._clientDataSetId = dataSetInfo.clientDataSetId
    return this._clientDataSetId
  }

  /**
   * Validate data size against minimum and maximum limits
   * @param options - The options for the validate raw size
   * @param options.sizeBytes - Size of data in bytes
   * @param options.context - Context for error messages (e.g., 'upload')
   * @throws Error if size is outside allowed limits
   */
  private static validateRawSize(options: { sizeBytes: number; context: string }): void {
    const { sizeBytes, context } = options
    if (sizeBytes < SIZE_CONSTANTS.MIN_UPLOAD_SIZE) {
      throw createError(
        'StorageContext',
        context,
        `Data size ${sizeBytes} bytes is below minimum allowed size of ${SIZE_CONSTANTS.MIN_UPLOAD_SIZE} bytes`
      )
    }

    if (sizeBytes > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      throw createError(
        'StorageContext',
        context,
        `Data size ${sizeBytes} bytes exceeds maximum allowed size of ${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes (64 GiB padded)`
      )
    }
  }

  /**
   * Creates a new StorageContext
   * @param options - The options for the StorageContext {@link StorageContextOptions}
   */
  constructor(options: StorageContextOptions) {
    this._client = options.synapse.client
    this._readClient = options.synapse.readClient
    this._chain = this._readClient.chain
    this._synapse = options.synapse
    this._provider = options.provider
    this._withCDN = options.options.withCDN ?? false
    this._warmStorageService = options.warmStorageService
    this._dataSetMetadata = options.dataSetMetadata
    this._dataSetId = options.dataSetId
    this.serviceProvider = options.provider.serviceProvider
    this._pdpEndpoint = options.provider.pdp.serviceURL
  }

  /**
   * Creates storage contexts with specified options.
   *
   * Three mutually exclusive modes:
   * 1. `dataSetIds` provided: creates contexts for exactly those data sets
   * 2. `providerIds` provided: creates contexts for exactly those providers
   * 3. Neither provided: uses smart selection with `count` (default 2)
   */
  static async createContexts(options: ContextCreateContextsOptions): Promise<StorageContext[]> {
    const clientAddress = options.synapse.client.account.address
    const spRegistry = new SPRegistryService({ client: options.synapse.client })

    const hasDataSetIds = options.dataSetIds != null && options.dataSetIds.length > 0
    const hasProviderIds = options.providerIds != null && options.providerIds.length > 0

    if (hasDataSetIds && hasProviderIds) {
      throw createError(
        'StorageContext',
        'createContexts',
        "Cannot specify both 'dataSetIds' and 'providerIds'. " +
          'To target specific providers, use providerIds and the SDK will handle dataset creation automatically. ' +
          'Use dataSetIds only when resuming into a known dataset from a prior operation.'
      )
    }

    let resolutions: ProviderSelectionResult[] = []

    // Resolve explicit data set IDs (deduplicated)
    if (hasDataSetIds) {
      const uniqueDataSetIds = [...new Set(options.dataSetIds)]
      resolutions = await Promise.all(
        uniqueDataSetIds.map((dataSetId) =>
          StorageContext.resolveByDataSetId(dataSetId, options.warmStorageService, spRegistry, clientAddress)
        )
      )
    } else if (hasProviderIds) {
      // Resolve explicit provider IDs (deduplicated)
      resolutions = await StorageContext.resolveByProviderIds(
        options.synapse.readClient,
        clientAddress,
        [...new Set(options.providerIds)],
        options.metadata ?? {}
      )
    }

    if (resolutions.length > 0) {
      // Explicit path — validate count matches deduped results
      const count = options.copies ?? resolutions.length
      if (resolutions.length !== count) {
        throw createError(
          'StorageContext',
          'createContexts',
          `Requested ${count} context(s) but ${hasDataSetIds ? 'dataSetIds' : 'providerIds'}` +
            ` resolved to ${resolutions.length} after deduplication`
        )
      }
      // Multiple dataSetIds may resolve to the same provider — each context must target a unique provider
      if (hasDataSetIds && resolutions.length > 1) {
        const providerIds = resolutions.map((r) => r.provider.id)
        if (new Set(providerIds).size !== providerIds.length) {
          throw createError(
            'StorageContext',
            'createContexts',
            'dataSetIds resolve to duplicate providers - each context must use a unique provider'
          )
        }
      }
    } else {
      // Smart selection path (neither dataSetIds nor providerIds provided)
      const count = options.copies ?? 2
      resolutions = await StorageContext.smartSelect({
        synapse: options.synapse,
        metadata: options.metadata ?? {},
        count,
        excludeProviderIds: options.excludeProviderIds ?? [],
        requireEndorsedPrimary: true,
      })
    }

    return await Promise.all(
      resolutions.map(
        async (resolution) =>
          await StorageContext.createWithSelectedProvider(
            resolution,
            options.synapse,
            options.warmStorageService,
            options
          )
      )
    )
  }

  /**
   * Static factory method to create a StorageContext
   * Handles provider selection and data set selection/creation
   */
  static async create(options: StorageContextCreateOptions): Promise<StorageContext> {
    const spRegistry = new SPRegistryService({ client: options.synapse.client })

    const resolution = await StorageContext.resolveProviderAndDataSet(
      options.synapse,
      options.warmStorageService,
      spRegistry,
      options
    )

    return await StorageContext.createWithSelectedProvider(
      resolution,
      options.synapse,
      options.warmStorageService,
      options
    )
  }

  private static async createWithSelectedProvider(
    resolution: ProviderSelectionResult,
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: StorageServiceOptions = {}
  ): Promise<StorageContext> {
    // Notify callback about provider selection
    try {
      options.callbacks?.onProviderSelected?.(resolution.provider)
    } catch (error) {
      console.error('Error in onProviderSelected callback:', error)
    }

    if (resolution.dataSetId != null) {
      options.callbacks?.onDataSetResolved?.({
        dataSetId: resolution.dataSetId,
        provider: resolution.provider,
      })
    }

    return new StorageContext({
      synapse,
      warmStorageService,
      provider: resolution.provider,
      dataSetId: resolution.dataSetId ?? undefined,
      options,
      dataSetMetadata: resolution.dataSetMetadata,
    })
  }

  /**
   * Resolve provider and data set based on provided options
   */
  private static async resolveProviderAndDataSet(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    const clientAddress = synapse.client.account.address
    const requestedMetadata = combineMetadata(options.metadata, { withCDN: options.withCDN })

    // Handle explicit data set ID selection (highest priority)
    if (options.dataSetId != null) {
      const result = await StorageContext.resolveByDataSetId(
        options.dataSetId,
        warmStorageService,
        spRegistry,
        clientAddress
      )
      // Validate that the data set's provider matches the requested provider
      if (options.providerId != null && result.provider.id !== options.providerId) {
        throw createError(
          'StorageContext',
          'resolveProviderAndDataSet',
          `Data set ${options.dataSetId} belongs to provider ID ${result.provider.id}, but provider ID ${options.providerId} was requested`
        )
      }
      return result
    }

    // Handle explicit provider ID selection
    if (options.providerId != null) {
      const [result] = await StorageContext.resolveByProviderIds(
        synapse.readClient,
        clientAddress,
        [options.providerId],
        requestedMetadata
      )
      return result
    }

    // Smart selection when no specific parameters provided
    const results = await StorageContext.smartSelect({
      synapse,
      metadata: requestedMetadata,
      count: 1,
      excludeProviderIds: options.excludeProviderIds ?? [],
      requireEndorsedPrimary: false,
    })
    if (results.length === 0) {
      throw createError('StorageContext', 'resolveProviderAndDataSet', NO_REMAINING_PROVIDERS_ERROR_MESSAGE)
    }
    return results[0]
  }

  /**
   * Resolve using a specific data set ID.
   * Also used by StorageManager.terminateService to locate the data set's provider.
   */
  static async resolveByDataSetId(
    dataSetId: bigint,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    clientAddress: string
  ): Promise<ProviderSelectionResult> {
    const [dataSetInfo, dataSetMetadata] = await Promise.all([
      warmStorageService.getDataSet({ dataSetId }),
      warmStorageService.getDataSetMetadata({ dataSetId }),
      warmStorageService.validateDataSet({ dataSetId }),
    ])

    if (dataSetInfo == null) {
      throw createError('StorageContext', 'resolveByDataSetId', `Data set ${dataSetId} does not exist`)
    }

    if (dataSetInfo.payer.toLowerCase() !== clientAddress.toLowerCase()) {
      throw createError(
        'StorageContext',
        'resolveByDataSetId',
        `Data set ${dataSetId} is not owned by ${clientAddress} (owned by ${dataSetInfo.payer})`
      )
    }

    const provider = await spRegistry.getProvider({ providerId: dataSetInfo.providerId })
    if (provider == null) {
      throw createError(
        'StorageContext',
        'resolveByDataSetId',
        `Provider ID ${dataSetInfo.providerId} for data set ${dataSetId} not found in registry`
      )
    }

    return {
      provider,
      dataSetId,
      dataSetMetadata,
    }
  }

  /**
   * Resolve a location for each of the given provider IDs, in order.
   *
   * Delegates to core's resolveProviderLocations, which reads the client's
   * data sets once for all providers.
   */
  private static async resolveByProviderIds(
    readClient: ReadClient,
    clientAddress: Address,
    providerIds: bigint[],
    requestedMetadata: Record<string, string>
  ): Promise<ProviderSelectionResult[]> {
    try {
      const locations = await resolveProviderLocations(readClient, {
        address: clientAddress,
        providerIds,
        metadata: requestedMetadata,
      })
      return locations.map((location) => StorageContext.toProviderSelectionResult(location))
    } catch (error) {
      if (PDPProviderUnavailableError.is(error)) {
        throw createError(
          'StorageContext',
          'resolveByProviderIds',
          `Provider ID ${error.providerId} not found in registry`
        )
      }
      throw error
    }
  }

  /**
   * Smart provider selection with ping-retry.
   *
   * Delegates to core's selectReachableProviders, which fetches chain data
   * once, then selects up to `count` providers, pinging each candidate and
   * excluding failures. When requireEndorsedPrimary=true, the first slot
   * requires an endorsed provider; remaining slots accept any approved provider.
   *
   * @param options - Selection parameters
   * @returns Resolved providers with dataset info, up to `count` length
   * @throws When requireEndorsedPrimary and no healthy endorsed provider is available
   */
  private static async smartSelect(options: {
    synapse: Synapse
    metadata: Record<string, string>
    count: number
    excludeProviderIds: bigint[]
    requireEndorsedPrimary: boolean
  }): Promise<ProviderSelectionResult[]> {
    try {
      const locations = await selectReachableProviders(options.synapse.readClient, {
        address: options.synapse.client.account.address,
        metadata: options.metadata,
        count: options.count,
        excludeProviderIds: options.excludeProviderIds,
        requireEndorsedPrimary: options.requireEndorsedPrimary,
      })
      return locations.map((location) => StorageContext.toProviderSelectionResult(location))
    } catch (error) {
      if (NoEndorsedProviderError.is(error)) {
        const details = error.details == null ? '' : ` - ${error.details}`
        throw new Error(`StorageContext smartSelect failed: ${error.shortMessage}${details}`, { cause: error })
      }
      throw error
    }
  }

  /**
   * Map core's ResolvedLocation to SDK's ProviderSelectionResult.
   */
  private static toProviderSelectionResult(location: ResolvedLocation): ProviderSelectionResult {
    return {
      provider: location.provider,
      dataSetId: location.dataSetId,
      dataSetMetadata: location.dataSetMetadata,
    }
  }

  // ==========================================================================
  // Split Upload Flow: store -> pull -> commit
  // ==========================================================================

  /**
   * Store data on the service provider without committing on-chain.
   *
   * First step of the split upload flow: store -> pull -> commit.
   * After storing, the piece is "parked" on the provider and ready for
   * pulling to other providers via pull(), on-chain commitment via commit(),
   * or retrieval via getPieceUrl() (not yet committed; eligible for GC).
   *
   * @param data - Raw bytes (Uint8Array), a ReadableStream, or an AsyncIterable<Uint8Array> (such as a Node.js `Readable`) to upload
   * @param options - Optional pieceCid (skip CommP), signal, and onProgress callback
   * @returns PieceCid and size of the stored piece
   */
  async store(data: UploadPieceStreamingData, options?: StoreOptions): Promise<StoreResult> {
    if (data instanceof Uint8Array) {
      StorageContext.validateRawSize({ sizeBytes: data.length, context: 'store' })
    }

    let uploadResult: SP.uploadPieceStreaming.OutputType
    try {
      uploadResult = await SP.uploadPieceStreaming({
        serviceURL: this._pdpEndpoint,
        data,
        pieceCid: options?.pieceCid,
        signal: options?.signal,
        onProgress: options?.onProgress,
        waitForParked: true,
      })
    } catch (error) {
      const message = FindPieceError.is(error)
        ? 'Failed to confirm piece storage'
        : 'Failed to store piece on service provider'
      throw createError('StorageContext', 'store', message, error)
    }

    return {
      pieceCid: uploadResult.pieceCid,
      size: uploadResult.size,
    }
  }

  /**
   * Sign a commit for the given pieces without sending it.
   *
   * The commit is JSON-safe data that holds the pieces and the EIP-712 signature. Pass it to both
   * {@link pull} and {@link commit} so the wallet signs once for a multi-copy upload, or save it with
   * `JSON.stringify` and commit it later, for example after a crash. Committing the same commit twice
   * can never add the pieces twice: FWSS rejects a reused nonce.
   *
   * @param pieces - Pieces to sign for, with optional per-piece metadata
   * @returns The signed commit to pass to pull() or commit()
   */
  async prepareCommit(pieces: Array<{ pieceCid: PieceCID; pieceMetadata?: MetadataObject }>): Promise<SP.Commit> {
    // prepareAddPieces and prepareCreateDataSetAndAddPieces check the pieces fit before signing
    const pieceInputs = pieces.map((p) => ({ pieceCid: p.pieceCid, metadata: p.pieceMetadata }))
    const signer = this._synapse.sessionClient ?? this._synapse.client

    if (this._dataSetId) {
      return SP.prepareAddPieces(signer, {
        dataSetId: this._dataSetId,
        clientDataSetId: await this.getClientDataSetId(),
        payer: getPayerAddress(this._client.account),
        pieces: pieceInputs,
      })
    }

    return SP.prepareCreateDataSetAndAddPieces(signer, {
      payee: this._provider.serviceProvider,
      payer: this._synapse.client.account.address,
      metadata: this._dataSetMetadata,
      cdn: this._withCDN,
      pieces: pieceInputs,
    })
  }

  /**
   * Pre-sign EIP-712 extraData for the given pieces.
   *
   * The returned Hex can be passed to both pull() and commit() to avoid
   * redundant wallet signature prompts during multi-copy uploads.
   *
   * @deprecated Use {@link prepareCommit} and pass the commit to pull() and commit() instead.
   * @param pieces - Pieces to sign for, with optional per-piece metadata
   * @returns Signed extraData hex to pass to pull() or commit()
   */
  async presignForCommit(pieces: Array<{ pieceCid: PieceCID; pieceMetadata?: MetadataObject }>): Promise<Hex> {
    const commit = await this.prepareCommit(pieces)
    return commit.extraData
  }

  /**
   * Throw if a commit was not prepared for this context's data set.
   *
   * The provider accepts a valid commit for another of its data sets, or a create commit with other data set
   * settings, and either leaves this context with the wrong data set state. A wrong payer or payee fails on chain.
   */
  private assertCommitMatches(commit: SP.Commit): void {
    const fail = (message: string): never => {
      throw createError('StorageContext', 'commit', message)
    }
    if (commit.kind === 'addPieces') {
      if (this._dataSetId == null) {
        fail(`Commit adds pieces to data set ${commit.dataSetId}, but this context creates a new data set`)
      } else if (BigInt(commit.dataSetId) !== this._dataSetId) {
        fail(`Commit adds pieces to data set ${commit.dataSetId}, but this context uses data set ${this._dataSetId}`)
      }
      return
    }
    if (this._dataSetId != null) {
      fail(`Commit creates a new data set, but this context uses data set ${this._dataSetId}`)
    }
    if (commit.cdn !== this._withCDN) {
      fail(`Commit withCDN is ${commit.cdn}, but this context expects ${this._withCDN}`)
    }
    const metadata = commit.metadata ?? {}
    if (!metadataMatches(metadata, this._dataSetMetadata)) {
      fail(
        `Commit data set metadata ${JSON.stringify(metadata)} does not match this context's ${JSON.stringify(this._dataSetMetadata)}`
      )
    }
  }

  /**
   * Request this provider to pull pieces from another provider.
   *
   * Used for multi-copy uploads: data stored once on primary, then pulled to
   * secondaries via SP-to-SP transfer.
   *
   * @param options - Pull options: pieces to pull or a commit from prepareCommit(), source (URL or StorageContext), signal, timeout, and onProgress
   * @returns Status per piece ('complete' or 'failed') and overall result
   */
  async pull(options: PullOptions): Promise<PullResult> {
    const { from, signal, onProgress, timeout } = options
    let pieces: PieceCID[]
    let extraData: Hex | undefined
    let dedupe: boolean | undefined
    if (options.commit == null) {
      pieces = options.pieces
      extraData = options.extraData
      dedupe = options.dedupe
      // The SP estimateGas-validates the eventual addPieces, so an oversized batch
      // fails there too; reject early for a clear error on non-presigned paths.
      const piecesToFit = pieces.map((pieceCid) => ({ pieceCid }))
      this.assertPiecesFitMessage(dedupe ? dedupePieces(piecesToFit).pieces : piecesToFit)
    } else {
      // The commit was checked to fit when it was prepared, and its signature covers exactly its pieces.
      this.assertCommitMatches(options.commit)
      pieces = options.commit.pieces.map((piece) => Piece.from(piece.pieceCid))
      extraData = options.commit.extraData
    }

    const getSourceUrl = (pieceCid: PieceCID): string => {
      if (typeof from === 'string') {
        return createPieceUrlPDP({ cid: pieceCid.toString(), serviceURL: from })
      }
      return from(pieceCid)
    }

    const pullPiecesInput = pieces.map((pieceCid) => ({
      pieceCid,
      sourceUrl: getSourceUrl(pieceCid),
    }))

    const handleProgressResponse = onProgress
      ? (response: SP.waitForPullPieces.ReturnType) => {
          for (const piece of response.pieces) {
            onProgress(pieces[piece.index], piece.status)
          }
        }
      : undefined

    try {
      const sharedOptions = {
        serviceURL: this._pdpEndpoint,
        pieces: pullPiecesInput,
        signal,
        onStatus: handleProgressResponse,
        extraData,
        timeout,
        dedupe,
      }

      const pullOptions = this._dataSetId
        ? {
            ...sharedOptions,
            dataSetId: this._dataSetId,
            clientDataSetId: await this.getClientDataSetId(),
          }
        : {
            ...sharedOptions,
            payee: this._provider.serviceProvider,
            payer: this._synapse.client.account.address,
            cdn: this._withCDN,
            metadata: this._dataSetMetadata,
          }

      const response = await SP.waitForPullPieces(
        this._synapse.sessionClient ?? this._synapse.client,
        pullOptions as SP.waitForPullPieces.OptionsType
      )

      const pieceResults = response.pieces.map((piece) => ({
        pieceCid: pieces[piece.index],
        status: piece.status === 'complete' ? ('complete' as const) : ('failed' as const),
        index: piece.index,
      }))

      const allComplete = pieceResults.every((p) => p.status === 'complete')

      const result: PullResult = {
        status: allComplete ? 'complete' : 'failed',
        pieces: pieceResults,
      }
      if (response.dropped) {
        result.dropped = response.dropped
      }
      return result
    } catch (error) {
      throw createError('StorageContext', 'pull', 'Failed to pull pieces from source provider', error)
    }
  }

  /**
   * Commit pieces on-chain by calling AddPieces (or CreateDataSetAndAddPieces).
   *
   * Pieces must be stored on the provider (via store() or pull()) before committing.
   * Creates a new data set if this context doesn't have one yet.
   *
   * Aborting `options.signal` after `onSubmitted` only stops waiting for confirmation; the
   * transaction can still land. If it was creating the data set, this context does not learn
   * the new data set ID, and a later commit() on it creates another data set.
   *
   * @param options - Pieces to commit with optional pieceMetadata, extraData, and onSubmitted callback
   * @returns Transaction hash, confirmed pieceIds, dataSetId, and whether a new data set was created
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const { signal } = options

    // Validate message size and metadata early, before any chain reads or signing
    if (options.commit == null) {
      this.assertPiecesFitMessage(options.pieces.map((p) => ({ pieceCid: p.pieceCid, metadata: p.pieceMetadata })))
      for (const piece of options.pieces) {
        if (piece.pieceMetadata) {
          pieceMetadataObjectToEntry(piece.pieceMetadata)
        }
      }
    } else {
      this.assertCommitMatches(options.commit)
    }

    try {
      throwIfAborted(signal)
      const client = this._synapse.sessionClient ?? this._client
      if (this._dataSetId) {
        // Add pieces to existing data set
        const dataSetId = this._dataSetId
        let submitted: SP.submitCommit.OutputType
        if (options.commit == null) {
          const [, clientDataSetId] = await Promise.all([
            this._warmStorageService.validateDataSet({ dataSetId }),
            this.getClientDataSetId(),
          ])
          submitted = await SP.addPieces(client, {
            dataSetId,
            clientDataSetId,
            pieces: options.pieces.map((p) => ({ pieceCid: p.pieceCid, metadata: p.pieceMetadata })),
            serviceURL: this._pdpEndpoint,
            extraData: options.extraData,
            signal,
          })
        } else {
          await this._warmStorageService.validateDataSet({ dataSetId })
          submitted = await SP.submitCommit(client, { serviceURL: this._pdpEndpoint, commit: options.commit, signal })
        }
        options.onSubmitted?.(submitted.txHash)

        const confirmation = await SP.waitForAddPieces({
          client: this._client,
          txHash: submitted.txHash,
          extraData: submitted.extraData,
          pieceCount: submitted.pieceCount,
          payer: getPayerAddress(this._client.account),
          signal,
        })

        return {
          txHash: submitted.txHash,
          ...(confirmation.confirmedTxHash === undefined ? {} : { confirmedTxHash: confirmation.confirmedTxHash }),
          pieceIds: confirmation.pieceIds,
          dataSetId,
          isNewDataSet: false,
        }
      }

      // Create new data set and add pieces
      const submitted =
        options.commit == null
          ? await SP.createDataSetAndAddPieces(client, {
              cdn: this._withCDN,
              payee: this._provider.serviceProvider,
              payer: this._synapse.client.account.address,
              recordKeeper: this._chain.contracts.fwss.address,
              pieces: options.pieces.map((p) => ({ pieceCid: p.pieceCid, metadata: p.pieceMetadata })),
              metadata: this._dataSetMetadata,
              serviceURL: this._pdpEndpoint,
              extraData: options.extraData,
              signal,
            })
          : await SP.submitCommit(client, {
              serviceURL: this._pdpEndpoint,
              commit: options.commit,
              recordKeeper: this._chain.contracts.fwss.address,
              signal,
            })
      options.onSubmitted?.(submitted.txHash)

      const confirmation = await SP.waitForCreateDataSetAddPieces({
        client: this._client,
        txHash: submitted.txHash,
        extraData: submitted.extraData,
        pieceCount: submitted.pieceCount,
        signal,
      })
      this._dataSetId = confirmation.dataSetId

      return {
        txHash: submitted.txHash,
        ...(confirmation.confirmedTxHash === undefined ? {} : { confirmedTxHash: confirmation.confirmedTxHash }),
        pieceIds: confirmation.pieceIds,
        dataSetId: this._dataSetId,
        isNewDataSet: true,
      }
    } catch (error) {
      throw createError('StorageContext', 'commit', 'Failed to commit pieces on-chain', error)
    }
  }

  /**
   * Get the retrieval URL for a piece on this provider.
   *
   * Used by pull() to construct source URLs when pulling from this context
   * to another provider.
   */
  getPieceUrl(pieceCid: PieceCID): string {
    return createPieceUrlPDP({ cid: pieceCid.toString(), serviceURL: this._pdpEndpoint })
  }

  // ==========================================================================
  // Convenience: upload = store + commit
  // ==========================================================================

  /**
   * Upload data to the service provider and commit on-chain.
   *
   * Combines store() and commit() into a single call. Accepts Uint8Array or
   * ReadableStream<Uint8Array>; prefer streaming for large files to minimize memory.
   *
   * When uploading to multiple contexts, pieceCid should be pre-calculated and passed
   * in options to avoid redundant computation. For streaming uploads, pieceCid must be
   * provided as it cannot be calculated without consuming the stream.
   *
   * @param data - Raw bytes (Uint8Array), a ReadableStream, or an AsyncIterable<Uint8Array> (such as a Node.js `Readable`) to upload
   * @param options - Upload options including callbacks, pieceMetadata, pieceCid, and signal
   * @returns Upload result with pieceCid, size, and a single-element copies array
   */
  async upload(data: UploadPieceStreamingData, options?: UploadOptions): Promise<UploadResult> {
    const batching = getPieceBatchingService(this._synapse)
    if (batching != null) {
      let parked = false
      const task = batching.upload(this, {
        data,
        pieceCid: options?.pieceCid,
        metadata: options?.pieceMetadata,
        signal: options?.signal,
        onProgress: options?.onProgress,
        onParked: (piece) => {
          parked = true
          options?.onStored?.(this._provider.id, piece.pieceCid)
        },
        onSubmitted: (submitted) =>
          options?.onPiecesAdded?.(submitted.txHash, this._provider.id, [{ pieceCid: submitted.pieceCid }]),
      })

      let result: BatchedUploadResult
      try {
        result = await task.committed
      } catch (error) {
        throw createError(
          'StorageContext',
          parked ? 'commit' : 'store',
          parked ? 'Failed to commit pieces on-chain' : 'Failed to store piece on service provider',
          error
        )
      }

      options?.onPiecesConfirmed?.(result.dataSetId, this._provider.id, [
        { pieceId: result.pieceId, pieceCid: result.pieceCid },
      ])
      return {
        pieceCid: result.pieceCid,
        size: result.size,
        requestedCopies: 1,
        complete: true,
        copies: [
          {
            providerId: this._provider.id,
            dataSetId: result.dataSetId,
            pieceId: result.pieceId,
            role: 'primary',
            retrievalUrl: this.getPieceUrl(result.pieceCid),
            isNewDataSet: result.isNewDataSet,
          },
        ],
        failedAttempts: [],
      }
    }

    // Store phase
    const storeResult = await this.store(data, {
      pieceCid: options?.pieceCid,
      signal: options?.signal,
      onProgress: options?.onProgress,
    })

    options?.onStored?.(this._provider.id, storeResult.pieceCid)

    // Commit phase
    const commitResult = await this.commit({
      pieces: [{ pieceCid: storeResult.pieceCid, pieceMetadata: options?.pieceMetadata }],
      signal: options?.signal,
      onSubmitted: (txHash) =>
        options?.onPiecesAdded?.(txHash, this._provider.id, [{ pieceCid: storeResult.pieceCid }]),
    })

    const pieceId = commitResult.pieceIds[0]
    options?.onPiecesConfirmed?.(commitResult.dataSetId, this._provider.id, [
      { pieceId, pieceCid: storeResult.pieceCid },
    ])

    return {
      pieceCid: storeResult.pieceCid,
      size: storeResult.size,
      requestedCopies: 1,
      complete: true,
      copies: [
        {
          providerId: this._provider.id,
          dataSetId: commitResult.dataSetId,
          pieceId,
          role: 'primary' as const,
          retrievalUrl: this.getPieceUrl(storeResult.pieceCid),
          isNewDataSet: commitResult.isNewDataSet,
        },
      ],
      failedAttempts: [],
    }
  }

  // ==========================================================================
  // Download, piece queries, and data set operations
  // ==========================================================================

  /**
   * Download data from this specific service provider
   *
   * Buffers the whole piece in memory. Use {@link downloadStream} for large pieces.
   */
  async download(options: DownloadOptions): Promise<Uint8Array> {
    return readAllBytes(await this.downloadStream({ ...options, validate: true }))
  }

  /**
   * Download data from this specific service provider as a stream, with bounded memory use.
   *
   * The PieceCID is validated as the bytes flow through: if it doesn't match, the stream errors
   * with a `DownloadPieceError` after the last chunk instead of closing. Treat the bytes as
   * untrusted until the stream closes cleanly. Pass `validate: false` to opt out.
   *
   * @example
   * ```ts
   * const stream = await context.downloadStream({ pieceCid })
   * await stream.pipeTo(writable)
   * ```
   */
  async downloadStream(options: DownloadStreamOptions): Promise<ReadableStream<Uint8Array>> {
    const { signal } = options
    const pieceCid = Piece.tryFrom(options.pieceCid)
    if (pieceCid == null) {
      throw new InvalidPieceCIDError(options.pieceCid)
    }
    throwIfAborted(signal)

    const withCDN = options.withCDN ?? this._withCDN
    let url: string
    try {
      url = await Piece.resolvePieceUrl({
        client: this._readClient,
        address: this._client.account.address,
        pieceCid,
        signal,
        resolvers: [
          Piece.providersResolver([this._provider]),
          ...(withCDN ? [Piece.filbeamResolver] : []),
          Piece.chainResolver,
        ],
      })
    } catch (error) {
      // An abort is the caller giving up, not a resolution failure.
      throwIfAborted(signal)
      throw error
    }

    return options.validate === false
      ? Piece.downloadStream({ url, validate: false, signal })
      : Piece.downloadStream({ url, expectedPieceCid: pieceCid, signal })
  }

  /**
   * Get information about the service provider used by this service.
   *
   * @returns Provider information including pricing (currently same for all providers)
   */
  async getProviderInfo(): Promise<PDPProvider> {
    return await this._synapse.getProviderInfo(this.serviceProvider)
  }

  /**
   * Get pieces scheduled for removal from this data set.
   *
   * @returns Array of piece IDs scheduled for removal
   */
  async getScheduledRemovals() {
    if (this._dataSetId == null) {
      return []
    }

    return await PDPVerifier.getScheduledRemovals(this._readClient, { dataSetId: this._dataSetId })
  }

  /**
   * Get all active pieces for this data set as an async generator.
   * @param options - Optional configuration object
   * @param options.batchSize - The batch size for each pagination call (default: 100)
   * @yields Object with pieceCid and pieceId
   */
  async *getPieces(options: { batchSize?: bigint } = {}): AsyncGenerator<PieceRecord> {
    if (this._dataSetId == null) {
      return
    }

    const dataSetId = this._dataSetId
    const batchSize = options.batchSize ?? 100n
    for await (const piece of paginate(({ cursor }) =>
      PDPVerifier.getActivePiecesByCursor(this._readClient, {
        dataSetId,
        cursor,
        limit: batchSize,
      })
    )) {
      yield { pieceCid: piece.cid, pieceId: piece.id }
    }
  }

  private async _getPieceIdByCID(pieceCid: string | PieceCID): Promise<bigint> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'getPieceIdByCID', 'Data set not found')
    }
    const parsedPieceCID = Piece.tryFrom(pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageContext', 'getPieceIdByCID', 'Invalid PieceCID provided')
    }

    const page = await PDPVerifier.findPieceIdsByCid(this._readClient, {
      dataSetId: this.dataSetId,
      pieceCid: parsedPieceCID,
    })
    const pieceId = page.items[0]
    if (pieceId == null) {
      throw createError('StorageContext', 'getPieceIdByCID', 'Piece not found in data set')
    }
    return pieceId
  }

  /**
   * Delete pieces with the given CIDs or piece IDs from this data set in one transaction.
   *
   * @param options - Options for the delete operation
   * @param options.pieces - PieceCID identifiers or piece numbers to delete by piece ID
   * @returns Transaction hash of the delete operation
   */
  async deletePieces(options: { pieces: Array<string | PieceCID | bigint> }): Promise<Hash> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'deletePieces', 'Data set not found')
    }

    const resolvedPieceIds = await Promise.all(
      options.pieces.map((piece) => (typeof piece === 'bigint' ? piece : this._getPieceIdByCID(piece)))
    )
    const pieceIds = [...new Set(resolvedPieceIds)]
    SP.validateDeletePiecesBatch(pieceIds.length)

    const clientDataSetId = await this.getClientDataSetId()

    const { txHash } = await schedulePieceDeletions(this._synapse.sessionClient ?? this._synapse.client, {
      serviceURL: this._pdpEndpoint,
      dataSetId: this.dataSetId,
      pieceIds,
      clientDataSetId: clientDataSetId,
    })

    return txHash
  }

  /**
   * Delete a piece with the given CID or piece ID from this data set.
   *
   * @param options - Options for the delete operation
   * @param options.piece - The PieceCID identifier or a piece number to delete by piece ID
   * @returns Transaction hash of the delete operation
   */
  async deletePiece(options: { piece: string | PieceCID | bigint }): Promise<Hash> {
    return this.deletePieces({ pieces: [options.piece] })
  }

  /**
   * Check if a piece exists on this service provider and get its proof status.
   * Also returns timing information about when the piece was last proven and when the next
   * proof is due.
   *
   * Note: Proofs are submitted for entire data sets, not individual pieces. The timing information
   * returned reflects when the data set (containing this piece) was last proven and when the next
   * proof is due.
   *
   * @param options - Options for the piece status
   * @param options.pieceCid - The PieceCID (piece CID) to check
   * @returns Status information including data set timing and retrieval URL
   */
  async pieceStatus(options: { pieceCid: string | PieceCID }): Promise<PieceStatus | null> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'pieceStatus', 'Data set not found')
    }
    const parsedPieceCID = Piece.tryFrom(options.pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageContext', 'pieceStatus', 'Invalid PieceCID provided')
    }

    // Run multiple operations in parallel for better performance
    const [piecePage, nextChallengeEpoch, currentEpoch, pdpConfig, providerInfo] = await Promise.all([
      PDPVerifier.findPieceIdsByCid(this._readClient, {
        dataSetId: this.dataSetId,
        pieceCid: parsedPieceCID,
      }),
      PDPVerifier.getNextChallengeEpoch(this._readClient, {
        dataSetId: this.dataSetId,
      }),
      getBlockNumber(this._readClient),
      this._warmStorageService.getPDPConfig().catch((error) => {
        console.debug('Failed to get PDP config:', error)
        return null
      }),
      this.getProviderInfo().catch(() => null),
    ])

    const pieceId = piecePage.items[0]
    if (pieceId == null) {
      return null
    }

    // Initialize return values
    let retrievalUrl: string | null = null
    let lastProven: Date | null = null
    let nextProofDue: Date | null = null
    let inChallengeWindow = false
    let hoursUntilChallengeWindow = 0
    let isProofOverdue = false

    // Set retrieval URL if we have provider info
    if (providerInfo != null) {
      retrievalUrl = createPieceUrlPDP({
        cid: parsedPieceCID.toString(),
        serviceURL: providerInfo.pdp.serviceURL,
      })
    }

    // Process proof timing data if we have data set data and PDP config
    if (pdpConfig != null) {
      // Calculate timing based on nextChallengeEpoch
      if (nextChallengeEpoch === null) {
        // If nextChallengeEpoch is null, it might mean:
        // 1. Proof was just submitted and system is updating
        // 2. Data set is not active
        // In case 1, we might have just proven, so set lastProven to very recent
        // This is a temporary state and should resolve quickly
        console.debug('Data set has nextChallengeEpoch=0, may have just been proven')
      } else {
        // nextChallengeEpoch is when the challenge window STARTS, not ends!
        // The proving deadline is nextChallengeEpoch + challengeWindowSize
        const challengeWindowStart = nextChallengeEpoch
        const provingDeadline = challengeWindowStart + pdpConfig.challengeWindowSize

        // Calculate when the next proof is due (end of challenge window)
        nextProofDue = epochToDate(provingDeadline, this._chain.genesisTimestamp)

        // Calculate last proven date (one proving period before next challenge)
        lastProven = calculateLastProofDate(
          nextChallengeEpoch,
          pdpConfig.maxProvingPeriod,
          this._chain.genesisTimestamp
        )

        // Check if we're in the challenge window
        inChallengeWindow = Number(currentEpoch) >= challengeWindowStart && Number(currentEpoch) < provingDeadline

        // Check if proof is overdue (past the proving deadline)
        isProofOverdue = Number(currentEpoch) >= provingDeadline

        // Calculate hours until challenge window starts (only if before challenge window)
        if (Number(currentEpoch) < challengeWindowStart) {
          const timeUntil = timeUntilEpoch(challengeWindowStart, currentEpoch)
          hoursUntilChallengeWindow = timeUntil.hours
        }
      }
    }

    return {
      dataSetLastProven: lastProven,
      dataSetNextProofDue: nextProofDue,
      retrievalUrl,
      pieceId,
      inChallengeWindow,
      hoursUntilChallengeWindow,
      isProofOverdue,
    }
  }

  /**
   * Terminate the storage service for this context's data set.
   *
   * Relays through this provider by default (immediate); pass `skipProvider: true`
   * to submit the transaction directly and wind down over the lockup period.
   * See `StorageManager.terminateService` for full semantics.
   *
   * @param options - Optional `skipProvider` and `onSubmitted` {@link TerminateServiceOptions}
   * @returns The termination outcome {@link TerminateServiceResult}
   */
  async terminate(
    options?: Pick<TerminateServiceOptions, 'skipProvider' | 'onSubmitted'>
  ): Promise<TerminateServiceResult> {
    const dataSetId = this.dataSetId
    if (dataSetId == null) {
      throw createError('StorageContext', 'terminate', 'Data set not found')
    }
    // The context already knows its provider's endpoint; no registry lookup
    return terminateServiceFlow(
      this._synapse,
      { ...options, dataSetId },
      async () => this._pdpEndpoint,
      'StorageContext'
    )
  }
}
