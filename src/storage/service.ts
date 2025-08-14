/**
 * StorageService - High-level interface for storage operations with automatic provider selection
 *
 * This service provides a simplified interface for uploading and downloading data
 * to/from Filecoin service providers. It handles:
 * - Automatic provider selection based on availability
 * - Data set creation and management
 * - CommP calculation and validation
 * - Payment rail setup through Warm Storage
 *
 * @example
 * ```typescript
 * // Create storage service (auto-selects provider)
 * const storage = await synapse.createStorage()
 *
 * // Upload data
 * const result = await storage.upload(data)
 * console.log('Stored at:', result.commp)
 *
 * // Download data
 * const retrieved = await storage.download(result.commp)
 * ```
 */

import { ethers } from 'ethers'
import type {
  StorageServiceOptions,
  CommP, CommPv2,
  ApprovedProviderInfo,
  UploadCallbacks,
  UploadResult,
  PieceData,
  StorageCreationCallbacks,
  ProviderSelectionResult,
  DownloadOptions,
  PreflightInfo,
  EnhancedDataSetInfo,
  PieceStatus
} from '../types.js'
import { type Synapse } from '../synapse.js'
import { type WarmStorageService } from '../warm-storage/index.js'
import { PDPAuthHelper, PDPServer } from '../pdp/index.js'
import { asCommP } from '../commp/index.js'
import { createError, SIZE_CONSTANTS, TIMING_CONSTANTS, epochToDate, calculateLastProofDate, timeUntilEpoch, getCurrentEpoch } from '../utils/index.js'

export class StorageService {
  private readonly _synapse: Synapse
  private readonly _provider: ApprovedProviderInfo
  private readonly _pdpServer: PDPServer
  private readonly _warmStorageService: WarmStorageService
  private readonly _warmStorageAddress: string
  private readonly _withCDN: boolean
  private readonly _dataSetId: number
  private readonly _signer: ethers.Signer
  private readonly _uploadBatchSize: number

  // AddPieces batching state
  private _pendingPieces: Array<{
    pieceData: PieceData
    resolve: (pieceId: number) => void
    reject: (error: Error) => void
    callbacks?: UploadCallbacks
  }> = []

  private _isProcessing: boolean = false

  // Public properties from interface
  public readonly dataSetId: string
  public readonly serviceProvider: string

  /**
   * Validate data size against minimum and maximum limits
   * @param sizeBytes - Size of data in bytes
   * @param context - Context for error messages (e.g., 'upload', 'preflightUpload')
   * @throws Error if size is outside allowed limits
   */
  private static validateRawSize (sizeBytes: number, context: string): void {
    if (sizeBytes < SIZE_CONSTANTS.MIN_UPLOAD_SIZE) {
      throw createError(
        'StorageService',
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
      //  - Combine the pieces using "subPieces" and an aggregate CommP in our AddRoots call
      throw createError(
        'StorageService',
        context,
        `Data size ${sizeBytes} bytes exceeds maximum allowed size of ${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes (${Math.floor(SIZE_CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024)} MiB)`
      )
    }
  }

  constructor (
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    provider: ApprovedProviderInfo,
    dataSetId: number,
    options: StorageServiceOptions
  ) {
    this._synapse = synapse
    this._provider = provider
    this._dataSetId = dataSetId
    this._withCDN = options.withCDN ?? false
    this._signer = synapse.getSigner()
    this._warmStorageService = warmStorageService
    this._uploadBatchSize = Math.max(1, options.uploadBatchSize ?? SIZE_CONSTANTS.DEFAULT_UPLOAD_BATCH_SIZE)

    // Set public properties
    this.dataSetId = dataSetId.toString()
    this.serviceProvider = provider.serviceProvider

    // Get WarmStorage address from Synapse (which already handles override)
    this._warmStorageAddress = synapse.getWarmStorageAddress()

    // Create PDPAuthHelper for signing operations
    const authHelper = new PDPAuthHelper(
      this._warmStorageAddress,
      this._signer,
      BigInt(synapse.getChainId())
    )

    // Create PDPServer instance with provider URL
    this._pdpServer = new PDPServer(
      authHelper,
      provider.serviceURL
    )
  }

  /**
   * Static factory method to create a StorageService
   * Handles provider selection and data set selection/creation
   */
  static async create (
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: StorageServiceOptions = {}
  ): Promise<StorageService> {
    // Resolve provider and data set based on options
    const resolution = await StorageService.resolveProviderAndDataSet(
      synapse,
      warmStorageService,
      options
    )

    // Notify callback about provider selection
    try {
      options.callbacks?.onProviderSelected?.(resolution.provider)
    } catch (error) {
      // Log but don't propagate callback errors
      console.error('Error in onProviderSelected callback:', error)
    }

    // If we need to create a new data set
    let finalDataSetId: number
    if (resolution.dataSetId === -1 || options.forceCreateDataSet === true) {
      // Need to create new data set
      finalDataSetId = await StorageService.createDataSet(
        synapse,
        warmStorageService,
        resolution.provider,
        options.withCDN ?? false,
        options.callbacks
      )
    } else {
      // Use existing data set
      finalDataSetId = resolution.dataSetId

      // Notify callback about resolved data set
      try {
        options.callbacks?.onDataSetResolved?.({
          isExisting: resolution.isExisting ?? true,
          dataSetId: finalDataSetId,
          provider: resolution.provider
        })
      } catch (error) {
        console.error('Error in onDataSetResolved callback:', error)
      }
    }

    return new StorageService(synapse, warmStorageService, resolution.provider, finalDataSetId, options)
  }

  /**
   * Create a new data set with the selected provider
   */
  private static async createDataSet (
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    provider: ApprovedProviderInfo,
    withCDN: boolean,
    callbacks?: StorageCreationCallbacks
  ): Promise<number> {
    performance.mark('synapse:createDataSet-start')

    const signer = synapse.getSigner()
    const signerAddress = await signer.getAddress()

    // Create a new data set

    // Get next client dataset ID
    const nextDatasetId = await warmStorageService.getNextClientDataSetId(signerAddress)

    // Create auth helper for signing
    const warmStorageAddress = synapse.getWarmStorageAddress()
    const authHelper = new PDPAuthHelper(
      warmStorageAddress,
      signer,
      BigInt(synapse.getChainId())
    )

    // Create PDPServer instance for API calls
    const pdpServer = new PDPServer(
      authHelper,
      provider.serviceURL
    )

    // Create the data set through the provider
    performance.mark('synapse:pdpServer.createDataSet-start')
    const createResult = await pdpServer.createDataSet(
      nextDatasetId, // clientDataSetId
      provider.serviceProvider, // payee (service provider address)
      withCDN,
      warmStorageAddress // recordKeeper (WarmStorage contract)
    )
    performance.mark('synapse:pdpServer.createDataSet-end')
    performance.measure('synapse:pdpServer.createDataSet', 'synapse:pdpServer.createDataSet-start', 'synapse:pdpServer.createDataSet-end')

    // createDataSet returns CreateDataSetResponse with txHash and statusUrl
    const { txHash, statusUrl } = createResult

    // Fetch the transaction object from the chain with retry logic
    const ethersProvider = synapse.getProvider()
    let transaction: ethers.TransactionResponse | null = null

    // Retry if the transaction is not found immediately
    const txRetryStartTime = Date.now()
    const txPropagationTimeout = TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS
    const txPropagationPollInterval = TIMING_CONSTANTS.TRANSACTION_PROPAGATION_POLL_INTERVAL_MS

    performance.mark('synapse:getTransaction-start')
    while (Date.now() - txRetryStartTime < txPropagationTimeout) {
      try {
        transaction = await ethersProvider.getTransaction(txHash)
        if (transaction !== null) {
          break // Transaction found, exit retry loop
        }
      } catch (error) {
        // Log error but continue retrying
        console.warn(`Failed to fetch transaction ${txHash}, retrying...`, error)
      }

      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, txPropagationPollInterval))
    }
    performance.mark('synapse:getTransaction-end')
    performance.measure('synapse:getTransaction', 'synapse:getTransaction-start', 'synapse:getTransaction-end')

    // If transaction still not found after retries, throw error
    if (transaction === null) {
      throw createError(
        'StorageService',
        'create',
        `Transaction ${txHash} not found after ${txPropagationTimeout / 1000} seconds. The transaction may not have propagated to the RPC node.`
      )
    }

    // Fire callback
    try {
      callbacks?.onDataSetCreationStarted?.(transaction, statusUrl)
    } catch (error) {
      console.error('Error in onDataSetCreationStarted callback:', error)
    }

    // Wait for the data set creation to be confirmed on-chain with progress callbacks
    let finalStatus: Awaited<ReturnType<typeof warmStorageService.getComprehensiveDataSetStatus>>

    performance.mark('synapse:waitForDataSetCreationWithStatus-start')
    try {
      finalStatus = await warmStorageService.waitForDataSetCreationWithStatus(
        transaction,
        pdpServer,
        TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS,
        TIMING_CONSTANTS.DATA_SET_CREATION_POLL_INTERVAL_MS,
        async (status, elapsedMs) => {
          // Fire progress callback
          if (callbacks?.onDataSetCreationProgress != null) {
            try {
              // Get receipt if transaction is mined
              let receipt: ethers.TransactionReceipt | undefined
              if (status.chainStatus.transactionMined && status.chainStatus.blockNumber != null) {
                try {
                  // Use transaction.wait() which is more efficient than getTransactionReceipt
                  const txReceipt = await transaction.wait(TIMING_CONSTANTS.TRANSACTION_CONFIRMATIONS)
                  receipt = txReceipt ?? undefined
                } catch (error) {
                  console.error('Failed to fetch transaction receipt:', error)
                }
              }

              callbacks.onDataSetCreationProgress({
                transactionMined: status.chainStatus.transactionMined,
                transactionSuccess: status.chainStatus.transactionSuccess,
                dataSetLive: status.chainStatus.dataSetLive,
                serverConfirmed: status.serverStatus?.ok === true,
                dataSetId: status.summary.dataSetId ?? undefined,
                elapsedMs,
                receipt
              })
            } catch (error) {
              console.error('Error in onDataSetCreationProgress callback:', error)
            }
          }
        }
      )
    } catch (error) {
      performance.mark('synapse:waitForDataSetCreationWithStatus-end')
      performance.measure('synapse:waitForDataSetCreationWithStatus', 'synapse:waitForDataSetCreationWithStatus-start', 'synapse:waitForDataSetCreationWithStatus-end')
      throw createError(
        'StorageService',
        'waitForDataSetCreation',
        error instanceof Error ? error.message : 'Data set creation failed'
      )
    }
    performance.mark('synapse:waitForDataSetCreationWithStatus-end')
    performance.measure('synapse:waitForDataSetCreationWithStatus', 'synapse:waitForDataSetCreationWithStatus-start', 'synapse:waitForDataSetCreationWithStatus-end')

    if (!finalStatus.summary.isComplete || finalStatus.summary.dataSetId == null) {
      throw createError(
        'StorageService',
        'waitForDataSetCreation',
        `Data set creation failed: ${finalStatus.summary.error ?? 'Transaction may have failed'}`
      )
    }

    const dataSetId = finalStatus.summary.dataSetId

    // Fire resolved callback
    try {
      callbacks?.onDataSetResolved?.({
        isExisting: false,
        dataSetId,
        provider
      })
    } catch (error) {
      console.error('Error in onDataSetResolved callback:', error)
    }

    performance.mark('synapse:createDataSet-end')
    performance.measure('synapse:createDataSet', 'synapse:createDataSet-start', 'synapse:createDataSet-end')
    return dataSetId
  }

  /**
   * Resolve provider and data set based on provided options
   * Uses lazy loading to minimize RPC calls
   */
  private static async resolveProviderAndDataSet (
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    const signer = synapse.getSigner()
    const signerAddress = await signer.getAddress()

    // Handle explicit data set ID selection (highest priority)
    if (options.dataSetId != null) {
      return await StorageService.resolveByDataSetId(
        options.dataSetId,
        warmStorageService,
        signerAddress,
        options
      )
    }

    // Handle explicit provider ID selection
    if (options.providerId != null) {
      return await StorageService.resolveByProviderId(
        signerAddress,
        options.providerId,
        options.withCDN ?? false,
        warmStorageService
      )
    }

    // Handle explicit provider address selection
    if (options.providerAddress != null) {
      return await StorageService.resolveByProviderAddress(
        options.providerAddress,
        warmStorageService,
        signerAddress,
        options.withCDN ?? false
      )
    }

    // Smart selection when no specific parameters provided
    return await StorageService.smartSelectProvider(
      signerAddress,
      options.withCDN ?? false,
      warmStorageService,
      signer
    )
  }

  /**
   * Resolve using a specific data set ID
   */
  private static async resolveByDataSetId (
    dataSetId: number,
    warmStorageService: WarmStorageService,
    signerAddress: string,
    options: StorageServiceOptions
  ): Promise<ProviderSelectionResult> {
    // Fetch data sets to find the specific one
    const dataSets = await warmStorageService.getClientDataSetsWithDetails(signerAddress)
    const dataSet = dataSets.find(ds => ds.pdpVerifierDataSetId === dataSetId)

    if (dataSet == null || !dataSet.isLive || !dataSet.isManaged) {
      throw createError(
        'StorageService',
        'resolveByDataSetId',
        `Data set ${dataSetId} not found, not owned by ${signerAddress}, ` +
        'or not managed by the current WarmStorage contract'
      )
    }

    // Validate consistency with other parameters if provided
    if (options.providerId != null || options.providerAddress != null) {
      await StorageService.validateDataSetConsistency(dataSet, options, warmStorageService)
    }

    // Look up provider by address
    const providerId = await warmStorageService.getProviderIdByAddress(dataSet.payee)
    if (providerId === 0) {
      throw createError(
        'StorageService',
        'resolveByDataSetId',
        `Provider ${dataSet.payee} for data set ${dataSetId} is not currently approved`
      )
    }

    const provider = await warmStorageService.getApprovedProvider(providerId)

    // Validate CDN settings match if specified
    if (options.withCDN != null && dataSet.withCDN !== options.withCDN) {
      throw createError(
        'StorageService',
        'resolveByDataSetId',
        `Data set ${dataSetId} has CDN ${dataSet.withCDN ? 'enabled' : 'disabled'}, ` +
        `but requested ${options.withCDN ? 'enabled' : 'disabled'}`
      )
    }

    return {
      provider,
      dataSetId,
      isExisting: true
    }
  }

  /**
   * Validate data set consistency with provided options
   */
  private static async validateDataSetConsistency (
    dataSet: EnhancedDataSetInfo,
    options: StorageServiceOptions,
    warmStorageService: WarmStorageService
  ): Promise<void> {
    // Validate provider ID if specified
    if (options.providerId != null) {
      const actualProviderId = await warmStorageService.getProviderIdByAddress(dataSet.payee)
      if (actualProviderId !== options.providerId) {
        throw createError(
          'StorageService',
          'validateDataSetConsistency',
          `Data set ${dataSet.pdpVerifierDataSetId} belongs to provider ID ${actualProviderId}, ` +
          `but provider ID ${options.providerId} was requested`
        )
      }
    }

    // Validate provider address if specified
    if (options.providerAddress != null) {
      if (dataSet.payee.toLowerCase() !== options.providerAddress.toLowerCase()) {
        throw createError(
          'StorageService',
          'validateDataSetConsistency',
          `Data set ${dataSet.pdpVerifierDataSetId} belongs to provider ${dataSet.payee}, ` +
          `but provider ${options.providerAddress} was requested`
        )
      }
    }
  }

  /**
   * Resolve using a specific provider ID
   */
  private static async resolveByProviderId (
    signerAddress: string,
    providerId: number,
    withCDN: boolean,
    warmStorageService: WarmStorageService
  ): Promise<{
      provider: ApprovedProviderInfo
      dataSetId: number
      isExisting: boolean
    }> {
    // Fetch provider info and data sets in parallel
    const [provider, dataSets] = await Promise.all([
      warmStorageService.getApprovedProvider(providerId),
      warmStorageService.getClientDataSetsWithDetails(signerAddress)
    ])

    if (provider.serviceProvider === '0x0000000000000000000000000000000000000000') {
      throw createError(
        'StorageService',
        'resolveByProviderId',
        `Provider ID ${providerId} is not currently approved`
      )
    }

    // Filter for this provider's data sets
    const providerDataSets = dataSets.filter(
      ps => ps.payee.toLowerCase() === provider.serviceProvider.toLowerCase() &&
            ps.isLive &&
            ps.isManaged &&
            ps.withCDN === withCDN
    )

    if (providerDataSets.length > 0) {
      // Sort by preference: data sets with pieces first, then by ID
      const sorted = providerDataSets.sort((a, b) => {
        if (a.currentPieceCount > 0 && b.currentPieceCount === 0) return -1
        if (b.currentPieceCount > 0 && a.currentPieceCount === 0) return 1
        return a.pdpVerifierDataSetId - b.pdpVerifierDataSetId
      })

      return {
        provider,
        dataSetId: sorted[0].pdpVerifierDataSetId,
        isExisting: true
      }
    }

    // Need to create new data set
    return {
      provider,
      dataSetId: -1, // Marker for new data set
      isExisting: false
    }
  }

  /**
   * Resolve using a specific provider address
   */
  private static async resolveByProviderAddress (
    providerAddress: string,
    warmStorageService: WarmStorageService,
    signerAddress: string,
    withCDN: boolean
  ): Promise<{
      provider: ApprovedProviderInfo
      dataSetId: number
      isExisting: boolean
    }> {
    // Get provider ID by address
    const providerId = await warmStorageService.getProviderIdByAddress(providerAddress)
    if (providerId === 0) {
      throw createError(
        'StorageService',
        'resolveByProviderAddress',
        `Provider ${providerAddress} is not currently approved`
      )
    }

    // Use the providerId resolution logic
    return await StorageService.resolveByProviderId(
      signerAddress,
      providerId,
      withCDN,
      warmStorageService
    )
  }

  /**
   * Smart provider selection algorithm
   * Prioritizes existing data sets and provider health
   */
  private static async smartSelectProvider (
    signerAddress: string,
    withCDN: boolean,
    warmStorageService: WarmStorageService,
    signer: ethers.Signer
  ): Promise<{
      provider: ApprovedProviderInfo
      dataSetId: number
      isExisting: boolean
    }> {
    // Strategy:
    // 1. Try to find existing data sets first
    // 2. If no existing data sets, find a healthy provider

    // Get client's data sets
    const dataSets = await warmStorageService.getClientDataSetsWithDetails(signerAddress)

    // Filter for managed data sets with matching CDN setting
    const managedDataSets = dataSets.filter(
      ps => ps.isLive && ps.isManaged && ps.withCDN === withCDN
    )

    if (managedDataSets.length > 0) {
      // Prefer data sets with pieces, sort by ID (older first)
      const sorted = managedDataSets.sort((a, b) => {
        if (a.currentPieceCount > 0 && b.currentPieceCount === 0) return -1
        if (b.currentPieceCount > 0 && a.currentPieceCount === 0) return 1
        return a.pdpVerifierDataSetId - b.pdpVerifierDataSetId
      })

      // Create async generator that yields providers lazily
      async function * generateProviders (): AsyncGenerator<ApprovedProviderInfo> {
        const yieldedProviders = new Set<string>()

        // First, yield providers from existing data sets (in sorted order)
        for (const dataSet of sorted) {
          const providerId = await warmStorageService.getProviderIdByAddress(dataSet.payee)
          if (providerId === 0) {
            console.warn(`Provider ${dataSet.payee} for data set ${dataSet.pdpVerifierDataSetId} is not currently approved`)
            continue
          }
          const provider = await warmStorageService.getApprovedProvider(providerId)
          if (provider.serviceProvider !== '0x0000000000000000000000000000000000000000' &&
              !yieldedProviders.has(provider.serviceProvider.toLowerCase())) {
            yieldedProviders.add(provider.serviceProvider.toLowerCase())
            yield provider
          }
        }
      }

      const selectedProvider = await StorageService.selectProviderWithPing(generateProviders())

      // Find the first matching data set ID for this provider
      const matchingDataSet = sorted.find(ps =>
        ps.payee.toLowerCase() === selectedProvider.serviceProvider.toLowerCase()
      )

      if (matchingDataSet == null) {
        throw createError(
          'StorageService',
          'smartSelectProvider',
          'Selected provider not found in data sets'
        )
      }

      return {
        provider: selectedProvider,
        dataSetId: matchingDataSet.pdpVerifierDataSetId,
        isExisting: true
      }
    }

    // No existing data sets - select from all approved providers
    const allProviders = await warmStorageService.getAllApprovedProviders()
    if (allProviders.length === 0) {
      throw createError(
        'StorageService',
        'smartSelectProvider',
        'No approved service providers available'
      )
    }

    // Random selection from all providers
    const provider = await StorageService.selectRandomProvider(allProviders, signer)

    return {
      provider,
      dataSetId: -1, // Marker for new data set
      isExisting: false
    }
  }

  /**
   * Select a random provider from a list with ping validation
   * @param providers - Array of providers to select from
   * @param signer - Signer for additional entropy
   * @returns Selected provider
   */
  private static async selectRandomProvider (
    providers: ApprovedProviderInfo[],
    signer?: ethers.Signer
  ): Promise<ApprovedProviderInfo> {
    if (providers.length === 0) {
      throw createError(
        'StorageService',
        'selectRandomProvider',
        'No providers available'
      )
    }

    // Create async generator that yields providers in random order
    async function * generateRandomProviders (): AsyncGenerator<ApprovedProviderInfo> {
      const remaining = [...providers]

      while (remaining.length > 0) {
        let randomIndex: number

        // Try crypto.getRandomValues if available (HTTPS contexts)
        if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues != null) {
          const randomBytes = new Uint8Array(1)
          globalThis.crypto.getRandomValues(randomBytes)
          randomIndex = randomBytes[0] % remaining.length
        } else {
          // Fallback for HTTP contexts - use multiple entropy sources
          const timestamp = Date.now()
          const random = Math.random()

          if (signer != null) {
            // Use wallet address as additional entropy
            const addressBytes = await signer.getAddress()
            const addressSum = addressBytes.split('').reduce((a, c) => a + c.charCodeAt(0), 0)

            // Combine sources for better distribution
            const combined = (timestamp * random * addressSum) % remaining.length
            randomIndex = Math.floor(Math.abs(combined))
          } else {
            // No signer available, use simpler fallback
            randomIndex = Math.floor(Math.random() * remaining.length)
          }
        }

        // Remove and yield the selected provider
        const selected = remaining.splice(randomIndex, 1)[0]
        yield selected
      }
    }

    return await StorageService.selectProviderWithPing(generateRandomProviders())
  }

  /**
   * Select a provider from an async iterator with ping validation.
   * This is shared logic used by both smart selection and random selection.
   * @param providers - Async iterable of providers to try
   * @returns The first provider that responds
   * @throws If all providers fail
   */
  private static async selectProviderWithPing (providers: AsyncIterable<ApprovedProviderInfo>): Promise<ApprovedProviderInfo> {
    let providerCount = 0

    // Try providers in order until we find one that responds to ping
    for await (const provider of providers) {
      providerCount++
      try {
        // Create a temporary PDPServer for this specific provider's endpoint
        const providerPdpServer = new PDPServer(null, provider.serviceURL)
        await providerPdpServer.ping()
        return provider
      } catch (error) {
        console.warn(`Provider ${provider.serviceProvider} failed ping test:`, error instanceof Error ? error.message : String(error))
        // Continue to next provider
      }
    }

    // All providers failed ping test
    if (providerCount === 0) {
      throw createError(
        'StorageService',
        'selectProviderWithPing',
        'No providers available to select from'
      )
    }

    throw createError(
      'StorageService',
      'selectProviderWithPing',
      `All ${providerCount} providers failed health check. Storage may be temporarily unavailable.`
    )
  }

  /**
   * Run preflight checks for an upload
   * @param size - The size of data to upload in bytes
   * @returns Preflight information including costs and allowances
   */
  async preflightUpload (size: number): Promise<PreflightInfo> {
    // Validate size before proceeding
    StorageService.validateRawSize(size, 'preflightUpload')

    // Check allowances and get costs in a single call
    const allowanceCheck = await this._warmStorageService.checkAllowanceForStorage(
      size,
      this._withCDN,
      this._synapse.payments
    )

    // Return preflight info
    return {
      estimatedCost: {
        perEpoch: allowanceCheck.costs.perEpoch,
        perDay: allowanceCheck.costs.perDay,
        perMonth: allowanceCheck.costs.perMonth
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.message
      },
      selectedProvider: this._provider,
      selectedDataSetId: this._dataSetId
    }
  }

  /**
   * Upload data to the service provider
   */
  async upload (data: Uint8Array | ArrayBuffer, callbacks?: UploadCallbacks): Promise<UploadResult> {
    performance.mark('synapse:upload-start')

    // Validation Phase: Check data size
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const sizeBytes = dataBytes.length

    // Validate size before proceeding
    StorageService.validateRawSize(sizeBytes, 'upload')

    // Upload Phase: Upload data to service provider
    let uploadResult: { commP: CommP, size: number }
    try {
      performance.mark('synapse:pdpServer.uploadPiece-start')
      uploadResult = await this._pdpServer.uploadPiece(dataBytes)
      performance.mark('synapse:pdpServer.uploadPiece-end')
      performance.measure('synapse:pdpServer.uploadPiece', 'synapse:pdpServer.uploadPiece-start', 'synapse:pdpServer.uploadPiece-end')
    } catch (error) {
      performance.mark('synapse:pdpServer.uploadPiece-end')
      performance.measure('synapse:pdpServer.uploadPiece', 'synapse:pdpServer.uploadPiece-start', 'synapse:pdpServer.uploadPiece-end')
      throw createError(
        'StorageService',
        'uploadPiece',
        'Failed to upload piece to service provider',
        error
      )
    }

    // Poll for piece to be "parked" (ready)
    const maxWaitTime = TIMING_CONSTANTS.PIECE_PARKING_TIMEOUT_MS
    const pollInterval = TIMING_CONSTANTS.PIECE_PARKING_POLL_INTERVAL_MS
    const startTime = Date.now()
    let pieceReady = false

    performance.mark('synapse:findPiece-start')
    while (Date.now() - startTime < maxWaitTime) {
      try {
        await this._pdpServer.findPiece(uploadResult.commP, uploadResult.size)
        pieceReady = true
        break
      } catch {
        // Piece not ready yet, wait and retry if we haven't exceeded timeout
        if (Date.now() - startTime + pollInterval < maxWaitTime) {
          await new Promise(resolve => setTimeout(resolve, pollInterval))
        }
      }
    }
    performance.mark('synapse:findPiece-end')
    performance.measure('synapse:findPiece', 'synapse:findPiece-start', 'synapse:findPiece-end')

    if (!pieceReady) {
      throw createError(
        'StorageService',
        'findPiece',
        'Timeout waiting for piece to be parked on service provider'
      )
    }

    // Notify upload complete
    if (callbacks?.onUploadComplete != null) {
      callbacks.onUploadComplete(uploadResult.commP)
    }

    // Add Piece Phase: Queue the AddPieces operation for sequential processing
    const pieceData: PieceData = {
      cid: uploadResult.commP,
      rawSize: uploadResult.size
    }

    const finalPieceId = await new Promise<number>((resolve, reject) => {
      // Add to pending batch
      this._pendingPieces.push({
        pieceData,
        resolve,
        reject,
        callbacks
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
      commp: uploadResult.commP,
      size: uploadResult.size,
      pieceId: finalPieceId
    }
  }

  /**
     * Process pending pieces by batching them into a single AddPieces operation
     * This method is called from the promise queue to ensure sequential execution
     */
  private async _processPendingPieces (): Promise<void> {
    if (this._isProcessing || this._pendingPieces.length === 0) {
      return
    }
    this._isProcessing = true

    // Extract up to uploadBatchSize pending pieces
    const batch = this._pendingPieces.slice(0, this._uploadBatchSize)
    this._pendingPieces = this._pendingPieces.slice(this._uploadBatchSize)

    try {
      // Get add pieces info to ensure we have the correct nextPieceId
      performance.mark('synapse:getAddPiecesInfo-start')
      const addPiecesInfo = await this._warmStorageService.getAddPiecesInfo(
        this._dataSetId
      )
      performance.mark('synapse:getAddPiecesInfo-end')
      performance.measure('synapse:getAddPiecesInfo', 'synapse:getAddPiecesInfo-start', 'synapse:getAddPiecesInfo-end')

      // Create piece data array from the batch
      const pieceDataArray: PieceData[] = batch.map((item) => item.pieceData)

      // Add pieces to the data set
      performance.mark('synapse:pdpServer.addPieces-start')
      const addPiecesResult = await this._pdpServer.addPieces(
        this._dataSetId, // PDPVerifier data set ID
        addPiecesInfo.clientDataSetId, // Client's dataset ID
        addPiecesInfo.nextPieceId, // Must match chain state
        pieceDataArray
      )
      performance.mark('synapse:pdpServer.addPieces-end')
      performance.measure('synapse:pdpServer.addPieces', 'synapse:pdpServer.addPieces-start', 'synapse:pdpServer.addPieces-end')

      // Handle transaction tracking if available (backward compatible)
      let confirmedPieceIds: number[] = []

      if (addPiecesResult.txHash != null) {
        // New server with transaction tracking - verification is REQUIRED
        let transaction: ethers.TransactionResponse | null = null

        // Step 1: Get the transaction from chain
        const txRetryStartTime = Date.now()
        const txPropagationTimeout = TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS
        const txPropagationPollInterval = TIMING_CONSTANTS.TRANSACTION_PROPAGATION_POLL_INTERVAL_MS

        performance.mark('synapse:getTransaction.addPieces-start')
        while (Date.now() - txRetryStartTime < txPropagationTimeout) {
          try {
            transaction = await this._synapse.getProvider().getTransaction(addPiecesResult.txHash)
            if (transaction !== null) break
          } catch {
            // Transaction not found yet
          }
          await new Promise(resolve => setTimeout(resolve, txPropagationPollInterval))
        }
        performance.mark('synapse:getTransaction.addPieces-end')
        performance.measure('synapse:getTransaction.addPieces', 'synapse:getTransaction.addPieces-start', 'synapse:getTransaction.addPieces-end')

        if (transaction == null) {
          throw createError(
            'StorageService',
            'addPieces',
            `Server returned transaction hash ${addPiecesResult.txHash} but transaction was not found on-chain after ${txPropagationTimeout / 1000} seconds`
          )
        }

        // Notify callbacks with transaction
        batch.forEach((item) => item.callbacks?.onPieceAdded?.(transaction))

        // Step 2: Wait for transaction confirmation
        let receipt: ethers.TransactionReceipt | null
        try {
          performance.mark('synapse:transaction.wait-start')
          receipt = await transaction.wait(TIMING_CONSTANTS.TRANSACTION_CONFIRMATIONS)
          performance.mark('synapse:transaction.wait-end')
          performance.measure('synapse:transaction.wait', 'synapse:transaction.wait-start', 'synapse:transaction.wait-end')
        } catch (error) {
          performance.mark('synapse:transaction.wait-end')
          performance.measure('synapse:transaction.wait', 'synapse:transaction.wait-start', 'synapse:transaction.wait-end')
          throw createError(
            'StorageService',
            'addPieces',
            'Failed to wait for transaction confirmation',
            error
          )
        }

        if (receipt?.status !== 1) {
          throw createError(
            'StorageService',
            'addPieces',
            'Piece addition transaction  failed on-chain'
          )
        }

        // Step 3: Verify with server - REQUIRED for new servers
        const maxWaitTime = TIMING_CONSTANTS.PIECE_ADDITION_TIMEOUT_MS
        const pollInterval = TIMING_CONSTANTS.PIECE_ADDITION_POLL_INTERVAL_MS
        const startTime = Date.now()
        let lastError: Error | null = null
        let statusVerified = false

        performance.mark('synapse:getPieceAdditionStatus-start')
        while (Date.now() - startTime < maxWaitTime) {
          try {
            const status = await this._pdpServer.getPieceAdditionStatus(
              this._dataSetId,
              addPiecesResult.txHash
            )

            // Check if the transaction is still pending
            if (status.txStatus === 'pending' || status.addMessageOk === null) {
              await new Promise(resolve => setTimeout(resolve, pollInterval))
              continue
            }

            // Check if transaction failed
            if (!status.addMessageOk) {
              throw new Error('Piece addition failed: Transaction was unsuccessful')
            }

            // Success - get the piece IDs
            if (status.confirmedPieceIds != null && status.confirmedPieceIds.length > 0) {
              confirmedPieceIds = status.confirmedPieceIds
              batch.forEach((item) =>
                item.callbacks?.onPieceConfirmed?.(status.confirmedPieceIds ?? [])
              )
              statusVerified = true
              break
            }

            // If we get here, status exists but no piece IDs yet
            await new Promise(resolve => setTimeout(resolve, pollInterval))
          } catch (error) {
            lastError = error as Error
            // If it's a 404, the server might not have the record yet
            if (error instanceof Error && error.message.includes('not found')) {
              await new Promise(resolve => setTimeout(resolve, pollInterval))
              continue
            }
            // Other errors are fatal
            throw createError(
              'StorageService',
              'addPieces',
                `Failed to verify piece addition with server: ${error instanceof Error ? error.message : 'Unknown error'}`,
                error
            )
          }
        }
        performance.mark('synapse:getPieceAdditionStatus-end')
        performance.measure('synapse:getPieceAdditionStatus', 'synapse:getPieceAdditionStatus-start', 'synapse:getPieceAdditionStatus-end')

        if (!statusVerified) {
          const errorMessage = `Failed to verify piece addition after ${maxWaitTime / 1000} seconds: ${
            lastError != null ? lastError.message : 'Server did not provide confirmation'
          }`

          throw createError(
            'StorageService',
            'addPieces',
            errorMessage + '. The transaction was confirmed on-chain but the server failed to acknowledge it.',
            lastError
          )
        }
      } else {
        // Old server without transaction tracking
        // Generate sequential piece IDs starting from nextPieceId
        confirmedPieceIds = Array.from(
          { length: batch.length },
          (_, i) => addPiecesInfo.nextPieceId + i
        )
        batch.forEach((item) => item.callbacks?.onPieceAdded?.())
      }

      // Resolve all promises in the batch with their respective piece IDs
      batch.forEach((item, index) => {
        const pieceId =
            confirmedPieceIds[index] ?? addPiecesInfo.nextPieceId + index
        item.resolve(pieceId)
      })
    } catch (error) {
      // Reject all promises in the batch
      const finalError = createError(
        'StorageService',
        'addPieces',
        'Failed to add piece to data set',
        error
      )
      batch.forEach((item) => item.reject(finalError))
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
   * @param commp - The CommP identifier
   * @param options - Download options (currently unused but reserved for future)
   * @returns The downloaded data
   */
  async providerDownload (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    // Pass through to Synapse with our provider hint and withCDN setting
    return await this._synapse.download(commp, {
      providerAddress: this._provider.serviceProvider,
      withCDN: this._withCDN // Pass StorageService's withCDN
    })
  }

  /**
   * Download data from the service provider
   * @deprecated Use providerDownload() for downloads from this specific provider.
   * This method will be removed in a future version.
   */
  async download (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    return await this.providerDownload(commp, options)
  }

  /**
   * Get information about the service provider used by this service
   * @returns Provider information including pricing (currently same for all providers)
   */
  async getProviderInfo (): Promise<ApprovedProviderInfo> {
    return await this._synapse.getProviderInfo(this.serviceProvider)
  }

  /**
   * Get the list of piece CIDs for this service service's data set by querying the PDP server.
   * @returns Array of piece CIDs as CommP objects
   */
  async getDataSetPieces (): Promise<(CommP | CommPv2)[]> {
    const dataSetData = await this._pdpServer.getDataSet(this._dataSetId)
    return dataSetData.pieces.map(piece => piece.pieceCid)
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
   * @param commp - The CommP (piece CID) to check
   * @returns Status information including existence, data set timing, and retrieval URL
   */
  async pieceStatus (commp: string | CommP | CommPv2): Promise<PieceStatus> {
    const parsedCommP = asCommP(commp)
    if (parsedCommP == null) {
      throw createError('StorageService', 'pieceStatus', 'Invalid CommP provided')
    }

    // Run multiple operations in parallel for better performance
    const [pieceCheckResult, dataSetData, currentEpoch] = await Promise.all([
      // Check if piece exists on provider
      this._pdpServer.findPiece(parsedCommP, 0).then(() => true).catch(() => false),
      // Get data set data
      this._pdpServer.getDataSet(this._dataSetId).catch((error) => {
        console.debug('Failed to get data set data:', error)
        return null
      }),
      // Get current epoch
      getCurrentEpoch(this._synapse.getProvider())
    ])

    const exists = pieceCheckResult
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
          ? Promise.all([
            this._warmStorageService.getMaxProvingPeriod(),
            this._warmStorageService.getChallengeWindow()
          ]).then(([maxProvingPeriod, challengeWindow]) => ({ maxProvingPeriod, challengeWindow }))
            .catch(() => null)
          : Promise.resolve(null)
      ])

      // Set retrieval URL if we have provider info
      if (providerInfo != null) {
        // Remove trailing slash from serviceURL to avoid double slashes
        retrievalUrl = `${providerInfo.serviceURL.replace(/\/$/, '')}/piece/${parsedCommP.toString()}`
      }

      // Process proof timing data if we have data set data and proving params
      if (dataSetData != null && provingParams != null) {
        // Check if this CommP is in the data set
        const pieceData = dataSetData.pieces.find(piece => piece.pieceCid.toString() === parsedCommP.toString())

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
      isProofOverdue
    }
  }
}
