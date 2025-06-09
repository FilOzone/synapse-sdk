/**
 * Real implementation of the StorageService interface
 *
 * This service handles:
 * - Storage provider selection and management
 * - Proof set creation and selection
 * - File uploads with PDP (Proof of Data Possession)
 * - File downloads with verification
 */

import type { ethers } from 'ethers'
import type {
  StorageServiceOptions,
  StorageCreationCallbacks,
  ApprovedProviderInfo,
  DownloadOptions,
  PreflightInfo,
  UploadCallbacks,
  UploadResult,
  RootData,
  CommP
} from '../types.js'
import type { Synapse } from '../synapse.js'
import { PDPServer } from '../pdp/server.js'
import { PDPAuthHelper } from '../pdp/auth.js'
import { PandoraService } from '../pandora/service.js'
import { createError } from '../utils/index.js'
import { SIZE_CONSTANTS } from '../utils/constants.js'

// Polling configuration for piece parking
const PIECE_PARKING_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const PIECE_POLL_INTERVAL_MS = 5000 // 5 seconds

export class StorageService {
  private readonly _synapse: Synapse
  private readonly _provider: ApprovedProviderInfo
  private readonly _pdpServer: PDPServer
  private readonly _pandoraService: PandoraService
  private readonly _pandoraAddress: string
  private readonly _withCDN: boolean
  private readonly _proofSetId: number
  private readonly _signer: ethers.Signer

  // Public properties from interface
  public readonly proofSetId: string
  public readonly storageProvider: string

  constructor (
    synapse: Synapse,
    provider: ApprovedProviderInfo,
    proofSetId: number,
    options: StorageServiceOptions
  ) {
    this._synapse = synapse
    this._provider = provider
    this._proofSetId = proofSetId
    this._withCDN = options.withCDN ?? false
    this._signer = synapse.getSigner()

    // Set public properties
    this.proofSetId = proofSetId.toString()
    this.storageProvider = provider.owner

    // Get Pandora address from Synapse (which already handles override)
    this._pandoraAddress = synapse.getPandoraAddress()

    // Create our own PandoraService instance
    this._pandoraService = new PandoraService(synapse.getProvider(), this._pandoraAddress)

    // Create PDPAuthHelper for signing operations
    const authHelper = new PDPAuthHelper(
      this._pandoraAddress,
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
   * Handles provider selection and proof set selection/creation
   */
  static async create (
    synapse: Synapse,
    options: StorageServiceOptions
  ): Promise<StorageService> {
    // Create a temporary PandoraService just for provider selection
    const pandoraAddress = synapse.getPandoraAddress()
    const pandoraService = new PandoraService(synapse.getProvider(), pandoraAddress)
    const signer = synapse.getSigner()

    // Step 1: Select storage provider
    let provider: ApprovedProviderInfo

    if (options.providerId != null) {
      // Use specific provider
      try {
        provider = await pandoraService.getApprovedProvider(options.providerId)
        // Verify provider is actually approved (not zero address)
        if (provider.owner === '0x0000000000000000000000000000000000000000') {
          throw new Error(`Provider ID ${options.providerId} is not approved`)
        }
      } catch (error) {
        throw createError(
          'StorageService',
          'getApprovedProvider',
          `Provider ID ${options.providerId} not found or not approved`,
          error
        )
      }
    } else {
      // Select random provider
      const providers = await pandoraService.getAllApprovedProviders()
      if (providers.length === 0) {
        throw createError(
          'StorageService',
          'getAllApprovedProviders',
          'No approved storage providers available'
        )
      }

      // Random selection that works in all contexts
      let randomIndex: number

      // Try crypto.getRandomValues if available (HTTPS contexts)
      if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues != null) {
        const randomBytes = new Uint8Array(1)
        globalThis.crypto.getRandomValues(randomBytes)
        randomIndex = randomBytes[0] % providers.length
      } else {
        // Fallback for HTTP contexts - use multiple entropy sources
        const timestamp = Date.now()
        const random = Math.random()
        // Use wallet address as additional entropy
        const addressBytes = await signer.getAddress()
        const addressSum = addressBytes.split('').reduce((a, c) => a + c.charCodeAt(0), 0)

        // Combine sources for better distribution
        const combined = (timestamp * random * addressSum) % providers.length
        randomIndex = Math.floor(Math.abs(combined))
      }

      provider = providers[randomIndex]
    }

    // Notify callback about provider selection
    try {
      options.callbacks?.onProviderSelected?.(provider)
    } catch (error) {
      // Log but don't propagate callback errors
      console.error('Error in onProviderSelected callback:', error)
    }

    // Step 2: Select or create proof set
    const proofSetId = await StorageService.selectOrCreateProofSet(
      synapse,
      provider,
      options.withCDN ?? false,
      options.callbacks
    )

    // Step 3: Create and return service instance
    return new StorageService(synapse, provider, proofSetId, options)
  }

  /**
   * Select an existing proof set or create a new one
   */
  private static async selectOrCreateProofSet (
    synapse: Synapse,
    provider: ApprovedProviderInfo,
    withCDN: boolean,
    callbacks?: StorageCreationCallbacks
  ): Promise<number> {
    const pandoraAddress = synapse.getPandoraAddress()
    const pandoraService = new PandoraService(synapse.getProvider(), pandoraAddress)
    const signer = synapse.getSigner()
    const signerAddress = await signer.getAddress()

    // Step 1: Query existing proof sets for this wallet
    const proofSets = await pandoraService.getClientProofSetsWithDetails(signerAddress)

    // Step 2: Filter proof sets that belong to the selected provider
    // We need to check if the payee matches the provider's owner address
    const providerProofSets = proofSets.filter(ps =>
      ps.payee.toLowerCase() === provider.owner.toLowerCase() &&
      ps.isLive && // Only consider live proof sets
      ps.isManaged && // Only consider proof sets managed by current Pandora
      ps.withCDN === withCDN // Match CDN preference
    )

    // Step 3: Selection logic
    if (providerProofSets.length > 0) {
      // Sort by preference:
      // 1. Proof sets with existing roots (more efficient to reuse)
      // 2. Then by PDPVerifier proof set ID (lower IDs = older)
      const sorted = providerProofSets.sort((a, b) => {
        // First, prefer proof sets with roots
        if (a.currentRootCount > 0 && b.currentRootCount === 0) return -1
        if (b.currentRootCount > 0 && a.currentRootCount === 0) return 1

        // Then sort by ID (ascending = older first)
        return a.pdpVerifierProofSetId - b.pdpVerifierProofSetId
      })

      // Return the best match
      const selectedProofSetId = sorted[0].pdpVerifierProofSetId

      // Notify callback about proof set resolution (fast path)
      try {
        callbacks?.onProofSetResolved?.({
          isExisting: true,
          proofSetId: selectedProofSetId,
          provider
        })
      } catch (error) {
        console.error('Error in onProofSetResolved callback:', error)
      }

      return selectedProofSetId
    }

    // Step 4: No suitable proof set exists, create a new one
    console.log('No suitable proof set found, creating new one...')

    // Get next client dataset ID
    const nextDatasetId = await pandoraService.getNextClientDataSetId(signerAddress)

    // Create PDPAuthHelper for signing
    const authHelper = new PDPAuthHelper(
      pandoraAddress,
      signer,
      synapse.getChainId()
    )

    // Create PDPServer instance for API calls
    const pdpServer = new PDPServer(
      authHelper,
      provider.pdpUrl,
      provider.pieceRetrievalUrl
    )

    // Create the proof set through the provider
    const createResult = await pdpServer.createProofSet(
      nextDatasetId, // clientDataSetId
      provider.owner, // payee (storage provider)
      withCDN,
      pandoraAddress // recordKeeper (Pandora contract)
    )

    // createProofSet returns CreateProofSetResponse with txHash and statusUrl
    const { txHash, statusUrl } = createResult

    // Notify callback about proof set creation started
    try {
      callbacks?.onProofSetCreationStarted?.(txHash, statusUrl)
    } catch (error) {
      console.error('Error in onProofSetCreationStarted callback:', error)
    }

    // Wait for the proof set creation to be confirmed on-chain with progress callbacks
    const startTime = Date.now()
    const timeoutMs = 300000 // 5 minutes
    const pollIntervalMs = 2000 // 2 seconds

    let finalStatus: Awaited<ReturnType<typeof pandoraService.getComprehensiveProofSetStatus>> | undefined

    while (Date.now() - startTime < timeoutMs) {
      const status = await pandoraService.getComprehensiveProofSetStatus(txHash, pdpServer)
      finalStatus = status

      // Fire progress callback
      try {
        callbacks?.onProofSetCreationProgress?.({
          transactionMined: status.chainStatus.transactionMined,
          transactionSuccess: status.chainStatus.transactionSuccess,
          proofSetLive: status.chainStatus.proofSetLive,
          serverConfirmed: status.serverStatus?.ok === true,
          proofSetId: status.summary.proofSetId ?? undefined,
          elapsedMs: Date.now() - startTime
        })
      } catch (error) {
        console.error('Error in onProofSetCreationProgress callback:', error)
      }

      // Check if complete or failed
      if (status.summary.isComplete || status.summary.error != null) {
        break
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    if (finalStatus == null || !finalStatus.summary.isComplete || finalStatus.summary.proofSetId == null) {
      throw createError(
        'StorageService',
        'waitForProofSetCreation',
        `Proof set creation failed: ${finalStatus?.summary.error ?? 'Timeout or transaction may have failed'}`
      )
    }

    const proofSetId = finalStatus.summary.proofSetId
    console.log(`Created new proof set with ID: ${proofSetId}`)

    // Notify callback about proof set resolution (slow path)
    try {
      callbacks?.onProofSetResolved?.({
        isExisting: false,
        proofSetId,
        provider
      })
    } catch (error) {
      console.error('Error in onProofSetResolved callback:', error)
    }

    return proofSetId
  }

  /**
   * Run preflight checks for an upload
   */
  async preflightUpload (size: number): Promise<PreflightInfo> {
    // Check allowances and get costs in a single call
    const allowanceCheck = await this._pandoraService.checkAllowanceForStorage(
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
      selectedProofSetId: this._proofSetId
    }
  }

  /**
   * Upload data to the storage provider
   */
  async upload (data: Uint8Array | ArrayBuffer, callbacks?: UploadCallbacks): Promise<UploadResult> {
    // Validation Phase: Check data size
    const dataBytes = data instanceof ArrayBuffer ? new Uint8Array(data) : data
    const sizeBytes = dataBytes.length

    if (sizeBytes > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      throw createError(
        'StorageService',
        'upload',
        `Data size (${sizeBytes} bytes) exceeds maximum allowed size (${SIZE_CONSTANTS.MAX_UPLOAD_SIZE} bytes)`
      )
    }

    // Upload Phase: Upload data to storage provider
    let uploadResult: { commP: string, size: number }
    try {
      uploadResult = await this._pdpServer.uploadPiece(dataBytes)
    } catch (error) {
      throw createError(
        'StorageService',
        'uploadPiece',
        'Failed to upload piece to storage provider',
        error
      )
    }

    // Poll for piece to be "parked" (ready)
    const maxWaitTime = PIECE_PARKING_TIMEOUT_MS
    const pollInterval = PIECE_POLL_INTERVAL_MS
    const startTime = Date.now()
    let pieceReady = false

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

    // Add Root Phase: Add the piece to the proof set
    try {
      // Get add roots info to ensure we have the correct nextRootId
      const addRootsInfo = await this._pandoraService.getAddRootsInfo(
        this._proofSetId
      )

      // Create root data array
      const rootDataArray: RootData[] = [{
        cid: uploadResult.commP,
        rawSize: uploadResult.size
      }]

      // Add roots to the proof set
      await this._pdpServer.addRoots(
        this._proofSetId, // PDPVerifier proof set ID
        addRootsInfo.clientDataSetId, // Client's dataset ID
        addRootsInfo.nextRootId, // Must match chain state
        rootDataArray
      )

      // Notify root added
      if (callbacks?.onRootAdded != null) {
        callbacks.onRootAdded()
      }

      // Return upload result
      return {
        commp: uploadResult.commP,
        size: uploadResult.size,
        rootId: addRootsInfo.nextRootId // The root ID that was used
      }
    } catch (error) {
      throw createError(
        'StorageService',
        'addRoots',
        'Failed to add root to proof set',
        error
      )
    }
  }

  /**
   * Download data from the storage provider
   */
  async download (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    // TODO: Implement in Step 7
    throw new Error('Download not yet implemented')
  }
}
