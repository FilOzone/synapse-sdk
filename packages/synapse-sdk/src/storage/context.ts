/**
 * StorageContext - Represents a specific Service Provider + Data Set pair
 *
 * This class provides a connection to a specific service provider and data set,
 * handling uploads and downloads within that context. It manages:
 * - Provider selection and data set creation/reuse
 * - PieceCID calculation and validation
 * - Payment rail setup through Warm Storage
 * - Batched piece additions for efficiency
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

import { asChain, type Chain as FilecoinChain } from '@filoz/synapse-core/chains'
import { getProviderIds as getEndorsedProviderIds } from '@filoz/synapse-core/endorsements'
import { asPieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { signAddPieces, signCreateDataSetAndAddPieces } from '@filoz/synapse-core/typed-data'
import {
  calculateLastProofDate,
  createPieceUrlPDP,
  datasetMetadataObjectToEntry,
  epochToDate,
  pieceMetadataObjectToEntry,
  randIndex,
  randU256,
  timeUntilEpoch,
} from '@filoz/synapse-core/utils'
import { deletePiece, waitForPullStatus } from '@filoz/synapse-core/warm-storage'
import type { Account, Address, Chain, Client, Hash, Hex, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import type { PaymentsService } from '../payments/index.ts'
import { PDPServer } from '../pdp/index.ts'
import { PDPVerifier } from '../pdp/verifier.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  BaseContextOptions,
  CommitOptions,
  CommitResult,
  CreateContextOptions,
  CreateContextsOptions,
  DownloadOptions,
  PDPProvider,
  PieceCID,
  PieceRecord,
  PieceStatus,
  PreflightInfo,
  ProviderSelectionResult,
  PullOptions,
  PullResult,
  StoreOptions,
  StoreResult,
  UploadOptions,
  UploadResult,
} from '../types.ts'
import { createError, METADATA_KEYS, SIZE_CONSTANTS } from '../utils/index.ts'
import { combineMetadata, metadataMatches } from '../utils/metadata.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'

const NO_REMAINING_PROVIDERS_ERROR_MESSAGE = 'No approved service providers available'

export class StorageContext {
  private readonly _client: Client<Transport, Chain, Account>
  private readonly _chain: FilecoinChain
  private readonly _synapse: Synapse
  private readonly _provider: PDPProvider
  private readonly _pdpEndpoint: string
  private readonly _pdpServer: PDPServer
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
    const dataSetInfo = await this._warmStorageService.getDataSet(this.dataSetId)
    this._clientDataSetId = dataSetInfo.clientDataSetId
    return this._clientDataSetId
  }

  /**
   * Validate data size against minimum and maximum limits
   * @param sizeBytes - Size of data in bytes
   * @param context - Context for error messages (e.g., 'upload', 'preflightUpload')
   * @throws Error if size is outside allowed limits
   */
  private static validateRawSize(sizeBytes: number, context: string): void {
    if (sizeBytes < SIZE_CONSTANTS.MIN_UPLOAD_SIZE) {
      throw createError(
        'StorageContext',
        context,
        `Data size ${sizeBytes} bytes is below minimum allowed size of ${SIZE_CONSTANTS.MIN_UPLOAD_SIZE} bytes`
      )
    }

    if (sizeBytes > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      // This restriction is ~arbitrary for now, but there is a hard limit on PDP uploads in Curio
      // of 254 MiB, see: https://github.com/filecoin-project/curio/blob/3ddc785218f4e237f0c073bac9af0b77d0f7125c/pdp/handlers_upload.go#L38
      // We can increase this in future, arbitrarily, but we first need to:
      //  - Handle streaming input.
      //  - Chunking input at size 254 MiB and make a separate piece per each chunk
      //  - Combine the pieces using "subPieces" and an aggregate PieceCID in our AddRoots call
      throw createError(
        'StorageContext',
        context,
        `Data size ${sizeBytes} bytes exceeds maximum allowed size of ${
          SIZE_CONSTANTS.MAX_UPLOAD_SIZE
        } bytes (${Math.floor(SIZE_CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024)} MiB)`
      )
    }
  }

  constructor(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    provider: PDPProvider,
    dataSetId: bigint | undefined,
    options: BaseContextOptions,
    dataSetMetadata: Record<string, string>
  ) {
    this._client = synapse.client
    this._chain = asChain(this._client.chain)
    this._synapse = synapse
    this._provider = provider
    this._withCDN = options.withCDN ?? false
    this._warmStorageService = warmStorageService
    this._dataSetMetadata = dataSetMetadata

    // Set public properties
    this._dataSetId = dataSetId
    this.serviceProvider = provider.serviceProvider

    this._pdpEndpoint = provider.pdp.serviceURL
    this._pdpServer = new PDPServer({
      client: synapse.client,
      endpoint: this._pdpEndpoint,
    })
  }

  /**
   * Creates storage contexts with specified options.
   *
   * Three mutually exclusive modes:
   * 1. `dataSetIds` provided: creates contexts for exactly those data sets
   * 2. `providerIds` provided: creates contexts for exactly those providers
   * 3. Neither provided: uses smart selection with `count` (default 2)
   */
  static async createContexts(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: CreateContextsOptions
  ): Promise<StorageContext[]> {
    const clientAddress = synapse.client.account.address
    const spRegistry = new SPRegistryService(synapse.client)

    const hasDataSetIds = options.dataSetIds != null && options.dataSetIds.length > 0
    const hasProviderIds = options.providerIds != null && options.providerIds.length > 0

    // Validate mutual exclusivity
    if (hasDataSetIds && hasProviderIds) {
      throw createError(
        'StorageContext',
        'createContexts',
        "Cannot specify both 'dataSetIds' and 'providerIds' - use one or the other"
      )
    }

    let resolutions: ProviderSelectionResult[]

    if (hasDataSetIds) {
      // Explicit dataSetIds - resolve all
      const uniqueDataSetIds = [...new Set(options.dataSetIds)]
      if (options.count !== undefined && options.count !== uniqueDataSetIds.length) {
        throw createError(
          'StorageContext',
          'createContexts',
          `count (${options.count}) does not match unique dataSetIds length (${uniqueDataSetIds.length})`
        )
      }
      resolutions = await Promise.all(
        uniqueDataSetIds.map((dataSetId) =>
          StorageContext.resolveByDataSetId(dataSetId, warmStorageService, spRegistry, clientAddress)
        )
      )
      // Verify resolved providers are unique
      const providerIds = resolutions.map((r) => r.provider.id)
      const uniqueProviders = new Set(providerIds)
      if (uniqueProviders.size !== providerIds.length) {
        throw createError(
          'StorageContext',
          'createContexts',
          'dataSetIds resolve to duplicate providers - each context must use a unique provider'
        )
      }
    } else if (hasProviderIds) {
      // Explicit providerIds - resolve all
      const uniqueProviderIds = [...new Set(options.providerIds)]
      if (options.count !== undefined && options.count !== uniqueProviderIds.length) {
        throw createError(
          'StorageContext',
          'createContexts',
          `count (${options.count}) does not match unique providerIds length (${uniqueProviderIds.length})`
        )
      }
      resolutions = await Promise.all(
        uniqueProviderIds.map((providerId) =>
          StorageContext.resolveByProviderId(
            clientAddress,
            providerId,
            options.metadata ?? {},
            warmStorageService,
            spRegistry
          )
        )
      )
    } else {
      // Smart selection - uses count (default 2) and excludeProviderIds
      const count = options.count ?? 2
      const excludeProviderIds = [...(options.excludeProviderIds ?? [])]
      resolutions = []

      for (let i = 0; i < count; i++) {
        try {
          const resolution = await StorageContext.smartSelectProvider(
            clientAddress,
            options.metadata ?? {},
            warmStorageService,
            spRegistry,
            excludeProviderIds,
            resolutions.length === 0 ? await getEndorsedProviderIds(synapse.client) : new Set<bigint>()
          )
          excludeProviderIds.push(resolution.provider.id)
          resolutions.push(resolution)
        } catch (error) {
          if (error instanceof Error && error.message.includes(NO_REMAINING_PROVIDERS_ERROR_MESSAGE)) {
            break
          }
          throw error
        }
      }
    }

    return await Promise.all(
      resolutions.map(
        async (resolution) =>
          await StorageContext.createWithSelectedProvider(resolution, synapse, warmStorageService, options)
      )
    )
  }

  /**
   * Static factory method to create a StorageContext
   * Handles provider selection and data set selection/creation
   */
  static async create(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: CreateContextOptions = {}
  ): Promise<StorageContext> {
    // Create SPRegistryService
    const spRegistry = new SPRegistryService(synapse.client)

    // Resolve provider and data set based on options
    const resolution = await StorageContext.resolveProviderAndDataSet(synapse, warmStorageService, spRegistry, options)

    return await StorageContext.createWithSelectedProvider(resolution, synapse, warmStorageService, options)
  }

  private static async createWithSelectedProvider(
    resolution: ProviderSelectionResult,
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: CreateContextOptions = {}
  ): Promise<StorageContext> {
    // Notify callback about provider selection
    try {
      options.callbacks?.onProviderSelected?.(resolution.provider)
    } catch (error) {
      // Log but don't propagate callback errors
      console.error('Error in onProviderSelected callback:', error)
    }

    if (resolution.dataSetId !== -1n) {
      options.callbacks?.onDataSetResolved?.({
        isExisting: resolution.dataSetId !== -1n,
        dataSetId: resolution.dataSetId,
        provider: resolution.provider,
      })
    }

    return new StorageContext(
      synapse,
      warmStorageService,
      resolution.provider,
      resolution.dataSetId === -1n ? undefined : resolution.dataSetId,
      options,
      resolution.dataSetMetadata
    )
  }

  /**
   * Resolve provider and data set based on provided options
   * Uses lazy loading to minimize RPC calls
   */
  private static async resolveProviderAndDataSet(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    options: CreateContextOptions
  ): Promise<ProviderSelectionResult> {
    const clientAddress = synapse.client.account.address

    // Convert options to metadata format - merge withCDN flag into metadata if needed
    const requestedMetadata = combineMetadata(options.metadata, options.withCDN)

    // Handle explicit data set ID selection (highest priority)
    if (options.dataSetId != null) {
      return await StorageContext.resolveByDataSetId(options.dataSetId, warmStorageService, spRegistry, clientAddress)
    }

    // Handle explicit provider ID selection
    if (options.providerId != null) {
      return await StorageContext.resolveByProviderId(
        clientAddress,
        options.providerId,
        requestedMetadata,
        warmStorageService,
        spRegistry
      )
    }

    // Smart selection when no specific parameters provided
    return await StorageContext.smartSelectProvider(
      clientAddress,
      requestedMetadata,
      warmStorageService,
      spRegistry,
      [],
      new Set<bigint>()
    )
  }

  /**
   * Resolve using a specific data set ID
   *
   * Note that unlike resolveByProviderId, we don't check for matching metadata,
   * we assume that if the client asked for this data set, then they know what
   * they are doing and are willing to deal with any conflicts.
   */
  private static async resolveByDataSetId(
    dataSetId: bigint,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    clientAddress: string
  ): Promise<ProviderSelectionResult> {
    const [dataSetInfo, dataSetMetadata] = await Promise.all([
      warmStorageService.getDataSet(dataSetId),
      warmStorageService.getDataSetMetadata(dataSetId),
      warmStorageService.validateDataSet(dataSetId),
    ])

    if (dataSetInfo.payer.toLowerCase() !== clientAddress.toLowerCase()) {
      throw createError(
        'StorageContext',
        'resolveByDataSetId',
        `Data set ${dataSetId} is not owned by ${clientAddress} (owned by ${dataSetInfo.payer})`
      )
    }

    const provider = await spRegistry.getProvider(dataSetInfo.providerId)
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
      isExisting: true,
      dataSetMetadata,
    }
  }

  /**
   * Resolve the best matching DataSet for a Provider using a specific provider ID
   *
   * Optimization Strategy:
   * Uses `getClientDataSets` fetch followed by batched parallel checks to find
   * the best matching data set while minimizing RPC calls.
   *
   * Selection Logic:
   * 1. Filters for datasets belonging to this provider
   * 2. Sorts by dataSetId ascending (oldest first)
   * 3. Searches in batches (size dynamic based on total count) for metadata match
   * 4. Prioritizes datasets with pieces > 0, then falls back to the oldest valid dataset
   * 5. Exits early as soon as a non-empty matching dataset is found
   */
  private static async resolveByProviderId(
    clientAddress: Address,
    providerId: bigint,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService
  ): Promise<ProviderSelectionResult> {
    // Fetch provider and dataSets in parallel
    const [provider, dataSets] = await Promise.all([
      spRegistry.getProvider(providerId),
      warmStorageService.getClientDataSets(clientAddress),
    ])

    if (provider == null) {
      throw createError('StorageContext', 'resolveByProviderId', `Provider ID ${providerId} not found in registry`)
    }

    // Filter for this provider's active datasets
    const providerDataSets = dataSets.filter(
      (dataSet) => dataSet.dataSetId && dataSet.providerId === provider.id && dataSet.pdpEndEpoch === 0n
    )

    type EvaluatedDataSet = {
      dataSetId: bigint
      dataSetMetadata: Record<string, string>
      activePieceCount: bigint
    }

    // Sort ascending by ID (oldest first) for deterministic selection
    const sortedDataSets = providerDataSets.sort((a, b) => {
      return Number(a.dataSetId) - Number(b.dataSetId)
    })

    // Batch strategy: 1/3 of total datasets per batch, with min & max, to balance latency vs RPC burst
    // In the normal case we don't expect a client to have more than a few, maximum, with any particular
    // provider so this optimization is for extreme cases.
    const MIN_BATCH_SIZE = 50
    const MAX_BATCH_SIZE = 200
    const BATCH_SIZE = Math.min(MAX_BATCH_SIZE, Math.max(MIN_BATCH_SIZE, Math.ceil(sortedDataSets.length / 3), 1))
    let selectedDataSet: EvaluatedDataSet | null = null

    for (let i = 0; i < sortedDataSets.length; i += BATCH_SIZE) {
      const batchResults: (EvaluatedDataSet | null)[] = await Promise.all(
        sortedDataSets.slice(i, i + BATCH_SIZE).map(async (dataSet) => {
          const dataSetId = dataSet.dataSetId
          try {
            const [dataSetMetadata, activePieceCount] = await Promise.all([
              warmStorageService.getDataSetMetadata(dataSetId),
              warmStorageService.getActivePieceCount(dataSetId),
              warmStorageService.validateDataSet(dataSetId),
            ])

            if (!metadataMatches(dataSetMetadata, requestedMetadata)) {
              return null
            }

            return {
              dataSetId,
              dataSetMetadata,
              activePieceCount,
            }
          } catch (error) {
            console.warn(
              `Skipping data set ${dataSetId} for provider ${providerId}:`,
              error instanceof Error ? error.message : String(error)
            )
            return null
          }
        })
      )

      for (const result of batchResults) {
        if (result == null) continue

        // select the first dataset with pieces and break out of the inner loop
        if (result.activePieceCount > 0) {
          selectedDataSet = result
          break
        }

        // keep the first (oldest) dataset found so far (no pieces)
        if (selectedDataSet == null) {
          selectedDataSet = result
        }
      }

      // early exit if we found a dataset with pieces; break out of the outer loop
      if (selectedDataSet != null && selectedDataSet.activePieceCount > 0) {
        break
      }
    }

    if (selectedDataSet != null) {
      return {
        provider,
        dataSetId: selectedDataSet.dataSetId,
        isExisting: true,
        dataSetMetadata: selectedDataSet.dataSetMetadata,
      }
    }

    // Need to create new data set
    return {
      provider,
      dataSetId: -1n, // Marker for new data set
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    }
  }

  /**
   * Smart provider selection algorithm
   *
   * When endorsedProviderIds is provided (primary copy):
   *   1. Existing data sets with endorsed providers (prefer pieces > 0, then oldest)
   *   2. New data set with endorsed provider (random)
   *   3. Existing data sets with non-endorsed approved providers
   *   4. New data set with non-endorsed approved provider
   *
   * When endorsedProviderIds is empty (secondary copies):
   *   1. Existing data sets with any approved provider
   *   2. New data set with any approved provider (random)
   */
  private static async smartSelectProvider(
    clientAddress: Address,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    excludeProviderIds: bigint[],
    endorsedProviderIds: Set<bigint>
  ): Promise<ProviderSelectionResult> {
    // Get client's data sets
    const dataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)

    const skipProviderIds = new Set<bigint>(excludeProviderIds)
    // Filter for managed data sets with matching metadata
    const managedDataSets = dataSets.filter(
      (ps) =>
        ps.isLive &&
        ps.isManaged &&
        ps.pdpEndEpoch === 0n &&
        !skipProviderIds.has(ps.providerId) &&
        metadataMatches(ps.metadata, requestedMetadata)
    )

    // Sort data sets by pieces (non-empty first), then by ID (oldest first)
    type DataSetWithDetails = (typeof managedDataSets)[number]
    const sortDataSets = (sets: DataSetWithDetails[]): DataSetWithDetails[] =>
      [...sets].sort((a, b) => {
        if (a.activePieceCount > 0n && b.activePieceCount === 0n) return -1
        if (b.activePieceCount > 0n && a.activePieceCount === 0n) return 1
        return Number(a.pdpVerifierDataSetId - b.pdpVerifierDataSetId)
      })

    // Create async generator from data sets that yields providers lazily
    const createDataSetProviderGenerator = (sets: DataSetWithDetails[]) =>
      async function* (): AsyncGenerator<PDPProvider> {
        const yieldedProviders = new Set<bigint>()
        for (const dataSet of sets) {
          if (yieldedProviders.has(dataSet.providerId)) continue
          yieldedProviders.add(dataSet.providerId)
          const provider = await spRegistry.getProvider(dataSet.providerId)
          if (provider == null) {
            console.warn(
              `Provider ID ${dataSet.providerId} for data set ${dataSet.pdpVerifierDataSetId} is not currently approved`
            )
            continue
          }
          yield provider
        }
      }

    // Create result from an existing data set
    const createResultFromDataSet = async (
      provider: PDPProvider,
      sets: DataSetWithDetails[]
    ): Promise<ProviderSelectionResult> => {
      const matchingDataSet = sets.find((ps) => ps.providerId === provider.id)
      if (matchingDataSet == null) {
        // Shouldn't happen, but fallback to new data set
        console.warn(
          `Could not match selected provider ${provider.serviceProvider} (ID: ${provider.id}) ` +
            `to existing data sets. Falling back to new data set.`
        )
        return {
          provider,
          dataSetId: -1n,
          isExisting: false,
          dataSetMetadata: requestedMetadata,
        }
      }
      const dataSetMetadata = await warmStorageService.getDataSetMetadata(matchingDataSet.pdpVerifierDataSetId)
      return {
        provider,
        dataSetId: matchingDataSet.pdpVerifierDataSetId,
        isExisting: true,
        dataSetMetadata,
      }
    }

    // Create result for a new data set
    const createNewDataSetResult = (provider: PDPProvider): ProviderSelectionResult => ({
      provider,
      dataSetId: -1n,
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    })

    // Split existing data sets into endorsed and non-endorsed
    // When endorsedProviderIds is empty, endorsedDataSets will be empty and
    // nonEndorsedDataSets will contain all data sets - the logic handles both cases
    const endorsedDataSets = managedDataSets.filter((ds) => endorsedProviderIds.has(ds.providerId))
    const nonEndorsedDataSets = managedDataSets.filter((ds) => !endorsedProviderIds.has(ds.providerId))

    // 1. Try existing data sets with endorsed providers first
    if (endorsedDataSets.length > 0) {
      const sorted = sortDataSets(endorsedDataSets)
      const provider = await StorageContext.selectProviderWithPing(createDataSetProviderGenerator(sorted)())
      if (provider != null) {
        return await createResultFromDataSet(provider, sorted)
      }
    }

    // 2. Try new data set with endorsed provider
    const approvedIds = await warmStorageService.getApprovedProviderIds()
    const approvedProviders = await spRegistry.getProviders(approvedIds)
    const allProviders = approvedProviders.filter((p: PDPProvider) => !excludeProviderIds.includes(p.id))
    const endorsedProviders = allProviders.filter((p: PDPProvider) => endorsedProviderIds.has(p.id))

    if (endorsedProviders.length > 0) {
      const provider = await StorageContext.selectRandomProvider(endorsedProviders)
      if (provider != null) {
        return createNewDataSetResult(provider)
      }
    }

    // 3. Fall back to existing data sets with non-endorsed (approved) providers
    if (nonEndorsedDataSets.length > 0) {
      const sorted = sortDataSets(nonEndorsedDataSets)
      const provider = await StorageContext.selectProviderWithPing(createDataSetProviderGenerator(sorted)())
      if (provider != null) {
        return await createResultFromDataSet(provider, sorted)
      }
    }

    // 4. Fall back to new data set with any approved provider
    const nonEndorsedApproved = allProviders.filter((p: PDPProvider) => !endorsedProviderIds.has(p.id))
    if (nonEndorsedApproved.length > 0) {
      const provider = await StorageContext.selectRandomProvider(nonEndorsedApproved)
      if (provider != null) {
        return createNewDataSetResult(provider)
      }
    }

    // No providers available
    if (allProviders.length === 0) {
      throw createError('StorageContext', 'smartSelectProvider', NO_REMAINING_PROVIDERS_ERROR_MESSAGE)
    }
    throw createError(
      'StorageContext',
      'smartSelectProvider',
      `All ${allProviders.length} providers failed health check. Storage may be temporarily unavailable.`
    )
  }

  /**
   * Select a random provider from a list with ping validation
   * @param providers - Array of providers to select from
   * @returns Selected provider or null if all fail ping
   */
  private static async selectRandomProvider(providers: PDPProvider[]): Promise<PDPProvider | null> {
    if (providers.length === 0) {
      return null
    }

    // Create async generator that yields providers in random order
    async function* generateRandomProviders(): AsyncGenerator<PDPProvider> {
      const remaining = [...providers]

      while (remaining.length > 0) {
        // Remove and yield the selected provider
        const selected = remaining.splice(randIndex(remaining.length), 1)[0]
        yield selected
      }
    }

    return await StorageContext.selectProviderWithPing(generateRandomProviders())
  }

  /**
   * Select a provider from an async iterator with ping validation.
   * This is shared logic used by both smart selection and random selection.
   * @param providers - Async iterable of providers to try
   * @returns The first provider that responds
   * @throws If all providers fail
   */
  private static async selectProviderWithPing(providers: AsyncIterable<PDPProvider>): Promise<PDPProvider | null> {
    // Try providers in order until we find one that responds to ping
    for await (const provider of providers) {
      try {
        await SP.ping(provider.pdp.serviceURL)
        return provider
      } catch (error) {
        console.warn(
          `Provider ${provider.serviceProvider} failed ping test:`,
          error instanceof Error ? error.message : String(error)
        )
        // Continue to next provider
      }
    }

    return null
  }

  /**
   * Static method to perform preflight checks for an upload
   * @param size - The size of data to upload in bytes
   * @param withCDN - Whether CDN is enabled
   * @param warmStorageService - WarmStorageService instance
   * @param paymentsService - PaymentsService instance
   * @returns Preflight check results without provider/dataSet specifics
   */
  static async performPreflightCheck(
    warmStorageService: WarmStorageService,
    paymentsService: PaymentsService,
    size: number,
    withCDN: boolean
  ): Promise<PreflightInfo> {
    // Validate size before proceeding
    StorageContext.validateRawSize(size, 'preflightUpload')

    // Check allowances and get costs in a single call
    const allowanceCheck = await warmStorageService.checkAllowanceForStorage(size, withCDN, paymentsService)

    // Return preflight info
    return {
      estimatedCost: {
        perEpoch: allowanceCheck.costs.perEpoch,
        perDay: allowanceCheck.costs.perDay,
        perMonth: allowanceCheck.costs.perMonth,
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.message,
      },
      selectedProvider: null,
      selectedDataSetId: null,
    }
  }

  /**
   * Run preflight checks for an upload
   * @param size - The size of data to upload in bytes
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload(size: number): Promise<PreflightInfo> {
    // Use the static method for core logic
    const preflightResult = await StorageContext.performPreflightCheck(
      this._warmStorageService,
      this._synapse.payments,
      size,
      this._withCDN
    )

    // Return preflight info with provider and dataSet specifics
    return preflightResult
  }

  /**
   * Upload data to the service provider
   *
   * Accepts Uint8Array or ReadableStream<Uint8Array>.
   * For large files, prefer streaming to minimize memory usage.
   *
   * Note: When uploading to multiple contexts, pieceCid should be pre-calculated and passed in options
   * to avoid redundant computation. For streaming uploads, pieceCid must be provided in options as it
   * cannot be calculated without consuming the stream.
   */
  async upload(data: Uint8Array | ReadableStream<Uint8Array>, options?: UploadOptions): Promise<UploadResult> {
    // Store phase: upload data and wait for it to be parked
    const storeResult = await this.store(data, {
      pieceCid: options?.pieceCid,
      signal: options?.signal,
      onProgress: options?.onProgress,
    })

    options?.onStored?.(this._provider.id, storeResult.pieceCid)

    // Commit phase: add piece on-chain
    const commitResult = await this.commit({
      pieces: [{ pieceCid: storeResult.pieceCid, pieceMetadata: options?.pieceMetadata }],
      onSubmitted: () => options?.onPieceAdded?.(this._provider.id, storeResult.pieceCid),
    })

    const pieceId = commitResult.pieceIds[0]
    options?.onPieceConfirmed?.(this._provider.id, storeResult.pieceCid, pieceId)

    return {
      pieceCid: storeResult.pieceCid,
      size: storeResult.size,
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
      failures: [],
    }
  }

  /**
   * Store data on the service provider without committing on-chain.
   *
   * This is the first step of the split upload flow: store → pull → commit.
   * After storing, the piece is "parked" on the provider and ready for:
   * - Retrieval via getPieceUrl() (although it is not yet committed on-chain and is therefore
   *   eligible for garbage collection)
   * - Pulling to other providers via pull()
   * - On-chain commitment via commit()
   *
   * @param data - Data to store (Uint8Array or ReadableStream)
   * @param options - Optional store configuration
   * @returns The PieceCID and size of the stored data
   */
  async store(data: Uint8Array | ReadableStream<Uint8Array>, options?: StoreOptions): Promise<StoreResult> {
    // Validate size for Uint8Array inputs
    if (data instanceof Uint8Array) {
      StorageContext.validateRawSize(data.length, 'store')
    }

    // Upload to service provider
    let uploadResult: SP.UploadPieceResponse
    try {
      uploadResult = await this._pdpServer.uploadPiece(data, {
        pieceCid: options?.pieceCid,
        signal: options?.signal,
        onProgress: options?.onProgress,
      })
    } catch (error) {
      throw createError('StorageContext', 'store', 'Failed to store piece on service provider', error)
    }

    // Poll for piece to be "parked" (ready)
    try {
      await SP.findPiece({
        endpoint: this._pdpEndpoint,
        pieceCid: uploadResult.pieceCid,
        retry: true,
        signal: options?.signal,
      })
    } catch (error) {
      throw createError('StorageContext', 'store', 'Failed to confirm piece storage', error)
    }

    return {
      pieceCid: uploadResult.pieceCid,
      size: uploadResult.size,
    }
  }

  /**
   * Pre-sign EIP-712 extraData for the given pieces.
   *
   * The returned Hex can be passed to both pull() and commit() to avoid
   * redundant wallet signature prompts during multi-copy uploads.
   *
   * @param pieces - Pieces with optional pieceMetadata (must match what commit() will receive)
   * @returns Signed extraData blob
   */
  async presignForCommit(pieces: Array<{ pieceCid: PieceCID; pieceMetadata?: Record<string, string> }>): Promise<Hex> {
    const signingPieces = pieces.map((p) => ({
      pieceCid: p.pieceCid,
      metadata: pieceMetadataObjectToEntry(p.pieceMetadata),
    }))

    if (this._dataSetId) {
      return signAddPieces(this._synapse.client, {
        clientDataSetId: await this.getClientDataSetId(),
        pieces: signingPieces,
      })
    }

    return signCreateDataSetAndAddPieces(this._synapse.client, {
      clientDataSetId: randU256(),
      payee: this._provider.serviceProvider,
      payer: this._synapse.client.account.address,
      metadata: datasetMetadataObjectToEntry(this._dataSetMetadata, {
        cdn: this._withCDN,
      }),
      pieces: signingPieces,
    })
  }

  /**
   * Request this provider to pull pieces from another provider.
   *
   * This is used for multi-copy uploads where data is stored once on a primary
   * provider and then pulled to secondary providers via SP-to-SP transfer.
   *
   * @param options - Pull options including pieces and source
   * @returns Result with status for each piece
   */
  async pull(options: PullOptions): Promise<PullResult> {
    const { pieces, from, signal, onProgress, extraData } = options

    // Resolve source URL
    const getSourceUrl = (pieceCid: PieceCID): string => {
      if (typeof from === 'string') {
        // Base URL provided - append piece path
        return createPieceUrlPDP(pieceCid.toString(), from)
      }
      // PullSource with getPieceUrl method
      return from.getPieceUrl(pieceCid)
    }

    // Build pull pieces input
    const pullPiecesInput = pieces.map((pieceCid) => ({
      pieceCid,
      sourceUrl: getSourceUrl(pieceCid),
    }))

    // Helper to invoke progress callback for each piece in response
    const handleProgressResponse = onProgress
      ? (response: SP.PullResponse) => {
          for (const piece of response.pieces) {
            const pieceCid = pieces.find((p) => p.toString() === piece.pieceCid)
            if (pieceCid) {
              onProgress(pieceCid, piece.status)
            }
          }
        }
      : undefined

    try {
      // Shared options for both existing and new data set paths
      const sharedOptions = {
        endpoint: this._pdpEndpoint,
        pieces: pullPiecesInput,
        signal,
        onStatus: handleProgressResponse,
        extraData,
      }

      // Use existing data set if available, otherwise create new
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

      const response = await waitForPullStatus(this._synapse.client, pullOptions as any)

      // Convert response to PullResult
      const pieceResults = response.pieces.map((piece) => {
        const pieceCid = pieces.find((p) => p.toString() === piece.pieceCid)
        return {
          pieceCid: pieceCid as PieceCID,
          status: piece.status === 'complete' ? ('complete' as const) : ('failed' as const),
          // Note: synapse-core PullPieceStatus doesn't include error details
        }
      })

      const allComplete = pieceResults.every((p) => p.status === 'complete')

      return {
        status: allComplete ? 'complete' : 'failed',
        pieces: pieceResults,
      }
    } catch (error) {
      throw createError('StorageContext', 'pull', 'Failed to pull pieces from source provider', error)
    }
  }

  /**
   * Commit pieces on-chain by calling AddPieces (or CreateDataSetAndAddPieces).
   *
   * This is the final step of the split upload flow. Pieces must be stored
   * on the provider (via store() or pull()) before committing.
   *
   * @param options - Commit options including pieces to commit
   * @returns Transaction hash, piece IDs, and data set ID
   */
  async commit(options: CommitOptions): Promise<CommitResult> {
    const { pieces, extraData } = options

    // Validate metadata early
    for (const piece of pieces) {
      if (piece.pieceMetadata) {
        pieceMetadataObjectToEntry(piece.pieceMetadata)
      }
    }

    const pieceInputs = pieces.map((p) => ({ pieceCid: p.pieceCid, metadata: p.pieceMetadata }))

    try {
      if (this._dataSetId) {
        // Add to existing data set
        const [, clientDataSetId] = await Promise.all([
          this._warmStorageService.validateDataSet(this._dataSetId),
          this.getClientDataSetId(),
        ])

        const addPiecesResult = await this._pdpServer.addPieces(
          this._dataSetId,
          clientDataSetId,
          pieceInputs,
          extraData
        )
        options.onSubmitted?.()

        const addPiecesResponse = await SP.waitForAddPiecesStatus(addPiecesResult)
        const confirmedPieceIds = addPiecesResponse.confirmedPieceIds.map((id) => BigInt(id))

        return {
          txHash: addPiecesResult.txHash as Hex,
          pieceIds: confirmedPieceIds,
          dataSetId: this._dataSetId,
          isNewDataSet: false,
        }
      }

      // Create new data set and add pieces
      const payer = this._synapse.client.account.address
      const metadataObj =
        this._withCDN && !(METADATA_KEYS.WITH_CDN in this._dataSetMetadata)
          ? { ...this._dataSetMetadata, [METADATA_KEYS.WITH_CDN]: '' }
          : this._dataSetMetadata

      // clientDataSetId (first arg) is ignored when extraData is provided - the nonce
      // is already embedded in the EIP-712 signature within extraData
      const createAndAddPiecesResult = await this._pdpServer.createAndAddPieces(
        0n,
        this._provider.serviceProvider,
        payer,
        this._chain.contracts.fwss.address,
        pieceInputs,
        metadataObj,
        extraData
      )
      options.onSubmitted?.()

      const confirmedDataset = await SP.waitForDataSetCreationStatus(createAndAddPiecesResult)
      this._dataSetId = BigInt(confirmedDataset.dataSetId)

      const confirmedPieces = await SP.waitForAddPiecesStatus({
        statusUrl: new URL(
          `/pdp/data-sets/${confirmedDataset.dataSetId}/pieces/added/${confirmedDataset.createMessageHash}`,
          this._pdpEndpoint
        ).toString(),
      })

      const confirmedPieceIds = confirmedPieces.confirmedPieceIds.map((id) => BigInt(id))

      return {
        txHash: createAndAddPiecesResult.txHash as Hex,
        pieceIds: confirmedPieceIds,
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
   *
   * @param pieceCid - The PieceCID to get URL for
   * @returns The full retrieval URL
   */
  getPieceUrl(pieceCid: PieceCID): string {
    return createPieceUrlPDP(pieceCid.toString(), this._pdpEndpoint)
  }

  /**
   * Download data from this specific service provider
   * @param pieceCid - The PieceCID identifier
   * @param options - Download options
   * @returns The downloaded data
   */
  async download(pieceCid: string | PieceCID, options?: DownloadOptions): Promise<Uint8Array> {
    // Pass through to storage manager with our provider hint and withCDN setting
    // Use storage manager if available (production), otherwise use provider download for tests
    const downloadFn = this._synapse.storage?.download ?? this._synapse.download
    return await downloadFn.call(this._synapse.storage ?? this._synapse, pieceCid, {
      providerAddress: this._provider.serviceProvider,
      withCDN: (options as any)?.withCDN ?? this._withCDN,
    })
  }

  /**
   * Download data from the service provider
   * @deprecated Use download() instead. This method will be removed in a future version.
   */
  async providerDownload(pieceCid: string | PieceCID, options?: DownloadOptions): Promise<Uint8Array> {
    console.warn('providerDownload() is deprecated. Use download() instead.')
    return await this.download(pieceCid, options)
  }

  /**
   * Get information about the service provider used by this service
   * @returns Provider information including pricing (currently same for all providers)
   */
  async getProviderInfo(): Promise<PDPProvider> {
    return await this._synapse.getProviderInfo(this.serviceProvider)
  }

  /**
   * Get the list of piece CIDs for this service service's data set.
   * @returns Array of piece CIDs as PieceCID objects
   * @deprecated Use getPieces() generator for better memory efficiency with large data sets
   */
  async getDataSetPieces(): Promise<PieceCID[]> {
    if (this.dataSetId == null) {
      return []
    }

    const pieces: PieceCID[] = []
    for await (const { pieceCid } of this.getPieces()) {
      pieces.push(pieceCid)
    }
    return pieces
  }

  /**
   * Get pieces scheduled for removal from this data set
   * @returns Array of piece IDs scheduled for removal
   */
  async getScheduledRemovals() {
    if (this._dataSetId == null) {
      return []
    }

    const pdpVerifier = new PDPVerifier({
      client: this._synapse.client,
    })

    try {
      return await pdpVerifier.getScheduledRemovals(this._dataSetId)
    } catch (error) {
      throw createError('StorageContext', 'getScheduledRemovals', 'Failed to get scheduled removals', error)
    }
  }

  /**
   * Get all active pieces for this data set as an async generator.
   * This provides lazy evaluation and better memory efficiency for large data sets.
   * @param options - Optional configuration object
   * @param options.batchSize - The batch size for each pagination call (default: 100)
   * @param options.signal - Optional AbortSignal to cancel the operation
   * @yields Object with pieceCid and pieceId - the piece ID is needed for certain operations like deletion
   */
  async *getPieces(options?: { batchSize?: bigint; signal?: AbortSignal }): AsyncGenerator<PieceRecord> {
    if (this._dataSetId == null) {
      return
    }
    const pdpVerifier = new PDPVerifier({
      client: this._synapse.client,
    })

    const batchSize = options?.batchSize ?? 100n
    const signal = options?.signal
    let offset = 0n
    let hasMore = true

    while (hasMore) {
      if (signal?.aborted) {
        throw createError('StorageContext', 'getPieces', 'Operation aborted')
      }

      const result = await pdpVerifier.getActivePieces(this._dataSetId, { offset, limit: batchSize, signal })

      // Yield pieces one by one for lazy evaluation
      for (let i = 0; i < result.pieces.length; i++) {
        if (signal?.aborted) {
          throw createError('StorageContext', 'getPieces', 'Operation aborted')
        }

        yield {
          pieceCid: result.pieces[i].pieceCid,
          pieceId: result.pieces[i].pieceId,
        }
      }

      hasMore = result.hasMore
      offset += batchSize
    }
  }
  private async _getPieceIdByCID(pieceCid: string | PieceCID): Promise<bigint> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'getPieceIdByCID', 'Data set not found')
    }
    const parsedPieceCID = asPieceCID(pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageContext', 'deletePiece', 'Invalid PieceCID provided')
    }

    const dataSetData = await this._pdpServer.getDataSet(this.dataSetId)
    const pieceData = dataSetData.pieces.find((piece) => piece.pieceCid.toString() === parsedPieceCID.toString())
    if (pieceData == null) {
      throw createError('StorageContext', 'deletePiece', 'Piece not found in data set')
    }
    return pieceData.pieceId
  }

  /**
   * Delete a piece with given CID from this data set
   * @param piece - The PieceCID identifier or a piece number to delete by pieceID
   * @returns Transaction hash of the delete operation
   */
  async deletePiece(piece: string | PieceCID | bigint): Promise<Hash> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'deletePiece', 'Data set not found')
    }
    const pieceId = typeof piece === 'bigint' ? piece : await this._getPieceIdByCID(piece)
    const clientDataSetId = await this.getClientDataSetId()

    const { txHash } = await deletePiece(this._synapse.client, {
      endpoint: this._pdpEndpoint,
      dataSetId: this.dataSetId,
      pieceId: pieceId,
      clientDataSetId: clientDataSetId,
    })

    return txHash
  }

  /**
   * Check if a piece exists on this service provider.
   * @param pieceCid - The PieceCID (piece CID) to check
   * @returns True if the piece exists on this provider, false otherwise
   */
  async hasPiece(pieceCid: string | PieceCID): Promise<boolean> {
    const parsedPieceCID = asPieceCID(pieceCid)
    if (parsedPieceCID == null) {
      return false
    }

    try {
      await SP.findPiece({
        endpoint: this._pdpEndpoint,
        pieceCid: parsedPieceCID,
      })
      return true
    } catch {
      return false
    }
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
   * @param pieceCid - The PieceCID (piece CID) to check
   * @returns Status information including existence, data set timing, and retrieval URL
   */
  async pieceStatus(pieceCid: string | PieceCID): Promise<PieceStatus> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'pieceStatus', 'Data set not found')
    }
    const parsedPieceCID = asPieceCID(pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageContext', 'pieceStatus', 'Invalid PieceCID provided')
    }

    // Run multiple operations in parallel for better performance
    const [exists, dataSetData, currentEpoch] = await Promise.all([
      // Check if piece exists on provider
      this.hasPiece(parsedPieceCID),
      // Get data set data
      this._pdpServer
        .getDataSet(this.dataSetId)
        .catch((_error) => {
          // console.debug('Failed to get data set data:', error)
          return null
        }),
      // Get current epoch
      getBlockNumber(this._client),
    ])

    // Initialize return values
    let retrievalUrl: string | null = null
    let pieceId: bigint | undefined
    let lastProven: Date | null = null
    let nextProofDue: Date | null = null
    let inChallengeWindow = false
    let hoursUntilChallengeWindow = 0
    let isProofOverdue = false

    // If piece exists, get provider info for retrieval URL and proving params in parallel
    if (exists) {
      const [providerInfo, pdpConfig] = await Promise.all([
        // Get provider info for retrieval URL
        this.getProviderInfo().catch(() => null),
        dataSetData != null
          ? this._warmStorageService.getPDPConfig().catch((error) => {
              console.debug('Failed to get PDP config:', error)
              return null
            })
          : Promise.resolve(null),
      ])

      // Set retrieval URL if we have provider info
      if (providerInfo != null) {
        retrievalUrl = createPieceUrlPDP(parsedPieceCID.toString(), providerInfo.pdp.serviceURL)
      }

      // Process proof timing data if we have data set data and PDP config
      if (dataSetData != null && pdpConfig != null) {
        // Check if this PieceCID is in the data set
        const pieceData = dataSetData.pieces.find((piece) => piece.pieceCid.toString() === parsedPieceCID.toString())

        if (pieceData != null) {
          pieceId = pieceData.pieceId

          // Calculate timing based on nextChallengeEpoch
          if (dataSetData.nextChallengeEpoch > 0) {
            // nextChallengeEpoch is when the challenge window STARTS, not ends!
            // The proving deadline is nextChallengeEpoch + challengeWindowSize
            const challengeWindowStart = dataSetData.nextChallengeEpoch
            const provingDeadline = challengeWindowStart + Number(pdpConfig.challengeWindowSize)

            // Calculate when the next proof is due (end of challenge window)
            nextProofDue = epochToDate(provingDeadline, this._chain.genesisTimestamp)

            // Calculate last proven date (one proving period before next challenge)
            const lastProvenDate = calculateLastProofDate(
              dataSetData.nextChallengeEpoch,
              Number(pdpConfig.maxProvingPeriod),
              this._chain.genesisTimestamp
            )
            if (lastProvenDate != null) {
              lastProven = lastProvenDate
            }

            // Check if we're in the challenge window
            inChallengeWindow = Number(currentEpoch) >= challengeWindowStart && Number(currentEpoch) < provingDeadline

            // Check if proof is overdue (past the proving deadline)
            isProofOverdue = Number(currentEpoch) >= provingDeadline

            // Calculate hours until challenge window starts (only if before challenge window)
            if (Number(currentEpoch) < challengeWindowStart) {
              const timeUntil = timeUntilEpoch(challengeWindowStart, Number(currentEpoch))
              hoursUntilChallengeWindow = timeUntil.hours
            }
          } else {
            // If nextChallengeEpoch is 0, it might mean:
            // 1. Proof was just submitted and system is updating
            // 2. Data set is not active
            // In case 1, we might have just proven, so set lastProven to very recent
            // This is a temporary state and should resolve quickly
            console.debug('Data set has nextChallengeEpoch=0, may have just been proven')
          }
        }
      }
    }

    return {
      exists,
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
   * Terminates the data set by sending on-chain message.
   * This will also result in the removal of all pieces in the data set.
   * @returns Transaction response
   */
  async terminate(): Promise<Hash> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'terminate', 'Data set not found')
    }
    return this._synapse.storage.terminateDataSet(this.dataSetId)
  }
}
