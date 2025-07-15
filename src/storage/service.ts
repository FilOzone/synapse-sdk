/**
 * StorageService - High-level interface for storage operations with automatic provider selection
 *
 * This service provides a simplified interface for uploading and downloading data
 * to/from Filecoin storage providers. It handles:
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
import { type StorageServiceOptions, type CommP, type ApprovedProviderInfo, type UploadCallbacks, type UploadResult, type PieceData, type StorageCreationCallbacks, type ProviderSelectionResult, type DownloadOptions } from '../types.js'
import { type Synapse } from '../synapse.js'
import { type WarmStorageService } from '../warm-storage/index.js'
import { PDPAuthHelper, PDPServer } from '../pdp/index.js'
import { calculateCommP } from '../commp/calculate.js'
import { createError, SIZE_CONSTANTS, TIMING_CONSTANTS, TIME_CONSTANTS } from '../utils/index.js'

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
  public readonly storageProvider: string

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
        `Data size ${sizeBytes} bytes is below minimum of ${SIZE_CONSTANTS.MIN_UPLOAD_SIZE} bytes`
      )
    }

    if (sizeBytes > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      throw createError(
        'StorageService',
        context,
        `Data size ${sizeBytes} bytes exceeds maximum of ${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes (${Math.floor(SIZE_CONSTANTS.MAX_UPLOAD_SIZE / 1024 / 1024)} MiB)`
      )
    }
  }

  private constructor (
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
    this.storageProvider = provider.owner

    // Get WarmStorage address from Synapse (which already handles override)
    this._warmStorageAddress = synapse.getWarmStorageAddress()

    // Create PDPAuthHelper for signing operations
    const authHelper = new PDPAuthHelper(
      this._warmStorageAddress,
      this._signer,
      synapse.getChainId()
    )

    // Create PDPServer instance with provider URLs
    this._pdpServer = new PDPServer(
      authHelper,
      provider.pdpUrl,
      provider.pieceRetrievalUrl
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
          isExisting: resolution.isExisting,
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
      synapse.getChainId()
    )

    // Create PDPServer instance for API calls
    const pdpServer = new PDPServer(
      authHelper,
      provider.pdpUrl,
      provider.pieceRetrievalUrl
    )

    // Create the data set through the provider
    performance.mark('synapse:pdpServer.createDataSet-start')
    const createResult = await pdpServer.createDataSet(
      nextDatasetId, // clientDataSetId
      provider.owner, // payee (storage provider)
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
              callbacks.onDataSetCreationProgress({
                txStatus: status.server?.txStatus ?? 'pending',
                isConfirmed: status.chain.isConfirmed,
                dataSetId: status.summary.dataSetId,
                elapsedMs,
                estimatedRemainingMs: status.summary.estimatedRemainingMs,
                progress: {
                  current: status.summary.isComplete ? 100 : Math.min(95, Math.floor((elapsedMs / TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS) * 100)),
                  total: 100
                },
                error: status.summary.error,
                serverStatus: status.server ?? undefined,
                receipt: status.chain.receipt ?? undefined
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
    const withCDN = options.withCDN ?? false

    // Case 1: Specific data set ID provided
    if (options.dataSetId != null) {
      const dataSetData = await warmStorageService.getDataSetWithDetails(options.dataSetId)

      // Validate the data set
      if (!dataSetData.isLive) {
        throw createError(
          'StorageService',
          'resolveProviderAndDataSet',
          `Data set ${options.dataSetId} is not live`
        )
      }

      if (!dataSetData.isManaged) {
        throw createError(
          'StorageService',
          'resolveProviderAndDataSet',
          `Data set ${options.dataSetId} is not managed by client ${signerAddress}`
        )
      }

      if (dataSetData.withCDN !== withCDN) {
        throw createError(
          'StorageService',
          'resolveProviderAndDataSet',
          `Data set ${options.dataSetId} has CDN ${dataSetData.withCDN ? 'enabled' : 'disabled'}, but requested ${withCDN ? 'enabled' : 'disabled'}`
        )
      }

      // Get provider info
      const provider = await warmStorageService.getApprovedProviderByAddress(dataSetData.payee)

      return {
        provider,
        dataSetId: options.dataSetId,
        isExisting: true
      }
    }

    // Case 2: Specific provider address
    if (options.providerAddress != null) {
      const provider = await warmStorageService.getApprovedProviderByAddress(options.providerAddress)

      // Check if provider exists
      if (provider.owner === '0x0000000000000000000000000000000000000000') {
        throw createError(
          'StorageService',
          'resolveProviderAndDataSet',
          `Provider ${options.providerAddress} not found or not approved`
        )
      }

      return await StorageService.resolveByProviderAddress(
        signerAddress,
        provider,
        withCDN,
        warmStorageService
      )
    }

    // Case 3: Specific provider ID
    if (options.providerId != null) {
      return await StorageService.resolveByProviderId(
        signerAddress,
        options.providerId,
        withCDN,
        warmStorageService
      )
    }

    // Case 4: Auto-select provider (most complex case)
    return await StorageService.smartSelectProvider(
      signerAddress,
      withCDN,
      warmStorageService
    )
  }

  /**
   * Resolve using a specific provider address
   */
  private static async resolveByProviderAddress (
    signerAddress: string,
    provider: ApprovedProviderInfo,
    withCDN: boolean,
    warmStorageService: WarmStorageService
  ): Promise<{
      provider: ApprovedProviderInfo
      dataSetId: number
      isExisting: boolean
    }> {
    // Get client's data sets
    const dataSets = await warmStorageService.getClientDataSetsWithDetails(signerAddress)

    // Look for existing data sets with this provider
    const providerDataSets = dataSets.filter(
      ps => ps.payee.toLowerCase() === provider.owner.toLowerCase() &&
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
      dataSetId: -1,
      isExisting: false
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

    if (provider.owner === '0x0000000000000000000000000000000000000000') {
      throw createError(
        'StorageService',
        'resolveByProviderId',
        `Provider ID ${providerId} not found or not approved`
      )
    }

    // Filter for this provider's data sets
    const providerDataSets = dataSets.filter(
      ps => ps.payee.toLowerCase() === provider.owner.toLowerCase() &&
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
      dataSetId: -1,
      isExisting: false
    }
  }

  /**
   * Smart provider selection algorithm
   * Prioritizes existing data sets and provider health
   */
  private static async smartSelectProvider (
    signerAddress: string,
    withCDN: boolean,
    warmStorageService: WarmStorageService
  ): Promise<{
      provider: ApprovedProviderInfo
      dataSetId: number
      isExisting: boolean
    }> {
    // Strategy:
    // 1. Try to find existing data sets first (saves gas)
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
        // First, yield providers from existing data sets (in sorted order)
        for (const dataSet of sorted) {
          const provider = await warmStorageService.getApprovedProviderByAddress(dataSet.payee)
          if (provider.owner !== '0x0000000000000000000000000000000000000000') {
            yield provider
          }
        }

        // Then, yield all approved providers (excluding ones already tried)
        const triedAddresses = new Set(sorted.map(ps => ps.payee.toLowerCase()))
        const allProviders = await warmStorageService.getApprovedProviders()
        for (const provider of allProviders) {
          if (!triedAddresses.has(provider.owner.toLowerCase())) {
            yield provider
          }
        }
      }

      const selectedProvider = await StorageService.selectProviderWithPing(generateProviders())

      // Find the first matching data set ID for this provider
      const matchingDataSet = sorted.find(ps =>
        ps.payee.toLowerCase() === selectedProvider.owner.toLowerCase()
      )

      if (matchingDataSet != null) {
        throw createError(
          'StorageService',
          'smartSelectProvider',
          'Selected provider not found in data sets'
        )
      }

      return {
        provider: selectedProvider,
        dataSetId: matchingDataSet?.pdpVerifierDataSetId ?? -1,
        isExisting: matchingDataSet != null
      }
    }

    // No existing data sets - select from all approved providers
    const allProviders = await warmStorageService.getApprovedProviders()
    if (allProviders.length === 0) {
      throw createError(
        'StorageService',
        'smartSelectProvider',
        'No approved storage providers available'
      )
    }

    // Create async generator for all providers
    async function * generateAllProviders (): AsyncGenerator<ApprovedProviderInfo> {
      for (const provider of allProviders) {
        yield provider
      }
    }

    const selectedProvider = await StorageService.selectProviderWithPing(generateAllProviders())

    return {
      provider: selectedProvider,
      dataSetId: -1,
      isExisting: false
    }
  }

  /**
   * Select the first provider that responds to ping
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
        const providerPdpServer = new PDPServer(null, provider.pdpUrl, provider.pieceRetrievalUrl)
        await providerPdpServer.ping()
        return provider
      } catch (error) {
        console.warn(`Provider ${provider.owner} failed ping test:`, error instanceof Error ? error.message : String(error))
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
   * Get information about the current storage service
   * @returns Storage service configuration including provider and data set details
   */
  getInfo (): {
    provider: ApprovedProviderInfo
    withCDN: boolean
    selectedDataSetId: number
  } {
    return {
      provider: this._provider,
      withCDN: this._withCDN,
      selectedDataSetId: this._dataSetId
    }
  }

  /**
   * Upload data to the storage provider
   */
  async upload (data: Uint8Array | ArrayBuffer, callbacks?: UploadCallbacks): Promise<UploadResult> {
    performance.mark('synapse:upload-start')

    // Validation Phase: Check data size
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const sizeBytes = dataBytes.length

    // Validate size before proceeding
    StorageService.validateRawSize(sizeBytes, 'upload')

    // Upload Phase: Upload data to storage provider
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
        'Failed to upload piece to storage provider',
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
        'Timeout waiting for piece to be parked on storage provider'
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

        if (receipt == null || receipt.status !== 1) {
          throw createError(
            'StorageService',
            'addPieces',
            'Transaction failed on-chain'
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
            if (status.pending === true || status.addMessageOk === null) {
              await new Promise(resolve => setTimeout(resolve, pollInterval))
              continue
            }

            // Check if transaction failed
            if (status.addMessageOk === false) {
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
   * Download data from this specific storage provider
   * @param commp - The CommP identifier
   * @param options - Download options (currently unused but reserved for future)
   * @returns The downloaded data
   */
  async providerDownload (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    // Pass through to Synapse with our provider hint and withCDN setting
    return await this._synapse.download(commp, {
      providerAddress: this._provider.owner,
      withCDN: this._withCDN // Pass StorageService's withCDN
    })
  }

  /**
   * Download data from the storage provider
   * @deprecated Use providerDownload() for downloads from this specific provider.
   * This method will be removed in a future version.
   */
  async download (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    return await this.providerDownload(commp, options)
  }

  /**
   * Pre-validate data before upload
   * @param data - The data to validate
   * @returns Pre-calculated CommP and size that will result from upload
   * @throws Error if data size is invalid
   */
  async preflightUpload (data: Uint8Array | ArrayBuffer): Promise<{ commP: CommP, size: number }> {
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const sizeBytes = dataBytes.length

    // Validate size
    StorageService.validateRawSize(sizeBytes, 'preflightUpload')

    // Calculate CommP
    const commP = await calculateCommP(dataBytes)

    return {
      commP,
      size: sizeBytes
    }
  }

  /**
   * Get information about the storage provider used by this service
   * @returns Provider information including pricing (currently same for all providers)
   */
  async getProviderInfo (): Promise<ApprovedProviderInfo> {
    return await this._synapse.getProviderInfo(this.storageProvider)
  }

  /**
   * Get the list of root CIDs for this storage service's data set by querying the PDP server.
   * @returns Array of root CIDs as CommP objects
   */
  async getDataSetPieces (): Promise<CommP[]> {
    const dataSetData = await this._pdpServer.getDataSet(this._dataSetId)
    return dataSetData.pieces.map(piece => piece.pieceCid)
  }

  /**
   * Get the status of a piece on this storage provider
   * @param commp - The CommP identifier
   * @returns Piece status including timing information if available
   */
  async getPieceStatus (commp: string | CommP): Promise<{
    exists: boolean
    retrievalUrl?: string
    lastProvenEpoch?: number
    nextProofRequired?: number
    proofDeadline?: number
    isActive?: boolean
  }> {
    // Parse CommP
    const parsedCommP = typeof commp === 'string' ? asCommP(commp) : commp

    try {
      // Try to find the piece on the provider
      await this._pdpServer.findPiece(parsedCommP, 0)

      // If we get here, the piece exists on the provider
      // Get additional information if available
      let provingParams = null
      let providerInfo = null
      let dataSetData = null
      let retrievalUrl

      // Fetch additional data in parallel
      const [dataSet, provParams, provider] = await Promise.all([
        this._pdpServer.getDataSet(this._dataSetId)
          .catch(() => null),
        this._warmStorageService.getCurrentProvingParams()
          .catch(() => null),
        this._synapse.getProviderInfo(this.storageProvider)
          .catch(() => null)
      ])

      dataSetData = dataSet
      provingParams = provParams
      providerInfo = provider

      // Set retrieval URL if we have provider info
      if (providerInfo != null) {
        // Remove trailing slash from pieceRetrievalUrl to avoid double slashes
        retrievalUrl = `${providerInfo.pieceRetrievalUrl.replace(/\/$/, '')}/piece/${parsedCommP.toString()}`
      }

      // Process proof timing data if we have data set data and proving params
      if (dataSetData != null && provingParams != null) {
        // Check if this CommP is in the data set
        const pieceData = dataSetData.pieces.find(piece => piece.pieceCid.toString() === parsedCommP.toString())

        if (pieceData != null) {
          // Calculate proof timing based on current parameters
          const currentEpoch = provingParams.currentEpoch
          const epochsPerPeriod = Number(provingParams.epochsPerPeriod)
          const currentPeriod = Math.floor(currentEpoch / epochsPerPeriod)

          // The piece was last proven when added (assume current period for now)
          const lastProvenPeriod = currentPeriod
          const lastProvenEpoch = lastProvenPeriod * epochsPerPeriod

          // Next proof required in next period
          const nextProofPeriod = currentPeriod + 1
          const nextProofRequired = nextProofPeriod * epochsPerPeriod

          // Proof deadline is at the end of the next period
          const proofDeadline = (nextProofPeriod + 1) * epochsPerPeriod - 1

          return {
            exists: true,
            retrievalUrl,
            lastProvenEpoch,
            nextProofRequired,
            proofDeadline,
            isActive: true
          }
        }
      }

      // Piece exists but not in this data set
      return {
        exists: true,
        retrievalUrl
      }
    } catch (error) {
      // Piece not found
      return {
        exists: false
      }
    }
  }

  /**
   * Estimate storage costs for data
   * @param data - The data to estimate costs for
   * @returns Estimated costs per epoch, day, and month
   */
  async estimateCosts (data: Uint8Array | ArrayBuffer): Promise<{
    sizeBytes: number
    costPerEpoch: bigint
    costPerDay: bigint
    costPerMonth: bigint
  }> {
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const sizeBytes = dataBytes.length

    const costs = await this._warmStorageService.calculateStorageCost(sizeBytes, this._withCDN)

    return {
      sizeBytes,
      costPerEpoch: costs.perEpoch,
      costPerDay: costs.perDay,
      costPerMonth: costs.perMonth
    }
  }
}