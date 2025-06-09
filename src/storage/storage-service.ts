/**
 * Real implementation of the StorageService interface
 *
 * This service handles:
 * - Storage provider selection and management
 * - Proof set creation and selection
 * - File uploads with PDP (Proof of Data Possession)
 * - File downloads with verification
 * - Payment settlement
 */

import type { ethers } from 'ethers'
import type {
  StorageServiceOptions,
  ApprovedProviderInfo,
  UploadTask,
  DownloadOptions,
  SettlementResult,
  PreflightInfo,
  UploadCallbacks,
  CommP
} from '../types.js'
import type { Synapse } from '../synapse.js'
import { PDPServer } from '../pdp/server.js'
import { PDPAuthHelper } from '../pdp/auth.js'
import { PandoraService } from '../pandora/service.js'
import { createError } from '../utils/index.js'

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

    // Step 2: Select or create proof set
    const proofSetId = await StorageService.selectOrCreateProofSet(
      synapse,
      provider,
      options.withCDN ?? false
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
    withCDN: boolean
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
      return sorted[0].pdpVerifierProofSetId
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
    const { txHash } = createResult

    // Wait for the proof set creation to be confirmed on-chain
    const creationStatus = await pandoraService.waitForProofSetCreationWithStatus(
      txHash,
      pdpServer
    )

    if (!creationStatus.summary.isComplete || creationStatus.summary.proofSetId == null) {
      throw createError(
        'StorageService',
        'waitForProofSetCreation',
        `Proof set creation failed: ${creationStatus.summary.error ?? 'Transaction may have failed'}`
      )
    }

    console.log(`Created new proof set with ID: ${creationStatus.summary.proofSetId}`)
    return creationStatus.summary.proofSetId
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
  upload (data: Uint8Array | ArrayBuffer, callbacks?: UploadCallbacks): UploadTask {
    // TODO: Implement in Step 6
    throw new Error('Upload not yet implemented')
  }

  /**
   * Download data from the storage provider
   */
  async download (commp: string | CommP, options?: DownloadOptions): Promise<Uint8Array> {
    // TODO: Implement in Step 7
    throw new Error('Download not yet implemented')
  }

  /**
   * Delete data from storage
   */
  async delete (commp: string | CommP): Promise<void> {
    // TODO: Implement in Step 8
    throw new Error('Delete not yet implemented')
  }

  /**
   * Settle payments for the storage
   */
  async settlePayments (): Promise<SettlementResult> {
    // TODO: Implement in Step 8
    throw new Error('Settle payments not yet implemented')
  }
}
