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

import { asPieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { randIndex, randU256 } from '@filoz/synapse-core/utils'
import type { ethers } from 'ethers'
import type { Hex } from 'viem'
import type { PaymentsService } from '../payments/index.ts'
import { PDPAuthHelper, PDPServer } from '../pdp/index.ts'
import { PDPVerifier } from '../pdp/verifier.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { ProviderInfo } from '../sp-registry/types.ts'
import type { Synapse } from '../synapse.ts'
import type {
  CreateContextsOptions,
  DataSetInfo,
  DownloadOptions,
  MetadataEntry,
  PieceCID,
  PieceStatus,
  PreflightInfo,
  ProviderSelectionResult,
  StorageServiceOptions,
  UploadCallbacks,
  UploadOptions,
  UploadResult,
} from '../types.ts'
import {
  calculateLastProofDate,
  createError,
  epochToDate,
  getCurrentEpoch,
  METADATA_KEYS,
  SIZE_CONSTANTS,
  timeUntilEpoch,
} from '../utils/index.ts'
import { combineMetadata, metadataMatches, objectToEntries, validatePieceMetadata } from '../utils/metadata.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'

const NO_REMAINING_PROVIDERS_ERROR_MESSAGE = 'No approved service providers available'

export class StorageContext {
  private readonly _synapse: Synapse
  private readonly _provider: ProviderInfo
  private readonly _pdpServer: PDPServer
  private readonly _warmStorageService: WarmStorageService
  private readonly _warmStorageAddress: string
  private readonly _withCDN: boolean
  private readonly _signer: ethers.Signer
  private readonly _uploadBatchSize: number
  private _dataSetId: number | undefined
  private readonly _dataSetMetadata: Record<string, string>

  // AddPieces batching state
  private _pendingPieces: Array<{
    pieceCid: PieceCID
    resolve: (pieceId: number) => void
    reject: (error: Error) => void
    callbacks?: UploadCallbacks
    metadata?: MetadataEntry[]
  }> = []

  private _isProcessing: boolean = false

  // Upload tracking for batching (using symbols for simple idempotency)
  private _activeUploads: Set<symbol> = new Set()
  // Timeout to wait before processing batch if there are other in-progress uploads, this allows
  // more uploads to join our batch
  private readonly _uploadBatchWaitTimeout: number = 15000 // 15 seconds, half Filecoin's blocktime

  // Public properties from interface
  public readonly serviceProvider: string

  // Getter for withCDN
  get withCDN(): boolean {
    return this._withCDN
  }

  // Getter for provider info
  get provider(): ProviderInfo {
    return this._provider
  }

  // Getter for data set metadata
  get dataSetMetadata(): Record<string, string> {
    return this._dataSetMetadata
  }

  // Getter for data set ID
  get dataSetId(): number | undefined {
    return this._dataSetId
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
    provider: ProviderInfo,
    dataSetId: number | undefined,
    options: StorageServiceOptions,
    dataSetMetadata: Record<string, string>
  ) {
    this._synapse = synapse
    this._provider = provider
    this._withCDN = options.withCDN ?? false
    this._signer = synapse.getSigner()
    this._warmStorageService = warmStorageService
    this._uploadBatchSize = Math.max(1, options.uploadBatchSize ?? SIZE_CONSTANTS.DEFAULT_UPLOAD_BATCH_SIZE)
    this._dataSetMetadata = dataSetMetadata

    // Set public properties
    this._dataSetId = dataSetId
    this.serviceProvider = provider.serviceProvider

    // Get WarmStorage address from Synapse (which already handles override)
    this._warmStorageAddress = synapse.getWarmStorageAddress()

    // Create PDPAuthHelper for signing operations
    const authHelper = new PDPAuthHelper(this._warmStorageAddress, this._signer, BigInt(synapse.getChainId()))

    // Create PDPServer instance with provider URL from PDP product
    if (!provider.products.PDP?.data.serviceURL) {
      throw new Error(`Provider ${provider.id} does not have a PDP product with serviceURL`)
    }
    this._pdpServer = new PDPServer(authHelper, provider.products.PDP.data.serviceURL)
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
    const clientAddress = await synapse.getClient().getAddress()
    const registryAddress = warmStorageService.getServiceProviderRegistryAddress()
    const spRegistry = new SPRegistryService(synapse.getProvider(), registryAddress)
    if (options.dataSetIds) {
      const selections = []
      for (const dataSetId of new Set(options.dataSetIds)) {
        selections.push(
          StorageContext.resolveByDataSetId(dataSetId, warmStorageService, spRegistry, clientAddress, {
            withCDN: options.withCDN,
            withIpni: options.withIpni,
            dev: options.dev,
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
            options.forceCreateDataSets ?? false,
            options.withIpni ?? false,
            options.dev ?? false
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
    const registryAddress = warmStorageService.getServiceProviderRegistryAddress()
    const spRegistry = new SPRegistryService(synapse.getProvider(), registryAddress)

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

    if (resolution.dataSetId !== -1) {
      options.callbacks?.onDataSetResolved?.({
        isExisting: resolution.dataSetId !== -1,
        dataSetId: resolution.dataSetId,
        provider: resolution.provider,
      })
    }

    return new StorageContext(
      synapse,
      warmStorageService,
      resolution.provider,
      resolution.dataSetId === -1 ? undefined : resolution.dataSetId,
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
    const clientAddress = await synapse.getClient().getAddress()

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
      options.forceCreateDataSet ?? false,
      options.withIpni ?? false,
      options.dev ?? false
    )
  }

  /**
   * Resolve using a specific data set ID
   */
  private static async resolveByDataSetId(
    dataSetId: number,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    signerAddress: string,
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    const [dataSetInfo, dataSetMetadata] = await Promise.all([
      warmStorageService.getDataSet(dataSetId).then(async (dataSetInfo) => {
        await StorageContext.validateDataSetConsistency(dataSetInfo, options, spRegistry)
        return dataSetInfo
      }),
      warmStorageService.getDataSetMetadata(dataSetId),
      warmStorageService.validateDataSet(dataSetId),
    ])

    if (dataSetInfo.payer.toLowerCase() !== signerAddress.toLowerCase()) {
      throw createError(
        'StorageContext',
        'resolveByDataSetId',
        `Data set ${dataSetId} is not owned by ${signerAddress} (owned by ${dataSetInfo.payer})`
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

    const withCDN = dataSetInfo.cdnRailId > 0
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
      const actualProvider = await spRegistry.getProvider(dataSet.providerId)
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
   * Resolve using a specific provider ID
   */
  private static async resolveByProviderId(
    signerAddress: string,
    providerId: number,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    forceCreateDataSet?: boolean
  ): Promise<ProviderSelectionResult> {
    // Fetch provider (always) and dataSets (only if not forcing) in parallel
    const [provider, dataSets] = await Promise.all([
      spRegistry.getProvider(providerId),
      forceCreateDataSet ? Promise.resolve(null) : warmStorageService.getClientDataSetsWithDetails(signerAddress),
    ])

    if (provider == null) {
      throw createError('StorageContext', 'resolveByProviderId', `Provider ID ${providerId} not found in registry`)
    }

    // If forcing creation, skip the search for existing data sets
    if (forceCreateDataSet === true) {
      return {
        provider,
        dataSetId: -1, // Marker for new data set
        isExisting: false,
        dataSetMetadata: requestedMetadata,
      }
    }

    // dataSets is guaranteed non-null here since forceCreateDataSet is false

    // Filter for this provider's data sets with matching metadata
    const providerDataSets = (
      dataSets as Awaited<ReturnType<typeof warmStorageService.getClientDataSetsWithDetails>>
    ).filter((ps) => {
      if (ps.providerId !== provider.id || !ps.isLive || !ps.isManaged || ps.pdpEndEpoch !== 0) {
        return false
      }
      // Check if metadata matches
      return metadataMatches(ps.metadata, requestedMetadata)
    })

    if (providerDataSets.length > 0) {
      // Sort by preference: data sets with pieces first, then by ID
      const sorted = providerDataSets.sort((a, b) => {
        if (a.currentPieceCount > 0 && b.currentPieceCount === 0) return -1
        if (b.currentPieceCount > 0 && a.currentPieceCount === 0) return 1
        return a.pdpVerifierDataSetId - b.pdpVerifierDataSetId
      })

      // Fetch metadata for existing data set
      const dataSetMetadata = await warmStorageService.getDataSetMetadata(sorted[0].pdpVerifierDataSetId)

      return {
        provider,
        dataSetId: sorted[0].pdpVerifierDataSetId,
        isExisting: true,
        dataSetMetadata,
      }
    }

    // Need to create new data set
    return {
      provider,
      dataSetId: -1, // Marker for new data set
      isExisting: false,
      dataSetMetadata: requestedMetadata,
    }
  }

  /**
   * Resolve using a specific provider address
   */
  private static async resolveByProviderAddress(
    providerAddress: string,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    signerAddress: string,
    requestedMetadata: Record<string, string>,
    forceCreateDataSet?: boolean
  ): Promise<ProviderSelectionResult> {
    // Get provider by address
    const provider = await spRegistry.getProviderByAddress(providerAddress)
    if (provider == null) {
      throw createError(
        'StorageContext',
        'resolveByProviderAddress',
        `Provider ${providerAddress} not found in registry`
      )
    }

    // Use the providerId resolution logic
    return await StorageContext.resolveByProviderId(
      signerAddress,
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
    signerAddress: string,
    requestedMetadata: Record<string, string>,
    warmStorageService: WarmStorageService,
    spRegistry: SPRegistryService,
    excludeProviderIds: number[],
    forceCreateDataSet: boolean,
    withIpni: boolean,
    dev: boolean
  ): Promise<ProviderSelectionResult> {
    // Strategy:
    // 1. Try to find existing data sets first
    // 2. If no existing data sets, find a healthy provider

    // Get client's data sets
    const dataSets = await warmStorageService.getClientDataSetsWithDetails(signerAddress)

    const skipProviderIds = new Set<number>(excludeProviderIds)
    // Filter for managed data sets with matching metadata
    const managedDataSets = dataSets.filter(
      (ps) =>
        ps.isLive &&
        ps.isManaged &&
        ps.pdpEndEpoch === 0 &&
        metadataMatches(ps.metadata, requestedMetadata) &&
        !skipProviderIds.has(ps.providerId)
    )

    if (managedDataSets.length > 0 && !forceCreateDataSet) {
      // Prefer data sets with pieces, sort by ID (older first)
      const sorted = managedDataSets.sort((a, b) => {
        if (a.currentPieceCount > 0 && b.currentPieceCount === 0) return -1
        if (b.currentPieceCount > 0 && a.currentPieceCount === 0) return 1
        return a.pdpVerifierDataSetId - b.pdpVerifierDataSetId
      })

      // Create async generator that yields providers lazily
      async function* generateProviders(): AsyncGenerator<ProviderInfo> {
        // First, yield providers from existing data sets (in sorted order)
        for (const dataSet of sorted) {
          if (skipProviderIds.has(dataSet.providerId)) {
            continue
          }
          skipProviderIds.add(dataSet.providerId)
          const provider = await spRegistry.getProvider(dataSet.providerId)

          if (provider == null) {
            console.warn(
              `Provider ID ${dataSet.providerId} for data set ${dataSet.pdpVerifierDataSetId} is not currently approved`
            )
            continue
          }

          if (withIpni && provider.products.PDP?.data.ipniIpfs === false) {
            continue
          }

          const serviceStatus = provider.products.PDP?.capabilities?.serviceStatus
          if (!dev && serviceStatus === '0x646576') {
            // "dev" in hex
            continue
          }

          yield provider
        }
      }

      try {
        const selectedProvider = await StorageContext.selectProviderWithPing(generateProviders())

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
          const dataSetMetadata = await warmStorageService.getDataSetMetadata(matchingDataSet.pdpVerifierDataSetId)

          return {
            provider: selectedProvider,
            dataSetId: matchingDataSet.pdpVerifierDataSetId,
            isExisting: true,
            dataSetMetadata,
          }
        }
      } catch (_error) {
        console.warn('All providers from existing data sets failed health check. Falling back to all providers.')
        // Fall through to select from all approved providers below
      }
    }

    // No existing data sets - select from all approved providers. First we get approved IDs from
    // WarmStorage, then fetch provider details.
    const approvedIds = await warmStorageService.getApprovedProviderIds()
    const approvedProviders = await spRegistry.getProviders(approvedIds)
    const allProviders = approvedProviders.filter(
      (provider: ProviderInfo) =>
        (!withIpni || provider.products.PDP?.data.ipniIpfs === true) &&
        (dev || provider.products.PDP?.capabilities?.serviceStatus !== '0x646576') &&
        !excludeProviderIds.includes(provider.id)
    )

    if (allProviders.length === 0) {
      throw createError('StorageContext', 'smartSelectProvider', NO_REMAINING_PROVIDERS_ERROR_MESSAGE)
    }

    // Random selection from all providers
    const provider = await StorageContext.selectRandomProvider(allProviders)

    return {
      provider,
      dataSetId: -1, // Marker for new data set
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
  private static async selectRandomProvider(providers: ProviderInfo[]): Promise<ProviderInfo> {
    if (providers.length === 0) {
      throw createError('StorageContext', 'selectRandomProvider', 'No providers available')
    }

    // Create async generator that yields providers in random order
    async function* generateRandomProviders(): AsyncGenerator<ProviderInfo> {
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
  private static async selectProviderWithPing(providers: AsyncIterable<ProviderInfo>): Promise<ProviderInfo> {
    let providerCount = 0

    // Try providers in order until we find one that responds to ping
    for await (const provider of providers) {
      providerCount++
      try {
        // Create a temporary PDPServer for this specific provider's endpoint
        if (!provider.products.PDP?.data.serviceURL) {
          // Skip providers without PDP products
          continue
        }
        const providerPdpServer = new PDPServer(null, provider.products.PDP.data.serviceURL)
        await providerPdpServer.ping()
        return provider
      } catch (error) {
        console.warn(
          `Provider ${provider.serviceProvider} failed ping test:`,
          error instanceof Error ? error.message : String(error)
        )
        // Continue to next provider
      }
    }

    // All providers failed ping test
    if (providerCount === 0) {
      throw createError('StorageContext', 'selectProviderWithPing', 'No providers available to select from')
    }

    throw createError(
      'StorageContext',
      'selectProviderWithPing',
      `All ${providerCount} providers failed health check. Storage may be temporarily unavailable.`
    )
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
    performance.mark('synapse:upload-start')

    // Validation Phase: Check data size and calculate pieceCid
    let size: number | undefined
    const pieceCid = options?.pieceCid
    if (data instanceof Uint8Array) {
      size = data.length
      StorageContext.validateRawSize(size, 'upload')
    }
    // Note: Size is unknown for streams (size will be undefined)

    // Track this upload for batching purposes
    const uploadId = Symbol('upload')
    this._activeUploads.add(uploadId)

    try {
      let uploadResult: SP.UploadPieceResponse
      // Upload Phase: Upload data to service provider
      try {
        performance.mark('synapse:pdpServer.uploadPiece-start')
        uploadResult = await this._pdpServer.uploadPiece(data, {
          ...options,
          pieceCid,
        })
        performance.mark('synapse:pdpServer.uploadPiece-end')
        performance.measure(
          'synapse:pdpServer.uploadPiece',
          'synapse:pdpServer.uploadPiece-start',
          'synapse:pdpServer.uploadPiece-end'
        )
      } catch (error) {
        performance.mark('synapse:pdpServer.uploadPiece-end')
        performance.measure(
          'synapse:pdpServer.uploadPiece',
          'synapse:pdpServer.uploadPiece-start',
          'synapse:pdpServer.uploadPiece-end'
        )
        throw createError('StorageContext', 'uploadPiece', 'Failed to upload piece to service provider', error)
      }

      // Poll for piece to be "parked" (ready)
      performance.mark('synapse:findPiece-start')
      await this._pdpServer.findPiece(uploadResult.pieceCid)
      performance.mark('synapse:findPiece-end')
      performance.measure('synapse:findPiece', 'synapse:findPiece-start', 'synapse:findPiece-end')

      // Upload phase complete - remove from active tracking
      this._activeUploads.delete(uploadId)

      // Notify upload complete
      if (options?.onUploadComplete != null) {
        options.onUploadComplete(uploadResult.pieceCid)
      }

      // Add Piece Phase: Queue the AddPieces operation for sequential processing

      // Validate metadata early (before queueing) to fail fast
      if (options?.metadata != null) {
        validatePieceMetadata(options.metadata)
      }

      const finalPieceId = await new Promise<number>((resolve, reject) => {
        // Add to pending batch
        this._pendingPieces.push({
          pieceCid: uploadResult.pieceCid,
          resolve,
          reject,
          callbacks: options,
          metadata: options?.metadata ? objectToEntries(options.metadata) : undefined,
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
      const metadataArray: MetadataEntry[][] = batch.map((item) => item.metadata ?? [])
      const confirmedPieceIds: number[] = []

      if (this.dataSetId) {
        const [, dataSetInfo] = await Promise.all([
          this._warmStorageService.validateDataSet(this.dataSetId),
          this._warmStorageService.getDataSet(this.dataSetId),
        ])
        // Add pieces to the data set
        const addPiecesResult = await this._pdpServer.addPieces(
          this.dataSetId, // PDPVerifier data set ID
          dataSetInfo.clientDataSetId, // Client's dataset ID
          pieceCids,
          metadataArray
        )

        // Notify callbacks with transaction
        batch.forEach((item) => {
          item.callbacks?.onPieceAdded?.(addPiecesResult.txHash as Hex)
        })
        const addPiecesResponse = await SP.pollForAddPiecesStatus(addPiecesResult)

        // Handle transaction tracking if available
        confirmedPieceIds.push(...(addPiecesResponse.confirmedPieceIds ?? []))

        batch.forEach((item) => {
          item.callbacks?.onPieceConfirmed?.(confirmedPieceIds)
        })
      } else {
        const payer = await this._synapse.getClient().getAddress()
        // Prepare metadata - merge withCDN flag into metadata if needed
        const baseMetadataObj = this._dataSetMetadata ?? {}
        const metadataObj =
          this._withCDN && !(METADATA_KEYS.WITH_CDN in baseMetadataObj)
            ? { ...baseMetadataObj, [METADATA_KEYS.WITH_CDN]: '' }
            : baseMetadataObj

        // Convert to MetadataEntry[] for PDP operations (requires ordered array)
        const finalMetadata = objectToEntries(metadataObj)
        // Create a new data set and add pieces to it
        const createAndAddPiecesResult = await this._pdpServer.createAndAddPieces(
          randU256(),
          this._provider.payee,
          payer,
          this._synapse.getWarmStorageAddress(),
          pieceCids,
          {
            dataset: finalMetadata,
            pieces: metadataArray,
          }
        )
        batch.forEach((item) => {
          item.callbacks?.onPieceAdded?.(createAndAddPiecesResult.txHash as Hex)
        })
        const confirmedDataset = await SP.pollForDataSetCreationStatus(createAndAddPiecesResult)
        this._dataSetId = confirmedDataset.dataSetId

        const confirmedPieces = await SP.pollForAddPiecesStatus({
          statusUrl: new URL(
            `/pdp/data-sets/${confirmedDataset.dataSetId}/pieces/added/${confirmedDataset.createMessageHash}`,
            this._pdpServer.getServiceURL()
          ).toString(),
        })

        confirmedPieceIds.push(...(confirmedPieces.confirmedPieceIds ?? []))

        batch.forEach((item) => {
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
  async getProviderInfo(): Promise<ProviderInfo> {
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
   * Get all active pieces for this data set as an async generator.
   * This provides lazy evaluation and better memory efficiency for large data sets.
   * @param options - Optional configuration object
   * @param options.batchSize - The batch size for each pagination call (default: 100)
   * @param options.signal - Optional AbortSignal to cancel the operation
   * @yields Object with pieceCid and pieceId - the piece ID is needed for certain operations like deletion
   */
  async *getPieces(options?: {
    batchSize?: number
    signal?: AbortSignal
  }): AsyncGenerator<{ pieceCid: PieceCID; pieceId: number }> {
    if (this._dataSetId == null) {
      return
    }
    const pdpVerifierAddress = this._warmStorageService.getPDPVerifierAddress()
    const pdpVerifier = new PDPVerifier(this._synapse.getProvider(), pdpVerifierAddress)

    const batchSize = options?.batchSize ?? 100
    const signal = options?.signal
    let offset = 0
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
  private async _getPieceIdByCID(pieceCid: string | PieceCID): Promise<number> {
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
  async deletePiece(piece: string | PieceCID | number): Promise<string> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'deletePiece', 'Data set not found')
    }
    const pieceId = typeof piece === 'number' ? piece : await this._getPieceIdByCID(piece)
    const dataSetInfo = await this._warmStorageService.getDataSet(this.dataSetId)

    return this._pdpServer.deletePiece(this.dataSetId, dataSetInfo.clientDataSetId, pieceId)
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
      await this._pdpServer.findPiece(parsedPieceCID)
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
        .catch((error) => {
          console.debug('Failed to get data set data:', error)
          return null
        }),
      // Get current epoch
      getCurrentEpoch(this._synapse.getProvider()),
    ])
    const network = this._synapse.getNetwork()

    // Initialize return values
    let retrievalUrl: string | null = null
    let pieceId: number | undefined
    let lastProven: Date | null = null
    let nextProofDue: Date | null = null
    let inChallengeWindow = false
    let hoursUntilChallengeWindow = 0
    let isProofOverdue = false

    // If piece exists, get provider info for retrieval URL and proving params in parallel
    if (exists) {
      const [providerInfo, provingParams] = await Promise.all([
        // Get provider info for retrieval URL
        this.getProviderInfo().catch(() => null),
        // Get proving period configuration (only if we have data set data)
        dataSetData != null
          ? Promise.all([this._warmStorageService.getMaxProvingPeriod(), this._warmStorageService.getChallengeWindow()])
              .then(([maxProvingPeriod, challengeWindow]) => ({
                maxProvingPeriod,
                challengeWindow,
              }))
              .catch(() => null)
          : Promise.resolve(null),
      ])

      // Set retrieval URL if we have provider info
      if (providerInfo != null) {
        // Remove trailing slash from serviceURL to avoid double slashes
        if (!providerInfo.products.PDP?.data.serviceURL) {
          throw new Error(`Provider ${providerInfo.id} does not have a PDP product with serviceURL`)
        }
        retrievalUrl = `${providerInfo.products.PDP.data.serviceURL.replace(
          /\/$/,
          ''
        )}/piece/${parsedPieceCID.toString()}`
      }

      // Process proof timing data if we have data set data and proving params
      if (dataSetData != null && provingParams != null) {
        // Check if this PieceCID is in the data set
        const pieceData = dataSetData.pieces.find((piece) => piece.pieceCid.toString() === parsedPieceCID.toString())

        if (pieceData != null) {
          pieceId = pieceData.pieceId

          // Calculate timing based on nextChallengeEpoch
          if (dataSetData.nextChallengeEpoch > 0) {
            // nextChallengeEpoch is when the challenge window STARTS, not ends!
            // The proving deadline is nextChallengeEpoch + challengeWindow
            const challengeWindowStart = dataSetData.nextChallengeEpoch
            const provingDeadline = challengeWindowStart + provingParams.challengeWindow

            // Calculate when the next proof is due (end of challenge window)
            nextProofDue = epochToDate(provingDeadline, network)

            // Calculate last proven date (one proving period before next challenge)
            const lastProvenDate = calculateLastProofDate(
              dataSetData.nextChallengeEpoch,
              provingParams.maxProvingPeriod,
              network
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
  async terminate(): Promise<ethers.TransactionResponse> {
    if (this.dataSetId == null) {
      throw createError('StorageContext', 'terminate', 'Data set not found')
    }
    return this._synapse.storage.terminateDataSet(this.dataSetId)
  }
}
