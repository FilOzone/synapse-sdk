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

import { asChain, type Chain as FilecoinChain } from '@filoz/synapse-core/chains'
import { getProviderIds as getEndorsedProviderIds } from '@filoz/synapse-core/endorsements'
import * as PDPVerifier from '@filoz/synapse-core/pdp-verifier'
import { asPieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { schedulePieceDeletion, type UploadPieceStreamingData } from '@filoz/synapse-core/sp'
import { signAddPieces, signCreateDataSetAndAddPieces } from '@filoz/synapse-core/typed-data'
import {
  calculateLastProofDate,
  createPieceUrlPDP,
  datasetMetadataObjectToEntry,
  epochToDate,
  type MetadataObject,
  pieceMetadataObjectToEntry,
  randIndex,
  randU256,
  timeUntilEpoch,
} from '@filoz/synapse-core/utils'
import type { Account, Address, Chain, Client, Hash, Hex, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CommitOptions,
  CommitResult,
  ContextCreateContextsOptions,
  DownloadOptions,
  PDPProvider,
  PieceCID,
  PieceRecord,
  PieceStatus,
  PreflightInfo,
  ProviderSelectionResult,
  PullOptions,
  PullResult,
  StorageContextCreateOptions,
  StorageServiceOptions,
  StoreOptions,
  StoreResult,
  UploadOptions,
  UploadResult,
} from '../types.ts'
import { createError, SIZE_CONSTANTS } from '../utils/index.ts'
import { combineMetadata, metadataMatches } from '../utils/metadata.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'

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
  private readonly _client: Client<Transport, Chain, Account>
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
   * @param options.context - Context for error messages (e.g., 'upload', 'preflightUpload')
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
        `Data size ${sizeBytes} bytes exceeds maximum allowed size of ${
          SIZE_CONSTANTS.MAX_UPLOAD_SIZE
        } bytes (${Math.floor(SIZE_CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024)} MiB)`
      )
    }
  }

  /**
   * Creates a new StorageContext
   * @param options - The options for the StorageContext {@link StorageContextOptions}
   */
  constructor(options: StorageContextOptions) {
    this._client = options.synapse.client
    this._chain = asChain(this._client.chain)
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
        "Cannot specify both 'dataSetIds' and 'providerIds' - use one or the other"
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
      const uniqueProviderIds = [...new Set(options.providerIds)]
      resolutions = await Promise.all(
        uniqueProviderIds.map((providerId) =>
          StorageContext.resolveByProviderId(
            clientAddress,
            providerId,
            options.metadata ?? {},
            options.warmStorageService,
            spRegistry
          )
        )
      )
    }

    // Fill remaining slots via smart selection if count exceeds explicit resolutions
    const count = options.count ?? (resolutions.length > 0 ? resolutions.length : 2)
    if (resolutions.length < count) {
      const excludeProviderIds = [...(options.excludeProviderIds ?? []), ...resolutions.map((r) => r.provider.id)]

      for (let i = resolutions.length; i < count; i++) {
        try {
          const resolution = await StorageContext.smartSelectProvider(
            clientAddress,
            options.metadata ?? {},
            options.warmStorageService,
            spRegistry,
            excludeProviderIds,
            resolutions.length === 0 ? await getEndorsedProviderIds(options.synapse.client) : new Set<bigint>()
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

    if (resolution.dataSetId !== -1n) {
      options.callbacks?.onDataSetResolved?.({
        isExisting: resolution.dataSetId !== -1n,
        dataSetId: resolution.dataSetId,
        provider: resolution.provider,
      })
    }

    return new StorageContext({
      synapse,
      warmStorageService,
      provider: resolution.provider,
      dataSetId: resolution.dataSetId === -1n ? undefined : resolution.dataSetId,
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
    const requestedMetadata = combineMetadata(options.metadata, options.withCDN)

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
      options.excludeProviderIds ?? [],
      new Set<bigint>()
    )
  }

  /**
   * Resolve using a specific data set ID
   */
  private static async resolveByDataSetId(
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
      isExisting: true,
      dataSetMetadata,
    }
  }

  /**
   * Resolve the best matching DataSet for a Provider using a specific provider ID
   *
   * Selection Logic:
   * 1. Filters for datasets belonging to this provider
   * 2. Sorts by dataSetId ascending (oldest first)
   * 3. Searches in batches for metadata match
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
    const [provider, dataSets] = await Promise.all([
      spRegistry.getProvider({ providerId }),
      warmStorageService.getClientDataSets({ address: clientAddress }),
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
              warmStorageService.getDataSetMetadata({ dataSetId }),
              warmStorageService.getActivePieceCount({ dataSetId }),
              warmStorageService.validateDataSet({ dataSetId }),
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

        if (result.activePieceCount > 0) {
          selectedDataSet = result
          break
        }

        if (selectedDataSet == null) {
          selectedDataSet = result
        }
      }

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

    return {
      provider,
      dataSetId: -1n, // Marker for new data set
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    }
  }

  /**
   * Select a provider and optionally an existing data set for storage.
   *
   * Selection is 2-tier per role. Tier 1 prefers existing data sets (deterministic,
   * sorted by piece count then data set ID). Tier 2 creates a new data set with a
   * random provider. All candidates are ping-validated before selection.
   *
   * Role is determined by {@link endorsedProviderIds}: non-empty restricts to endorsed
   * providers only (primary) and throws if none reachable; empty allows any approved
   * provider (secondary).
   *
   * @param clientAddress - Wallet address to look up existing data sets for
   * @param requestedMetadata - Dataset metadata filter; only data sets with matching metadata are considered
   * @param warmStorageService - Service for data set and provider lookups
   * @param spRegistry - Registry for provider details and PDP endpoints
   * @param excludeProviderIds - Provider IDs to skip (already used by other contexts)
   * @param endorsedProviderIds - Endorsed provider IDs; non-empty = primary (endorsed-only), empty = secondary (any approved)
   * @returns Resolved provider, data set ID (-1n if new), and metadata
   * @throws When no eligible provider passes health check
   */
  private static async smartSelectProvider(
    clientAddress: Address,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    excludeProviderIds: bigint[],
    endorsedProviderIds: Set<bigint>
  ): Promise<ProviderSelectionResult> {
    const dataSets = await warmStorageService.getClientDataSetsWithDetails({ address: clientAddress })

    const skipProviderIds = new Set<bigint>(excludeProviderIds)
    const managedDataSets = dataSets.filter(
      (ps) =>
        ps.isLive &&
        ps.isManaged &&
        ps.pdpEndEpoch === 0n &&
        !skipProviderIds.has(ps.providerId) &&
        metadataMatches(ps.metadata, requestedMetadata)
    )

    type DataSetWithDetails = (typeof managedDataSets)[number]
    const sortDataSets = (sets: DataSetWithDetails[]): DataSetWithDetails[] =>
      [...sets].sort((a, b) => {
        if (a.activePieceCount > 0n && b.activePieceCount === 0n) return -1
        if (b.activePieceCount > 0n && a.activePieceCount === 0n) return 1
        return Number(a.pdpVerifierDataSetId - b.pdpVerifierDataSetId)
      })

    const createDataSetProviderGenerator = (sets: DataSetWithDetails[]) =>
      async function* (): AsyncGenerator<PDPProvider> {
        const yieldedProviders = new Set<bigint>()
        for (const dataSet of sets) {
          if (yieldedProviders.has(dataSet.providerId)) continue
          yieldedProviders.add(dataSet.providerId)
          const provider = await spRegistry.getProvider({ providerId: dataSet.providerId })
          if (provider == null) {
            console.warn(
              `Provider ID ${dataSet.providerId} for data set ${dataSet.pdpVerifierDataSetId} is not currently approved`
            )
            continue
          }
          yield provider
        }
      }

    const createResultFromDataSet = async (
      provider: PDPProvider,
      sets: DataSetWithDetails[]
    ): Promise<ProviderSelectionResult> => {
      const matchingDataSet = sets.find((ps) => ps.providerId === provider.id)
      if (matchingDataSet == null) {
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
      const dataSetMetadata = await warmStorageService.getDataSetMetadata({
        dataSetId: matchingDataSet.pdpVerifierDataSetId,
      })
      return {
        provider,
        dataSetId: matchingDataSet.pdpVerifierDataSetId,
        isExisting: true,
        dataSetMetadata,
      }
    }

    const createNewDataSetResult = (provider: PDPProvider): ProviderSelectionResult => ({
      provider,
      dataSetId: -1n,
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    })

    const isPrimarySelection = endorsedProviderIds.size > 0

    // Fetch approved providers (needed for both paths)
    const approvedIds = await warmStorageService.getApprovedProviderIds()
    const approvedProviders = await spRegistry.getProviders({ providerIds: approvedIds })
    const allProviders = approvedProviders.filter((p: PDPProvider) => !excludeProviderIds.includes(p.id))

    if (isPrimarySelection) {
      // Primary: endorsed providers only, no fallback to non-endorsed
      const endorsedDataSets = managedDataSets.filter((ds) => endorsedProviderIds.has(ds.providerId))

      // Tier 1: Existing data sets with endorsed providers
      if (endorsedDataSets.length > 0) {
        const sorted = sortDataSets(endorsedDataSets)
        const provider = await StorageContext.selectProviderWithPing(createDataSetProviderGenerator(sorted)())
        if (provider != null) {
          return await createResultFromDataSet(provider, sorted)
        }
      }

      // Tier 2: New data set with endorsed provider
      const endorsedProviders = allProviders.filter((p: PDPProvider) => endorsedProviderIds.has(p.id))
      if (endorsedProviders.length > 0) {
        const provider = await StorageContext.selectRandomProvider(endorsedProviders)
        if (provider != null) {
          return createNewDataSetResult(provider)
        }
      }

      // All endorsed providers exhausted, no fall back to non-endorsed, this is a FOC system-level failure for the user
      const endorsedCount = [...endorsedProviderIds].filter((id) => !excludeProviderIds.includes(id)).length
      throw createError(
        'StorageContext',
        'smartSelectProvider',
        endorsedCount > 0
          ? `No endorsed provider available — all ${endorsedCount} endorsed provider(s) failed health check`
          : 'No endorsed provider available'
      )
    }

    // Secondary: any approved provider
    // Tier 1: Existing data sets with any approved provider
    if (managedDataSets.length > 0) {
      const sorted = sortDataSets(managedDataSets)
      const provider = await StorageContext.selectProviderWithPing(createDataSetProviderGenerator(sorted)())
      if (provider != null) {
        return await createResultFromDataSet(provider, sorted)
      }
    }

    // Tier 2: New data set with any approved provider
    if (allProviders.length > 0) {
      const provider = await StorageContext.selectRandomProvider(allProviders)
      if (provider != null) {
        return createNewDataSetResult(provider)
      }
    }

    if (allProviders.length === 0) {
      throw createError('StorageContext', 'smartSelectProvider', NO_REMAINING_PROVIDERS_ERROR_MESSAGE)
    }
    throw createError(
      'StorageContext',
      'smartSelectProvider',
      `All ${allProviders.length} approved provider(s) failed health check`
    )
  }

  /**
   * Select a random provider from a list with ping validation.
   *
   * @param providers - Array of providers to select from
   * @returns Selected provider
   */
  private static async selectRandomProvider(providers: PDPProvider[]): Promise<PDPProvider | null> {
    if (providers.length === 0) {
      return null
    }

    async function* generateRandomProviders(): AsyncGenerator<PDPProvider> {
      const remaining = [...providers]
      while (remaining.length > 0) {
        const selected = remaining.splice(randIndex(remaining.length), 1)[0]
        yield selected
      }
    }

    return await StorageContext.selectProviderWithPing(generateRandomProviders())
  }

  /**
   * Select a provider from an async iterator with ping validation.
   * This is shared logic used by both smart selection and random selection.
   *
   * @param providers - Async iterable of providers to try
   * @returns The first provider that responds
   * @throws If all providers fail
   */
  private static async selectProviderWithPing(providers: AsyncIterable<PDPProvider>): Promise<PDPProvider | null> {
    for await (const provider of providers) {
      try {
        await SP.ping(provider.pdp.serviceURL)
        return provider
      } catch (error) {
        console.warn(
          `Provider ${provider.serviceProvider} failed ping test:`,
          error instanceof Error ? error.message : String(error)
        )
      }
    }

    return null
  }

  /**
   * Static method to perform preflight checks for an upload
   *
   * @param options - Options for the preflight check
   * @param options.size - The size of data to upload in bytes
   * @param options.withCDN - Whether CDN is enabled
   * @param options.warmStorageService - WarmStorageService instance
   * @returns Preflight check results without provider/dataSet specifics
   */
  static async performPreflightCheck(options: {
    size: number
    withCDN: boolean
    warmStorageService: WarmStorageService
  }): Promise<PreflightInfo> {
    const { size, withCDN, warmStorageService } = options
    StorageContext.validateRawSize({ sizeBytes: options.size, context: 'preflightUpload' })

    const allowanceCheck = await warmStorageService.checkAllowanceForStorage({ sizeInBytes: BigInt(size), withCDN })

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
   *
   * @param options - Options for the preflight upload
   * @param options.size - The size of data to upload in bytes
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload(options: { size: number }): Promise<PreflightInfo> {
    return await StorageContext.performPreflightCheck({
      size: options.size,
      withCDN: this._withCDN,
      warmStorageService: this._warmStorageService,
    })
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
   * @param data - Raw bytes or readable stream to upload
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
      })
    } catch (error) {
      throw createError('StorageContext', 'store', 'Failed to store piece on service provider', error)
    }

    try {
      await SP.findPiece({
        serviceURL: this._pdpEndpoint,
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
   * @param pieces - Pieces to sign for, with optional per-piece metadata
   * @returns Signed extraData hex to pass to pull() or commit()
   */
  async presignForCommit(pieces: Array<{ pieceCid: PieceCID; pieceMetadata?: MetadataObject }>): Promise<Hex> {
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
   * Used for multi-copy uploads: data stored once on primary, then pulled to
   * secondaries via SP-to-SP transfer.
   *
   * @param options - Pull options: pieces to pull, source (URL or StorageContext), optional extraData, signal, and onProgress
   * @returns Status per piece ('complete' or 'failed') and overall result
   */
  async pull(options: PullOptions): Promise<PullResult> {
    const { pieces, from, signal, onProgress, extraData } = options

    const getSourceUrl = (pieceCid: PieceCID): string => {
      if (typeof from === 'string') {
        return createPieceUrlPDP({ cid: pieceCid.toString(), serviceURL: from })
      }
      return from.getPieceUrl(pieceCid)
    }

    const pullPiecesInput = pieces.map((pieceCid) => ({
      pieceCid,
      sourceUrl: getSourceUrl(pieceCid),
    }))

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
      const sharedOptions = {
        serviceURL: this._pdpEndpoint,
        pieces: pullPiecesInput,
        signal,
        onStatus: handleProgressResponse,
        extraData,
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

      const response = await SP.waitForPullStatus(this._synapse.client, pullOptions as SP.waitForPullStatus.OptionsType)

      const pieceResults = response.pieces.map((piece: { pieceCid: string; status: string }) => {
        const pieceCid = pieces.find((p) => p.toString() === piece.pieceCid)
        return {
          pieceCid: pieceCid as PieceCID,
          status: piece.status === 'complete' ? ('complete' as const) : ('failed' as const),
        }
      })

      const allComplete = pieceResults.every((p: { status: string }) => p.status === 'complete')

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
   * Pieces must be stored on the provider (via store() or pull()) before committing.
   * Creates a new data set if this context doesn't have one yet.
   *
   * @param options - Pieces to commit with optional pieceMetadata, extraData, and onSubmitted callback
   * @returns Transaction hash, confirmed pieceIds, dataSetId, and whether a new data set was created
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
        // Add pieces to existing data set
        const [, clientDataSetId] = await Promise.all([
          this._warmStorageService.validateDataSet({ dataSetId: this._dataSetId }),
          this.getClientDataSetId(),
        ])

        const addPiecesResult = await SP.addPieces(this._client, {
          dataSetId: this._dataSetId,
          clientDataSetId,
          pieces: pieceInputs,
          serviceURL: this._pdpEndpoint,
          extraData,
        })
        options.onSubmitted?.(addPiecesResult.txHash as Hex)

        const confirmation = await SP.waitForAddPieces(addPiecesResult)
        const confirmedPieceIds = confirmation.confirmedPieceIds

        return {
          txHash: addPiecesResult.txHash as Hex,
          pieceIds: confirmedPieceIds,
          dataSetId: this._dataSetId,
          isNewDataSet: false,
        }
      }

      // Create new data set and add pieces
      const result = await SP.createDataSetAndAddPieces(this._client, {
        cdn: this._withCDN,
        payee: this._provider.serviceProvider,
        payer: this._client.account.address,
        recordKeeper: this._chain.contracts.fwss.address,
        pieces: pieceInputs,
        metadata: this._dataSetMetadata,
        serviceURL: this._pdpEndpoint,
        extraData,
      })
      options.onSubmitted?.(result.txHash as Hex)

      const confirmation = await SP.waitForCreateDataSetAddPieces(result)
      this._dataSetId = confirmation.dataSetId

      return {
        txHash: result.txHash as Hex,
        pieceIds: confirmation.piecesIds,
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
   * @param data - Raw bytes or readable stream to upload
   * @param options - Upload options including callbacks, pieceMetadata, pieceCid, and signal
   * @returns Upload result with pieceCid, size, and a single-element copies array
   */
  async upload(data: UploadPieceStreamingData, options?: UploadOptions): Promise<UploadResult> {
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

  // ==========================================================================
  // Download, piece queries, and data set operations
  // ==========================================================================

  /**
   * Download data from this specific service provider
   */
  async download(options: DownloadOptions): Promise<Uint8Array> {
    return this._synapse.storage.download({
      pieceCid: options.pieceCid,
      providerAddress: this._provider.serviceProvider,
      withCDN: options?.withCDN ?? this._withCDN,
    })
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

    return await PDPVerifier.getScheduledRemovals(this._client, { dataSetId: this._dataSetId })
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

    const batchSize = options?.batchSize ?? 100n
    let offset = 0n
    let hasMore = true

    while (hasMore) {
      const result = await PDPVerifier.getActivePieces(this._client, {
        dataSetId: this._dataSetId,
        offset,
        limit: batchSize,
      })

      for (let i = 0; i < result.pieces.length; i++) {
        yield {
          pieceCid: result.pieces[i].cid,
          pieceId: result.pieces[i].id,
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

    const dataSetData = await SP.getDataSet({
      serviceURL: this._pdpEndpoint,
      dataSetId: this.dataSetId,
    })
    const pieceData = dataSetData.pieces.find((piece) => piece.pieceCid.toString() === parsedPieceCID.toString())
    if (pieceData == null) {
      throw createError('StorageContext', 'deletePiece', 'Piece not found in data set')
    }
    return pieceData.pieceId
  }

  /**
   * Delete a piece with given CID from this data set.
   *
   * @param options - Options for the delete operation
   * @param options.piece - The PieceCID identifier or a piece number to delete by pieceID
   * @returns Transaction hash of the delete operation
   */
  async deletePiece(options: { piece: string | PieceCID | bigint }): Promise<Hash> {
    const { piece } = options
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'deletePiece', 'Data set not found')
    }
    const pieceId = typeof piece === 'bigint' ? piece : await this._getPieceIdByCID(piece)
    const clientDataSetId = await this.getClientDataSetId()

    const { hash } = await schedulePieceDeletion(this._synapse.client, {
      serviceURL: this._pdpEndpoint,
      dataSetId: this.dataSetId,
      pieceId: pieceId,
      clientDataSetId: clientDataSetId,
    })

    return hash
  }

  /**
   * Check if a piece exists on this service provider.
   *
   * @param options - Options for the has piece operation
   * @param options.pieceCid - The PieceCID (piece CID) to check
   * @returns True if the piece exists on this provider, false otherwise
   */
  async hasPiece(options: { pieceCid: string | PieceCID }): Promise<boolean> {
    const { pieceCid } = options
    const parsedPieceCID = asPieceCID(pieceCid)
    if (parsedPieceCID == null) {
      return false
    }

    try {
      await SP.findPiece({
        serviceURL: this._pdpEndpoint,
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
   * @param options - Options for the piece status
   * @param options.pieceCid - The PieceCID (piece CID) to check
   * @returns Status information including existence, data set timing, and retrieval URL
   */
  async pieceStatus(options: { pieceCid: string | PieceCID }): Promise<PieceStatus> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'pieceStatus', 'Data set not found')
    }
    const parsedPieceCID = asPieceCID(options.pieceCid)
    if (parsedPieceCID == null) {
      throw createError('StorageContext', 'pieceStatus', 'Invalid PieceCID provided')
    }

    // Run multiple operations in parallel for better performance
    const [exists, dataSetData, currentEpoch] = await Promise.all([
      // Check if piece exists on provider
      this.hasPiece({ pieceCid: parsedPieceCID }),
      // Get data set data
      SP.getDataSet({
        serviceURL: this._pdpEndpoint,
        dataSetId: this.dataSetId,
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
        retrievalUrl = createPieceUrlPDP({
          cid: parsedPieceCID.toString(),
          serviceURL: providerInfo.pdp.serviceURL,
        })
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
    return this._synapse.storage.terminateDataSet({ dataSetId: this.dataSetId })
  }
}
