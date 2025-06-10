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
import type { PandoraService, StorageResolutionData } from '../pandora/service.js'
import { PDPServer } from '../pdp/server.js'
import { PDPAuthHelper } from '../pdp/auth.js'
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
    pandoraService: PandoraService,
    provider: ApprovedProviderInfo,
    proofSetId: number,
    options: StorageServiceOptions
  ) {
    this._synapse = synapse
    this._provider = provider
    this._proofSetId = proofSetId
    this._withCDN = options.withCDN ?? false
    this._signer = synapse.getSigner()
    this._pandoraService = pandoraService

    // Set public properties
    this.proofSetId = proofSetId.toString()
    this.storageProvider = provider.owner

    // Get Pandora address from Synapse (which already handles override)
    this._pandoraAddress = synapse.getPandoraAddress()

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
    pandoraService: PandoraService,
    options: StorageServiceOptions
  ): Promise<StorageService> {
    const signer = synapse.getSigner()
    const signerAddress = await signer.getAddress()

    // Use the new resolution logic
    const resolution = await StorageService.resolveProviderAndProofSet(
      synapse,
      pandoraService,
      signerAddress,
      options
    )

    // Notify callback about provider selection
    try {
      options.callbacks?.onProviderSelected?.(resolution.provider)
    } catch (error) {
      // Log but don't propagate callback errors
      console.error('Error in onProviderSelected callback:', error)
    }

    // If we need to create a new proof set
    let finalProofSetId: number
    if (resolution.proofSetId === -1) {
      // Need to create new proof set
      finalProofSetId = await StorageService.selectOrCreateProofSet(
        synapse,
        pandoraService,
        resolution.provider,
        options.withCDN ?? false,
        options.callbacks
      )
    } else {
      // Use existing proof set
      finalProofSetId = resolution.proofSetId

      // Notify callback about proof set resolution (fast path)
      try {
        options.callbacks?.onProofSetResolved?.({
          isExisting: true,
          proofSetId: finalProofSetId,
          provider: resolution.provider
        })
      } catch (error) {
        console.error('Error in onProofSetResolved callback:', error)
      }
    }

    // Create and return service instance
    return new StorageService(synapse, pandoraService, resolution.provider, finalProofSetId, options)
  }

  /**
   * Create a new proof set for the given provider
   * Note: This is now only called when we need to create a new proof set,
   * selection logic has been moved to resolveProviderAndProofSet
   */
  private static async selectOrCreateProofSet (
    synapse: Synapse,
    pandoraService: PandoraService,
    provider: ApprovedProviderInfo,
    withCDN: boolean,
    callbacks?: StorageCreationCallbacks
  ): Promise<number> {
    const signer = synapse.getSigner()
    const signerAddress = await signer.getAddress()

    // Create a new proof set

    // Get next client dataset ID
    const nextDatasetId = await pandoraService.getNextClientDataSetId(signerAddress)

    // Get pandora address from synapse
    const pandoraAddress = synapse.getPandoraAddress()

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
   * Resolve provider and proof set based on provided options
   * Handles all selection logic including parameter validation and smart selection
   */
  private static async resolveProviderAndProofSet (
    synapse: Synapse,
    pandoraService: PandoraService,
    signerAddress: string,
    options: StorageServiceOptions
  ): Promise<{
      provider: ApprovedProviderInfo
      proofSetId: number
      isExisting: boolean
    }> {
    // Get all data needed for resolution in a single call
    const data = await pandoraService.getStorageResolutionData(
      signerAddress,
      options.withCDN
    )

    // Step 1: Validate parameter consistency if multiple provided
    if ((options.proofSetId != null && (options.providerId != null || options.providerAddress != null)) ||
        (options.providerId != null && options.providerAddress != null)) {
      // Multiple parameters provided, need to validate consistency
      StorageService.validateSelectionConsistency(options, data, signerAddress)
    }

    // Step 2: Handle explicit proof set ID selection (highest priority)
    if (options.proofSetId != null) {
      return StorageService.selectByProofSetId(options.proofSetId, data, signerAddress)
    }

    // Step 3: Handle explicit provider ID selection
    if (options.providerId != null) {
      const provider = data.providersById.get(options.providerId)
      if (provider == null) {
        throw createError(
          'StorageService',
          'resolveProviderAndProofSet',
          `Provider ID ${options.providerId} not found or not approved`
        )
      }
      return StorageService.selectByProvider(provider, options.providerId, data)
    }

    // Step 4: Handle explicit provider address selection
    if (options.providerAddress != null) {
      const provider = data.providersByAddress.get(options.providerAddress.toLowerCase())
      if (provider == null) {
        throw createError(
          'StorageService',
          'resolveProviderAndProofSet',
          `Address ${options.providerAddress} is not an approved storage provider. ` +
          'Use pandoraService.getAllApprovedProviders() to see available providers.'
        )
      }
      // Find provider ID for this address
      let providerId: number | undefined
      for (const [id, p] of data.providersById) {
        if (p.owner.toLowerCase() === provider.owner.toLowerCase()) {
          providerId = id
          break
        }
      }
      if (providerId == null) {
        throw createError(
          'StorageService',
          'resolveProviderAndProofSet',
          'Internal error: Could not find provider ID for address'
        )
      }
      return StorageService.selectByProvider(provider, providerId, data)
    }

    // Step 5: Smart selection when no specific parameters provided
    return await StorageService.smartSelectProvider(data, synapse.getSigner())
  }

  /**
   * Validate consistency of provided selection parameters
   */
  private static validateSelectionConsistency (
    options: StorageServiceOptions,
    data: StorageResolutionData,
    signerAddress: string
  ): void {
    // Check proofSetId + providerId consistency
    if (options.proofSetId != null && options.providerId != null) {
      const proofSet = data.proofSets.find(ps => ps.pdpVerifierProofSetId === options.proofSetId)
      if (proofSet == null) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Proof set ${options.proofSetId} not found or not owned by ${signerAddress}`
        )
      }
      const provider = data.providersById.get(options.providerId)
      if (provider == null) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Provider ID ${options.providerId} not found`
        )
      }
      if (proofSet.payee.toLowerCase() !== provider.owner.toLowerCase()) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Proof set ${options.proofSetId} belongs to provider ${proofSet.payee}, ` +
          `but providerId ${options.providerId} has address ${provider.owner}. ` +
          'Please use consistent parameters or omit one.'
        )
      }
    }

    // Check proofSetId + providerAddress consistency
    if (options.proofSetId != null && options.providerAddress != null) {
      const proofSet = data.proofSets.find(ps => ps.pdpVerifierProofSetId === options.proofSetId)
      if (proofSet == null) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Proof set ${options.proofSetId} not found or not owned by ${signerAddress}`
        )
      }
      if (proofSet.payee.toLowerCase() !== options.providerAddress.toLowerCase()) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Proof set ${options.proofSetId} belongs to provider ${proofSet.payee}, ` +
          `but providerAddress ${options.providerAddress} was specified. ` +
          'Please use consistent parameters or omit one.'
        )
      }
    }

    // Check providerId + providerAddress consistency
    if (options.providerId != null && options.providerAddress != null) {
      const provider = data.providersById.get(options.providerId)
      if (provider == null) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Provider ID ${options.providerId} not found`
        )
      }
      if (provider.owner.toLowerCase() !== options.providerAddress.toLowerCase()) {
        throw createError(
          'StorageService',
          'validateSelectionConsistency',
          `Provider ID ${options.providerId} has address ${provider.owner}, ` +
          `but address ${options.providerAddress} was specified. ` +
          'These refer to different providers.'
        )
      }
    }
  }

  /**
   * Select by explicit proof set ID
   */
  private static selectByProofSetId (
    proofSetId: number,
    data: StorageResolutionData,
    signerAddress: string
  ): {
      provider: ApprovedProviderInfo
      proofSetId: number
      isExisting: boolean
    } {
    // Find the proof set
    const proofSet = data.proofSets.find(ps => ps.pdpVerifierProofSetId === proofSetId)
    if (proofSet == null) {
      throw createError(
        'StorageService',
        'selectByProofSetId',
        `Proof set ${proofSetId} not found, not owned by ${signerAddress}, ` +
        'or not managed by the current Pandora contract'
      )
    }

    // Find the provider for this proof set
    const provider = data.providersByAddress.get(proofSet.payee.toLowerCase())
    if (provider == null) {
      throw createError(
        'StorageService',
        'selectByProofSetId',
        `Provider ${proofSet.payee} for proof set ${proofSetId} is not currently approved`
      )
    }

    return {
      provider,
      proofSetId,
      isExisting: true
    }
  }

  /**
   * Select by explicit provider (ID or address already resolved)
   */
  private static selectByProvider (
    provider: ApprovedProviderInfo,
    providerId: number,
    data: StorageResolutionData
  ): {
      provider: ApprovedProviderInfo
      proofSetId: number
      isExisting: boolean
    } {
    // Check if this provider has existing proof sets
    const providerProofSets = data.proofSetsByProvider.get(provider.owner.toLowerCase()) ?? []

    if (providerProofSets.length > 0) {
      // Sort by preference: proof sets with roots first, then by ID
      const sorted = providerProofSets.sort((a, b) => {
        if (a.currentRootCount > 0 && b.currentRootCount === 0) return -1
        if (b.currentRootCount > 0 && a.currentRootCount === 0) return 1
        return a.pdpVerifierProofSetId - b.pdpVerifierProofSetId
      })

      return {
        provider,
        proofSetId: sorted[0].pdpVerifierProofSetId,
        isExisting: true
      }
    }

    // No existing proof sets, will create new
    // Return a special marker that indicates new proof set needed
    return {
      provider,
      proofSetId: -1, // Marker for new proof set
      isExisting: false
    }
  }

  /**
   * Smart selection when no explicit parameters provided
   */
  private static async smartSelectProvider (
    data: StorageResolutionData,
    signer: ethers.Signer
  ): Promise<{
      provider: ApprovedProviderInfo
      proofSetId: number
      isExisting: boolean
    }> {
    // Step 1: Check if there are any proof sets with roots
    const proofSetsWithRoots = data.proofSets.filter(ps => ps.currentRootCount > 0)

    if (proofSetsWithRoots.length > 0) {
      // Prefer proof sets with roots, sort by ID (older first)
      const sorted = proofSetsWithRoots.sort((a, b) => a.pdpVerifierProofSetId - b.pdpVerifierProofSetId)
      const selected = sorted[0]

      // Find the provider
      const provider = data.providersByAddress.get(selected.payee.toLowerCase())
      if (provider == null) {
        throw createError(
          'StorageService',
          'smartSelectProvider',
          `Provider ${selected.payee} for proof set ${selected.pdpVerifierProofSetId} is not currently approved`
        )
      }

      return {
        provider,
        proofSetId: selected.pdpVerifierProofSetId,
        isExisting: true
      }
    }

    // Step 2: Check if there are any proof sets without roots
    if (data.proofSets.length > 0) {
      // Get unique providers that have proof sets
      const providersWithProofSets = Array.from(data.proofSetsByProvider.keys())
        .map(addr => data.providersByAddress.get(addr))
        .filter((p): p is ApprovedProviderInfo => p != null)

      if (providersWithProofSets.length > 0) {
        // Random selection from providers with proof sets
        const provider = await StorageService.selectRandomProvider(providersWithProofSets, signer)

        // Get the proof sets for this provider and select the first (oldest)
        const providerProofSets = data.proofSetsByProvider.get(provider.owner.toLowerCase()) ?? []
        const sorted = providerProofSets.sort((a, b) => a.pdpVerifierProofSetId - b.pdpVerifierProofSetId)

        return {
          provider,
          proofSetId: sorted[0].pdpVerifierProofSetId,
          isExisting: true
        }
      }
    }

    // Step 3: No existing proof sets, select from all providers
    const allProviders = Array.from(data.providersById.values())
    if (allProviders.length === 0) {
      throw createError(
        'StorageService',
        'smartSelectProvider',
        'No approved storage providers available'
      )
    }

    const provider = await StorageService.selectRandomProvider(allProviders, signer)
    return {
      provider,
      proofSetId: -1, // Marker for new proof set
      isExisting: false
    }
  }

  /**
   * Select a random provider from the given list
   */
  private static async selectRandomProvider (
    providers: ApprovedProviderInfo[],
    signer: ethers.Signer
  ): Promise<ApprovedProviderInfo> {
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

    return providers[randomIndex]
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

    if (sizeBytes < SIZE_CONSTANTS.MIN_UPLOAD_SIZE) {
      // This restriction is imposed by CommP calculation, which requires at least 65 bytes
      throw createError(
        'StorageService',
        'upload',
        `Data size (${sizeBytes} bytes) is below minimum allowed size (${SIZE_CONSTANTS.MIN_UPLOAD_SIZE} bytes).`
      )
    }

    if (sizeBytes > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
      // This restriction is ~arbitrary for now, but there is a hard limit on PDP uploads in Curio
      // of 254 MiB, see: https://github.com/filecoin-project/curio/blob/3ddc785218f4e237f0c073bac9af0b77d0f7125c/pdp/handlers_upload.go#L38
      // We can increase this in future, arbitrarily, but we first need to:
      //  - Handle streaming input.
      //  - Chunking input at size 254 MiB and make a separate piece per each chunk
      //  - Combine the pieces using "subpieces" and an aggregate CommP in our AddRoots call
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
    try {
      // The StorageService instance is already configured with a specific provider
      // and proof set that either uses CDN or doesn't. PDPServer always verifies the CommP.

      const data = await this._pdpServer.downloadPiece(commp)
      return data
    } catch (error) {
      throw createError(
        'StorageService',
        'download',
        'Failed to download piece from storage provider',
        error
      )
    }
  }
}
