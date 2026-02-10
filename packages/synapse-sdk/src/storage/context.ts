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
import { getProviderIds } from '@filoz/synapse-core/endorsements'
import * as PDPVerifier from '@filoz/synapse-core/pdp-verifier'
import { asPieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { schedulePieceDeletion, type UploadPieceStreamingData } from '@filoz/synapse-core/sp'
import {
  calculateLastProofDate,
  createPieceUrlPDP,
  epochToDate,
  type MetadataObject,
  pieceMetadataObjectToEntry,
  randIndex,
  timeUntilEpoch,
} from '@filoz/synapse-core/utils'
import type { Account, Address, Chain, Client, Hash, Hex, Transport } from 'viem'
import { getBlockNumber } from 'viem/actions'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CreateContextsOptions,
  DataSetInfo,
  DownloadOptions,
  PDPProvider,
  PieceCID,
  PieceRecord,
  PieceStatus,
  PreflightInfo,
  ProviderSelectionResult,
  StorageServiceOptions,
  UploadCallbacks,
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
  private readonly _warmStorageService: WarmStorageService
  private readonly _withCDN: boolean
  private readonly _uploadBatchSize: number
  private _dataSetId: bigint | undefined
  private _clientDataSetId: bigint | undefined
  private readonly _dataSetMetadata: Record<string, string>

  // AddPieces batching state
  private _pendingPieces: Array<{
    pieceCid: PieceCID
    resolve: (pieceId: bigint) => void
    reject: (error: Error) => void
    callbacks?: UploadCallbacks
    metadata?: MetadataObject
  }> = []

  private _isProcessing: boolean = false

  // Upload tracking for batching (using symbols for simple idempotency)
  private _activeUploads: Set<symbol> = new Set()
  // Timeout to wait before processing batch if there are other in-progress uploads, this allows
  // more uploads to join our batch
  private readonly _uploadBatchWaitTimeout: number = 15000 // 15 seconds, half Filecoin's blocktime

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
    options: StorageServiceOptions,
    dataSetMetadata: Record<string, string>
  ) {
    this._client = synapse.client
    this._chain = asChain(this._client.chain)
    this._synapse = synapse
    this._provider = provider
    this._withCDN = options.withCDN ?? false
    this._warmStorageService = warmStorageService
    this._uploadBatchSize = Math.max(1, options.uploadBatchSize ?? SIZE_CONSTANTS.DEFAULT_UPLOAD_BATCH_SIZE)
    this._dataSetMetadata = dataSetMetadata

    // Set public properties
    this._dataSetId = dataSetId
    this.serviceProvider = provider.serviceProvider

    this._pdpEndpoint = provider.pdp.serviceURL
  }

  /**
   * Creates new storage contexts with specified options
   * Each context corresponds to a different data set
   */
  static async createContexts(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: CreateContextsOptions
  ): Promise<StorageContext[]> {
    const count = options?.count ?? 2
    const resolutions: ProviderSelectionResult[] = []
    const clientAddress = synapse.client.account.address
    const spRegistry = new SPRegistryService({ client: synapse.client })
    if (options.dataSetIds) {
      const selections = []
      for (const dataSetId of new Set(options.dataSetIds)) {
        selections.push(
          StorageContext.resolveByDataSetId(dataSetId, warmStorageService, spRegistry, clientAddress, {
            withCDN: options.withCDN,
            withIpni: options.withIpni,
            metadata: options.metadata,
          })
        )
        if (selections.length >= count) {
          break
        }
      }
      resolutions.push(...(await Promise.all(selections)))
    }
    const resolvedProviderIds = resolutions.map((resolution) => resolution.provider.id)
    if (resolutions.length < count) {
      if (options.providerIds) {
        const selections = []
        // NOTE: Set.difference is unavailable in some targets
        for (const providerId of [...new Set(options.providerIds)].filter(
          (providerId) => !resolvedProviderIds.includes(providerId)
        )) {
          selections.push(
            StorageContext.resolveByProviderId(
              clientAddress,
              providerId,
              options.metadata ?? {},
              warmStorageService,
              spRegistry,
              options.forceCreateDataSets
            )
          )
          resolvedProviderIds.push(providerId)
          if (selections.length + resolutions.length >= count) {
            break
          }
        }
        resolutions.push(...(await Promise.all(selections)))
      }
    }
    if (resolutions.length < count) {
      const excludeProviderIds = [...(options.excludeProviderIds ?? []), ...resolvedProviderIds]
      for (let i = resolutions.length; i < count; i++) {
        try {
          const resolution = await StorageContext.smartSelectProvider(
            clientAddress,
            options.metadata ?? {},
            warmStorageService,
            spRegistry,
            excludeProviderIds,
            resolutions.length === 0 ? await getProviderIds(synapse.client) : new Set<bigint>(),
            options.forceCreateDataSets ?? false,
            options.withIpni ?? false
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
    options: StorageServiceOptions = {}
  ): Promise<StorageContext> {
    // Create SPRegistryService
    const spRegistry = new SPRegistryService({ client: synapse.client })

    // Resolve provider and data set based on options
    const resolution = await StorageContext.resolveProviderAndDataSet(synapse, warmStorageService, spRegistry, options)

    return await StorageContext.createWithSelectedProvider(resolution, synapse, warmStorageService, options)
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
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    const clientAddress = synapse.client.account.address

    // Handle explicit data set ID selection (highest priority)
    if (options.dataSetId != null && options.forceCreateDataSet !== true) {
      return await StorageContext.resolveByDataSetId(
        options.dataSetId,
        warmStorageService,
        spRegistry,
        clientAddress,
        options
      )
    }

    // Convert options to metadata format - merge withCDN flag into metadata if needed
    const requestedMetadata = combineMetadata(options.metadata, options.withCDN)

    // Handle explicit provider ID selection
    if (options.providerId != null) {
      return await StorageContext.resolveByProviderId(
        clientAddress,
        options.providerId,
        requestedMetadata,
        warmStorageService,
        spRegistry,
        options.forceCreateDataSet
      )
    }

    // Handle explicit provider address selection
    if (options.providerAddress != null) {
      return await StorageContext.resolveByProviderAddress(
        options.providerAddress,
        warmStorageService,
        spRegistry,
        clientAddress,
        requestedMetadata,
        options.forceCreateDataSet
      )
    }

    // Smart selection when no specific parameters provided
    return await StorageContext.smartSelectProvider(
      clientAddress,
      requestedMetadata,
      warmStorageService,
      spRegistry,
      options.excludeProviderIds ?? [],
      new Set<bigint>(),
      options.forceCreateDataSet ?? false,
      options.withIpni ?? false
    )
  }

  /**
   * Resolve using a specific data set ID
   */
  private static async resolveByDataSetId(
    dataSetId: bigint,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    clientAddress: string,
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    const [dataSetInfo, dataSetMetadata] = await Promise.all([
      warmStorageService.getDataSet({ dataSetId }).then(async (dataSetInfo) => {
        if (dataSetInfo == null) {
          return null
        }
        await StorageContext.validateDataSetConsistency(dataSetInfo, options, spRegistry)
        return dataSetInfo
      }),
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

    const withCDN = dataSetInfo.cdnRailId > 0 && METADATA_KEYS.WITH_CDN in dataSetMetadata
    if (options.withCDN != null && withCDN !== options.withCDN) {
      throw createError(
        'StorageContext',
        'resolveByDataSetId',
        `Data set ${dataSetId} has CDN ${withCDN ? 'enabled' : 'disabled'}, ` +
          `but requested ${options.withCDN ? 'enabled' : 'disabled'}`
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
   * Validate data set consistency with provided options
   */
  private static async validateDataSetConsistency(
    dataSet: DataSetInfo,
    options: StorageServiceOptions,
    spRegistry: SPRegistryService
  ): Promise<void> {
    // Validate provider ID if specified
    if (options.providerId != null) {
      if (dataSet.providerId !== options.providerId) {
        throw createError(
          'StorageContext',
          'validateDataSetConsistency',
          `Data set belongs to provider ID ${dataSet.providerId}, but provider ID ${options.providerId} was requested`
        )
      }
    }

    // Validate provider address if specified
    if (options.providerAddress != null) {
      // Look up the actual provider to get its serviceProvider address
      const actualProvider = await spRegistry.getProvider({ providerId: dataSet.providerId })
      if (
        actualProvider == null ||
        actualProvider.serviceProvider.toLowerCase() !== options.providerAddress.toLowerCase()
      ) {
        throw createError(
          'StorageContext',
          'validateDataSetConsistency',
          `Data set belongs to provider ${actualProvider?.serviceProvider ?? 'unknown'}, but provider ${options.providerAddress} was requested`
        )
      }
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
    spRegistry: SPRegistryService,
    forceCreateDataSet?: boolean
  ): Promise<ProviderSelectionResult> {
    // Fetch provider (always) and dataSets (only if not forcing) in parallel
    const [provider, dataSets] = await Promise.all([
      spRegistry.getProvider({ providerId }),
      forceCreateDataSet ? Promise.resolve([]) : warmStorageService.getClientDataSets({ address: clientAddress }),
    ])

    if (provider == null) {
      throw createError('StorageContext', 'resolveByProviderId', `Provider ID ${providerId} not found in registry`)
    }

    if (forceCreateDataSet === true) {
      return {
        provider,
        dataSetId: -1n, // Marker for new data set
        isExisting: false,
        dataSetMetadata: requestedMetadata,
      }
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
   * Resolve using a specific provider address
   */
  private static async resolveByProviderAddress(
    providerAddress: Address,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    clientAddress: Address,
    requestedMetadata: Record<string, string>,
    forceCreateDataSet?: boolean
  ): Promise<ProviderSelectionResult> {
    // Get provider by address
    const provider = await spRegistry.getProviderByAddress({ address: providerAddress })
    if (provider == null) {
      throw createError(
        'StorageContext',
        'resolveByProviderAddress',
        `Provider ${providerAddress} not found in registry`
      )
    }

    // Use the providerId resolution logic
    return await StorageContext.resolveByProviderId(
      clientAddress,
      provider.id,
      requestedMetadata,
      warmStorageService,
      spRegistry,
      forceCreateDataSet
    )
  }

  /**
   * Smart provider selection algorithm
   * Prioritizes existing data sets and provider health
   */
  private static async smartSelectProvider(
    clientAddress: Address,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    excludeProviderIds: bigint[],
    endorsedProviderIds: Set<bigint>,
    forceCreateDataSet: boolean,
    withIpni: boolean
  ): Promise<ProviderSelectionResult> {
    // Strategy:
    // 1. Try to find existing data sets first
    // 2. If no existing data sets, find a healthy provider

    // Get client's data sets
    const dataSets = await warmStorageService.getClientDataSetsWithDetails({ address: clientAddress })

    const skipProviderIds = new Set<bigint>(excludeProviderIds)
    // Filter for managed data sets with matching metadata
    const managedDataSets = dataSets.filter(
      (ps) =>
        ps.isLive &&
        ps.isManaged &&
        ps.pdpEndEpoch === 0n &&
        metadataMatches(ps.metadata, requestedMetadata) &&
        !skipProviderIds.has(ps.providerId)
    )

    if (managedDataSets.length > 0 && !forceCreateDataSet) {
      // Prefer data sets with pieces, sort by ID (older first)
      const sorted = managedDataSets.sort((a, b) => {
        if (a.activePieceCount > 0n && b.activePieceCount === 0n) return -1
        if (b.activePieceCount > 0n && a.activePieceCount === 0n) return 1
        return Number(a.pdpVerifierDataSetId - b.pdpVerifierDataSetId)
      })

      // Create async generator that yields providers lazily
      async function* generateProviders(): AsyncGenerator<PDPProvider> {
        // First, yield providers from existing data sets (in sorted order)
        for (const dataSet of sorted) {
          if (skipProviderIds.has(dataSet.providerId)) {
            continue
          }
          skipProviderIds.add(dataSet.providerId)
          const provider = await spRegistry.getProvider({ providerId: dataSet.providerId })

          if (provider == null) {
            console.warn(
              `Provider ID ${dataSet.providerId} for data set ${dataSet.pdpVerifierDataSetId} is not currently approved`
            )
            continue
          }

          if (withIpni && provider.pdp.ipniIpfs === false) {
            continue
          }

          yield provider
        }
      }

      const selectedProvider = await StorageContext.selectProviderWithPing(generateProviders())

      if (selectedProvider != null) {
        // Find the first matching data set ID for this provider
        // Match by provider ID (stable identifier in the registry)
        const matchingDataSet = sorted.find((ps) => ps.providerId === selectedProvider.id)

        if (matchingDataSet == null) {
          console.warn(
            `Could not match selected provider ${selectedProvider.serviceProvider} (ID: ${selectedProvider.id}) ` +
              `to existing data sets. Falling back to selecting from all providers.`
          )
          // Fall through to select from all approved providers below
        } else {
          // Fetch metadata for existing data set
          const dataSetMetadata = await warmStorageService.getDataSetMetadata({
            dataSetId: matchingDataSet.pdpVerifierDataSetId,
          })

          return {
            provider: selectedProvider,
            dataSetId: matchingDataSet.pdpVerifierDataSetId,
            isExisting: true,
            dataSetMetadata,
          }
        }
      }
    }

    // No existing data sets - select from all approved providers. First we get approved IDs from
    // WarmStorage, then fetch provider details.
    const approvedIds = await warmStorageService.getApprovedProviderIds()
    const approvedProviders = await spRegistry.getProviders({ providerIds: approvedIds })
    const allProviders = approvedProviders.filter(
      (provider: PDPProvider) =>
        (!withIpni || provider.pdp.ipniIpfs === true) && !excludeProviderIds.includes(provider.id)
    )

    if (allProviders.length === 0) {
      throw createError('StorageContext', 'smartSelectProvider', NO_REMAINING_PROVIDERS_ERROR_MESSAGE)
    }

    let provider: PDPProvider | null
    if (endorsedProviderIds.size > 0) {
      // Split providers according to whether they have all of the endorsements
      const [otherProviders, endorsedProviders] = allProviders.reduce<[PDPProvider[], PDPProvider[]]>(
        (results: [PDPProvider[], PDPProvider[]], provider: PDPProvider) => {
          results[endorsedProviderIds.has(provider.id) ? 1 : 0].push(provider)
          return results
        },
        [[], []]
      )
      provider =
        (await StorageContext.selectRandomProvider(endorsedProviders)) ||
        (await StorageContext.selectRandomProvider(otherProviders))
    } else {
      // Random selection from all providers
      provider = await StorageContext.selectRandomProvider(allProviders)
    }

    if (provider == null) {
      throw createError(
        'StorageContext',
        'selectProviderWithPing',
        `All ${allProviders.length} providers failed health check. Storage may be temporarily unavailable.`
      )
    }

    return {
      provider,
      dataSetId: -1n, // Marker for new data set
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    }
  }

  /**
   * Select a random provider from a list with ping validation
   * @param providers - Array of providers to select from
   * @param withIpni - Filter for IPNI support
   * @param dev - Include dev providers
   * @returns Selected provider
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
    size: number,
    withCDN: boolean
  ): Promise<PreflightInfo> {
    // Validate size before proceeding
    StorageContext.validateRawSize(size, 'preflightUpload')

    // Check allowances and get costs in a single call
    const allowanceCheck = await warmStorageService.checkAllowanceForStorage({ sizeInBytes: BigInt(size), withCDN })

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
    const preflightResult = await StorageContext.performPreflightCheck(this._warmStorageService, size, this._withCDN)

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
  async upload(data: UploadPieceStreamingData, options?: UploadOptions): Promise<UploadResult> {
    performance.mark('synapse:upload-start')

    // Validation Phase: Check data size and calculate pieceCid
    const pieceCid = options?.pieceCid
    // Note: Size is unknown for streams (size will be undefined)

    // Track this upload for batching purposes
    const uploadId = Symbol('upload')
    this._activeUploads.add(uploadId)

    try {
      let uploadResult: SP.uploadPieceStreaming.OutputType
      // Upload Phase: Upload data to service provider
      try {
        uploadResult = await SP.uploadPieceStreaming({
          serviceURL: this._pdpEndpoint,
          data,
          ...options,
          pieceCid,
        })
      } catch (error) {
        throw createError('StorageContext', 'uploadPiece', 'Failed to upload piece to service provider', error)
      }

      // Poll for piece to be "parked" (ready)
      await SP.findPiece({
        serviceURL: this._pdpEndpoint,
        pieceCid: uploadResult.pieceCid,
        retry: true,
      })

      // Upload phase complete - remove from active tracking
      this._activeUploads.delete(uploadId)

      // Notify upload complete
      if (options?.onUploadComplete != null) {
        options.onUploadComplete(uploadResult.pieceCid)
      }

      // Add Piece Phase: Queue the AddPieces operation for sequential processing

      // Validate metadata early (before queueing) to fail fast
      if (options?.metadata != null) {
        pieceMetadataObjectToEntry(options.metadata)
      }

      const finalPieceId = await new Promise<bigint>((resolve, reject) => {
        // Add to pending batch
        this._pendingPieces.push({
          pieceCid: uploadResult.pieceCid,
          resolve,
          reject,
          callbacks: options,
          metadata: options?.metadata,
        })

        // Debounce: defer processing to next event loop tick
        // This allows multiple synchronous upload() calls to queue up before processing
        setTimeout(() => {
          void this._processPendingPieces().catch((error) => {
            console.error('Failed to process pending pieces batch:', error)
          })
        }, 0)
      })

      // Return upload result
      performance.mark('synapse:upload-end')
      performance.measure('synapse:upload', 'synapse:upload-start', 'synapse:upload-end')
      return {
        pieceCid: uploadResult.pieceCid,
        size: uploadResult.size,
        pieceId: finalPieceId,
      }
    } finally {
      this._activeUploads.delete(uploadId)
    }
  }

  /**
   * Process pending pieces by batching them into a single AddPieces operation
   * This method is called from the promise queue to ensure sequential execution
   */
  private async _processPendingPieces(): Promise<void> {
    if (this._isProcessing || this._pendingPieces.length === 0) {
      return
    }
    this._isProcessing = true

    // Wait for any in-flight uploads to complete before processing, but only if we don't
    // already have a full batch - no point waiting for more if we can process a full batch now.
    // Snapshot the current uploads so we don't wait for new uploads that start during our wait.
    const uploadsToWaitFor = new Set(this._activeUploads)

    if (uploadsToWaitFor.size > 0 && this._pendingPieces.length < this._uploadBatchSize) {
      const waitStart = Date.now()
      const pollInterval = 200

      while (uploadsToWaitFor.size > 0 && Date.now() - waitStart < this._uploadBatchWaitTimeout) {
        // Check which of our snapshot uploads have completed
        for (const uploadId of uploadsToWaitFor) {
          if (!this._activeUploads.has(uploadId)) {
            uploadsToWaitFor.delete(uploadId)
          }
        }

        if (uploadsToWaitFor.size > 0) {
          await new Promise((resolve) => setTimeout(resolve, pollInterval))
        }
      }

      const waited = Date.now() - waitStart
      if (waited > pollInterval) {
        console.debug(`Waited ${waited}ms for ${uploadsToWaitFor.size} active upload(s) to complete`)
      }
    }

    // Extract up to uploadBatchSize pending pieces
    const batch = this._pendingPieces.splice(0, this._uploadBatchSize)
    try {
      // Create piece data array and metadata from the batch
      const pieceCids: PieceCID[] = batch.map((item) => item.pieceCid)
      const confirmedPieceIds: bigint[] = []
      const addedPieceRecords = pieceCids.map((pieceCid) => ({ pieceCid }))

      if (this.dataSetId) {
        const [, clientDataSetId] = await Promise.all([
          this._warmStorageService.validateDataSet({ dataSetId: this.dataSetId }),
          this.getClientDataSetId(),
        ])
        // Add pieces to the data set
        const addPiecesResult = await SP.addPieces(this._client, {
          dataSetId: this.dataSetId, // PDPVerifier data set ID
          clientDataSetId, // Client's dataset nonce
          pieces: batch.map((item) => ({ pieceCid: item.pieceCid, metadata: item.metadata })),
          serviceURL: this._pdpEndpoint,
        })

        // Notify callbacks with transaction
        batch.forEach((item) => {
          item.callbacks?.onPiecesAdded?.(addPiecesResult.txHash as Hex, addedPieceRecords)
          item.callbacks?.onPieceAdded?.(addPiecesResult.txHash as Hex)
        })
        const confirmation = await SP.waitForAddPieces(addPiecesResult)

        // Handle transaction tracking if available
        confirmedPieceIds.push(...confirmation.confirmedPieceIds)

        const confirmedPieceRecords: PieceRecord[] = confirmedPieceIds.map((pieceId, index) => ({
          pieceId,
          pieceCid: pieceCids[index],
        }))

        batch.forEach((item) => {
          item.callbacks?.onPiecesConfirmed?.(this.dataSetId as bigint, confirmedPieceRecords)
          item.callbacks?.onPieceConfirmed?.(confirmedPieceIds)
        })
      } else {
        // Create a new data set and add pieces to it
        const result = await SP.createDataSetAndAddPieces(this._client, {
          cdn: this._withCDN,
          payee: this._provider.serviceProvider,
          payer: this._client.account.address,
          recordKeeper: this._chain.contracts.fwss.address,
          pieces: batch.map((item) => ({ pieceCid: item.pieceCid, metadata: item.metadata })),
          metadata: this._dataSetMetadata,
          serviceURL: this._pdpEndpoint,
        })
        batch.forEach((item) => {
          item.callbacks?.onPiecesAdded?.(result.txHash as Hex, addedPieceRecords)
          item.callbacks?.onPieceAdded?.(result.txHash as Hex)
        })
        const confirmation = await SP.waitForCreateDataSetAddPieces(result)
        this._dataSetId = confirmation.dataSetId
        confirmedPieceIds.push(...confirmation.piecesIds)

        const confirmedPieceRecords: PieceRecord[] = confirmedPieceIds.map((pieceId, index) => ({
          pieceId,
          pieceCid: pieceCids[index],
        }))
        batch.forEach((item) => {
          item.callbacks?.onPiecesConfirmed?.(this.dataSetId as bigint, confirmedPieceRecords)
          item.callbacks?.onPieceConfirmed?.(confirmedPieceIds)
        })
      }

      // Resolve all promises in the batch with their respective piece IDs
      batch.forEach((item, index) => {
        const pieceId = confirmedPieceIds[index]
        if (pieceId == null) {
          throw createError('StorageContext', 'addPieces', `Server did not return piece ID for piece at index ${index}`)
        }
        item.resolve(pieceId)
      })
    } catch (error) {
      // Reject all promises in the batch
      const finalError = createError('StorageContext', 'addPieces', 'Failed to add piece to data set', error)
      batch.forEach((item) => {
        item.reject(finalError)
      })
    } finally {
      this._isProcessing = false
      if (this._pendingPieces.length > 0) {
        void this._processPendingPieces().catch((error) => {
          console.error('Failed to process pending pieces batch:', error)
        })
      }
    }
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

    return await PDPVerifier.getScheduledRemovals(this._client, { dataSetId: this._dataSetId })
  }

  /**
   * Get all active pieces for this data set as an async generator.
   * This provides lazy evaluation and better memory efficiency for large data sets.
   * @param options - Optional configuration object
   * @param options.batchSize - The batch size for each pagination call (default: 100)
   * @yields Object with pieceCid and pieceId - the piece ID is needed for certain operations like deletion
   */
  async *getPieces(options?: { batchSize?: bigint }): AsyncGenerator<PieceRecord> {
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

      // Yield pieces one by one for lazy evaluation
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
    return this._synapse.storage.terminateDataSet(this.dataSetId)
  }
}
