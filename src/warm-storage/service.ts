/**
 * WarmStorageService - Consolidated interface for all Warm Storage contract operations
 *
 * This combines functionality for:
 * - Data set management and queries
 * - Storage provider registration and management
 * - Client dataset ID tracking
 * - Data set creation verification
 *
 * @example
 * ```typescript
 * import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const warmStorageService = new WarmStorageService(provider, warmStorageAddress, pdpVerifierAddress)
 *
 * // Get data sets for a client
 * const dataSets = await warmStorageService.getClientDataSets(clientAddress)
 * console.log(`Client has ${dataSets.length} data sets`)
 *
 * // Register as a storage provider
 * const signer = await provider.getSigner()
 * await warmStorageService.registerServiceProvider(signer, pdpUrl, retrievalUrl)
 * ```
 */

import { ethers } from 'ethers'
import type { DataSetInfo, EnhancedDataSetInfo, ApprovedProviderInfo } from '../types.js'
import { CONTRACT_ABIS, TOKENS } from '../utils/index.js'
import { PDPVerifier } from '../pdp/verifier.js'
import type { PDPServer, DataSetCreationStatusResponse } from '../pdp/server.js'
import { PaymentsService } from '../payments/service.js'
import { SIZE_CONSTANTS, TIME_CONSTANTS, TIMING_CONSTANTS } from '../utils/constants.js'

/**
 * Helper information for adding pieces to a data set
 */
export interface AddPiecesInfo {
  /** The next piece ID to use when adding pieces */
  nextPieceId: number
  /** The client dataset ID for this data set */
  clientDataSetId: number
  /** Current number of pieces in the data set */
  currentPieceCount: number
}

/**
 * Service price information per epoch
 */
export interface ServicePriceInfo {
  /** Price per epoch without CDN (in base units) */
  noCDN: bigint
  /** Price per epoch with CDN (in base units) */
  withCDN: bigint
}

/**
 * Storage cost calculation result
 */
export interface StorageCostResult {
  /** Size in bytes */
  sizeBytes: number
  /** Cost per epoch in base units */
  perEpoch: bigint
  /** Cost per day in base units (120 epochs) */
  perDay: bigint
  /** Cost per month in base units (3600 epochs) */
  perMonth: bigint
  /** Whether CDN is included */
  withCDN: boolean
}

/**
 * Current proving parameters
 */
export interface ProvingParams {
  /** Current epoch number */
  currentEpoch: number
  /** Number of epochs in each proving period */
  epochsPerPeriod: bigint
  /** Current proving period number */
  currentPeriod: number
  /** Start epoch of current period */
  periodStart: number
  /** End epoch of current period */
  periodEnd: number
  /** Proving deadline epoch */
  deadline: number
}

/**
 * Comprehensive data set status combining server and chain information
 */
export interface ComprehensiveDataSetStatus {
  server: DataSetCreationStatusResponse | null
  chain: Awaited<ReturnType<WarmStorageService['verifyDataSetCreation']>>
  summary: {
    isComplete: boolean
    dataSetId: number | null
    error: string | null
    estimatedRemainingMs: number | null
  }
}

export class WarmStorageService {
  private readonly _provider: ethers.Provider
  private readonly _warmStorageAddress: string
  private readonly _pdpVerifierAddress: string
  private _warmStorageContract: ethers.Contract | null = null
  private _pdpVerifier: PDPVerifier | null = null

  constructor (provider: ethers.Provider, warmStorageAddress: string, pdpVerifierAddress: string) {
    this._provider = provider
    this._warmStorageAddress = warmStorageAddress
    this._pdpVerifierAddress = pdpVerifierAddress
  }

  /**
   * Get cached Warm Storage contract instance or create new one
   */
  private _getWarmStorageContract (): ethers.Contract {
    if (this._warmStorageContract == null) {
      this._warmStorageContract = new ethers.Contract(
        this._warmStorageAddress,
        CONTRACT_ABIS.WARM_STORAGE,
        this._provider
      )
    }
    return this._warmStorageContract
  }

  /**
   * Get cached PDPVerifier instance or create new one
   */
  private _getPDPVerifier (): PDPVerifier {
    if (this._pdpVerifier == null) {
      this._pdpVerifier = new PDPVerifier(this._provider, this._pdpVerifierAddress)
    }
    return this._pdpVerifier
  }

  // ========== Client Data Set Operations ==========

  /**
   * Get all data sets for a specific client
   * @param client - The client address
   * @returns Array of data set information
   */
  async getClientDataSets (client: string): Promise<DataSetInfo[]> {
    const contract = this._getWarmStorageContract()
    const dataSetData = await contract.getDataSetsForClient(client)

    // Convert from on-chain format to our interface
    return dataSetData.map((ds: any) => ({
      railId: Number(ds.railId),
      payee: ds.payee,
      pieceMetadata: ds.pieceMetadata.map((r: any) => ({
        pieceId: Number(r.id),
        pieceCid: r.cid,
        rawSize: Number(r.rawSize),
        removedBlockHeight: r.removedBlockHeight !== 0n ? Number(r.removedBlockHeight) : null,
        isRemoved: r.removedBlockHeight !== 0n
      })),
      withCDN: ds.withCDN
    }))
  }

  /**
   * Get all data sets for a client with enhanced details
   * This includes live status and management information
   * @param client - The client address
   * @param onlyManaged - If true, only return data sets managed by this Warm Storage contract
   * @returns Array of enhanced data set information
   */
  async getClientDataSetsWithDetails (client: string, onlyManaged: boolean = true): Promise<EnhancedDataSetInfo[]> {
    const contract = this._getWarmStorageContract()
    const pdpVerifier = this._getPDPVerifier()

    const dataSetsRaw = await contract.getDataSetsForClient(client)

    const enhancedDataSets: EnhancedDataSetInfo[] = []

    for (const ds of dataSetsRaw) {
      // Get the pdpVerifierDataSetId from railId (they're the same)
      const pdpVerifierDataSetId = Number(ds.railId)

      // Check if the data set is live in parallel with getting the listener
      const [isLiveResult, listenerResult] = await Promise.all([
        pdpVerifier.dataSetLive(pdpVerifierDataSetId).catch(() => false),
        pdpVerifier.getDataSetListener(pdpVerifierDataSetId).catch(() => null)
      ])

      // Check if this data set is managed by our Warm Storage contract
      const isManaged = listenerResult != null && listenerResult.toLowerCase() === this._warmStorageAddress.toLowerCase()

      // Skip unmanaged data sets if onlyManaged is true
      if (onlyManaged && !isManaged) {
        continue
      }

      // Convert piece metadata
      const pieceMetadata = ds.pieceMetadata.map((r: any) => ({
        pieceId: Number(r.id),
        pieceCid: r.cid,
        rawSize: Number(r.rawSize),
        removedBlockHeight: r.removedBlockHeight !== 0n ? Number(r.removedBlockHeight) : null,
        isRemoved: r.removedBlockHeight !== 0n
      }))

      // Count active pieces
      const currentPieceCount = pieceMetadata.filter((r: any) => !r.isRemoved).length

      enhancedDataSets.push({
        railId: Number(ds.railId),
        payee: ds.payee,
        pieceMetadata,
        withCDN: ds.withCDN,
        pdpVerifierDataSetId,
        isLive: isLiveResult,
        isManaged,
        currentPieceCount
      })
    }

    return enhancedDataSets
  }

  /**
   * Get the next client dataset ID for a given client
   * @param client - The client address
   * @returns The next available dataset ID
   */
  async getNextClientDataSetId (client: string): Promise<number> {
    const contract = this._getWarmStorageContract()
    const nextId = await contract.getNextClientDataSetId(client)
    return Number(nextId)
  }

  /**
   * Get data set details with enhanced information
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Enhanced data set information including management status
   */
  async getDataSetWithDetails (dataSetId: number): Promise<EnhancedDataSetInfo & { client: string }> {
    const pdpVerifier = this._getPDPVerifier()

    // Get owner and listener in parallel
    const [{ owner }, listener] = await Promise.all([
      pdpVerifier.getDataSetOwner(dataSetId),
      pdpVerifier.getDataSetListener(dataSetId)
    ])

    // Verify this data set is managed by our Warm Storage contract
    if (listener.toLowerCase() !== this._warmStorageAddress.toLowerCase()) {
      throw new Error(`Data set ${dataSetId} is not managed by this WarmStorage contract (${this._warmStorageAddress}), managed by ${String(listener)}`)
    }

    // Get the data sets for this client
    const clientDataSets = await this.getClientDataSetsWithDetails(owner)

    // Find the matching data set
    const dataSet = clientDataSets.find(ds => ds.pdpVerifierDataSetId === dataSetId)

    if (dataSet == null) {
      throw new Error(`Data set ${dataSetId} not found for client ${owner}`)
    }

    return {
      ...dataSet,
      client: owner
    }
  }

  /**
   * Get information for adding pieces to a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Helper information for adding pieces
   */
  async getAddPiecesInfo (dataSetId: number): Promise<AddPiecesInfo> {
    const pdpVerifier = this._getPDPVerifier()

    // Get the data set owner
    const { owner } = await pdpVerifier.getDataSetOwner(dataSetId)

    // Get all data sets for this client
    const clientDataSets = await this.getClientDataSets(owner)

    // Find the matching data set by railId (which equals pdpVerifierDataSetId)
    const dataSet = clientDataSets.find(ds => ds.railId === dataSetId)

    if (dataSet == null) {
      throw new Error(`Data set ${dataSetId} not found for client ${owner}`)
    }

    // The next piece ID is the highest existing piece ID + 1
    let nextPieceId = 0
    if (dataSet.pieceMetadata.length > 0) {
      const maxPieceId = Math.max(...dataSet.pieceMetadata.map(r => r.pieceId))
      nextPieceId = maxPieceId + 1
    }

    // Count non-removed pieces
    const currentPieceCount = dataSet.pieceMetadata.filter(r => !r.isRemoved).length

    // For Warm Storage, the clientDataSetId is the index of this data set in the client's list
    const clientDataSetId = clientDataSets.findIndex(ds => ds.railId === dataSetId)

    if (clientDataSetId === -1) {
      throw new Error(`Failed to find client dataset ID for data set ${dataSetId}`)
    }

    return {
      nextPieceId,
      clientDataSetId,
      currentPieceCount
    }
  }

  /**
   * Verify data set creation on-chain
   * @param txHashOrTransaction - Transaction hash or transaction object
   * @returns Verification result with data set ID if found
   */
  async verifyDataSetCreation (txHashOrTransaction: string | ethers.TransactionResponse): Promise<{
    txHash: string
    isConfirmed: boolean
    isSuccessful: boolean | null
    dataSetId: number | null
    receipt: ethers.TransactionReceipt | null
    error: string | null
  }> {
    const pdpVerifier = this._getPDPVerifier()

    let transaction: ethers.TransactionResponse
    let txHash: string

    if (typeof txHashOrTransaction === 'string') {
      txHash = txHashOrTransaction
      const tx = await this._provider.getTransaction(txHash)
      if (tx == null) {
        return {
          txHash,
          isConfirmed: false,
          isSuccessful: null,
          dataSetId: null,
          receipt: null,
          error: 'Transaction not found'
        }
      }
      transaction = tx
    } else {
      transaction = txHashOrTransaction
      txHash = transaction.hash
    }

    // Wait for confirmation
    try {
      const receipt = await transaction.wait()
      if (receipt == null) {
        return {
          txHash,
          isConfirmed: false,
          isSuccessful: null,
          dataSetId: null,
          receipt: null,
          error: 'Receipt not available'
        }
      }

      const isSuccessful = receipt.status === 1

      if (!isSuccessful) {
        return {
          txHash,
          isConfirmed: true,
          isSuccessful: false,
          dataSetId: null,
          receipt,
          error: 'Transaction failed'
        }
      }

      // Extract data set ID from receipt
      const dataSetId = pdpVerifier.extractDataSetIdFromReceipt(receipt)

      return {
        txHash,
        isConfirmed: true,
        isSuccessful: true,
        dataSetId,
        receipt,
        error: null
      }
    } catch (error) {
      return {
        txHash,
        isConfirmed: false,
        isSuccessful: null,
        dataSetId: null,
        receipt: null,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    }
  }

  /**
   * Get comprehensive data set creation status combining server and chain info
   * @param txHashOrTransaction - Transaction hash or transaction object
   * @param pdpServer - PDP server instance for status checks
   * @returns Combined status information
   */
  async getComprehensiveDataSetStatus (
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer?: PDPServer
  ): Promise<ComprehensiveDataSetStatus> {
    const txHash = typeof txHashOrTransaction === 'string' ? txHashOrTransaction : txHashOrTransaction.hash

    // Get server status if pdpServer provided
    let serverStatus: DataSetCreationStatusResponse | null = null
    try {
      performance.mark('synapse:pdpServer.getDataSetCreationStatus-start')
      serverStatus = await pdpServer.getDataSetCreationStatus(txHash)
      performance.mark('synapse:pdpServer.getDataSetCreationStatus-end')
      performance.measure('synapse:pdpServer.getDataSetCreationStatus', 'synapse:pdpServer.getDataSetCreationStatus-start', 'synapse:pdpServer.getDataSetCreationStatus-end')
    } catch (error) {
      performance.mark('synapse:pdpServer.getDataSetCreationStatus-end')
      performance.measure('synapse:pdpServer.getDataSetCreationStatus', 'synapse:pdpServer.getDataSetCreationStatus-start', 'synapse:pdpServer.getDataSetCreationStatus-end')
      // Server doesn't have status yet or error occurred
    }

    // Get chain status (pass through the transaction object if we have it)
    performance.mark('synapse:verifyDataSetCreation-start')
    const chainStatus = await this.verifyDataSetCreation(txHashOrTransaction)
    performance.mark('synapse:verifyDataSetCreation-end')
    performance.measure('synapse:verifyDataSetCreation', 'synapse:verifyDataSetCreation-start', 'synapse:verifyDataSetCreation-end')

    // Combine into summary
    const isComplete = chainStatus.isConfirmed && chainStatus.isSuccessful === true && chainStatus.dataSetId != null
    const dataSetId = serverStatus?.dataSetId ?? chainStatus.dataSetId
    const error = serverStatus?.error ?? chainStatus.error

    // Calculate estimated remaining time
    let estimatedRemainingMs: number | null = null
    if (!isComplete) {
      // Simple estimation based on average confirmation time
      estimatedRemainingMs = TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS / 2
    }

    return {
      server: serverStatus,
      chain: chainStatus,
      summary: {
        isComplete,
        dataSetId,
        error,
        estimatedRemainingMs
      }
    }
  }

  /**
   * Wait for data set creation with status updates
   * @param transaction - Transaction to wait for
   * @param pdpServer - PDP server for status checks
   * @param maxWaitTime - Maximum time to wait in milliseconds
   * @param pollInterval - Polling interval in milliseconds
   * @param onProgress - Optional progress callback
   * @returns Final comprehensive status
   */
  async waitForDataSetCreationWithStatus (
    transaction: ethers.TransactionResponse,
    pdpServer: PDPServer,
    maxWaitTime: number = TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS,
    pollInterval: number = TIMING_CONSTANTS.DATA_SET_CREATION_POLL_INTERVAL_MS,
    onProgress?: (status: ComprehensiveDataSetStatus, elapsedMs: number) => Promise<void>
  ): Promise<ComprehensiveDataSetStatus> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getComprehensiveDataSetStatus(transaction, pdpServer)
      const elapsedMs = Date.now() - startTime

      // Fire progress callback if provided
      if (onProgress != null) {
        await onProgress(status, elapsedMs)
      }

      // Check if complete
      if (status.summary.isComplete) {
        return status
      }

      // Check for errors
      if (status.summary.error != null && status.chain.isConfirmed) {
        // Transaction confirmed but failed
        throw new Error(status.summary.error)
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollInterval))
    }

    // Timeout
    throw new Error(`Data set creation timed out after ${maxWaitTime / 1000} seconds`)
  }

  // ========== Storage Cost Operations ==========

  /**
   * Get the current service price per epoch
   * @returns Service price information for both CDN and non-CDN options
   */
  async getServicePrice (): Promise<ServicePriceInfo> {
    const contract = this._getWarmStorageContract()
    const [noCDN, withCDN] = await contract.getServicePrice()
    return {
      noCDN,
      withCDN
    }
  }

  /**
   * Calculate storage cost for a given size
   * @param sizeBytes - Size in bytes
   * @param withCDN - Whether to include CDN costs
   * @returns Storage cost breakdown
   */
  async calculateStorageCost (sizeBytes: number, withCDN: boolean = false): Promise<StorageCostResult> {
    const servicePriceInfo = await this.getServicePrice()
    const pricePerEpoch = withCDN ? servicePriceInfo.withCDN : servicePriceInfo.noCDN

    // Calculate cost per size per epoch
    const bytesPerUSDCPerEpoch = SIZE_CONSTANTS.BYTES_PER_USDFC_PER_EPOCH
    const costPerEpoch = (BigInt(sizeBytes) * pricePerEpoch) / BigInt(bytesPerUSDCPerEpoch)

    // Calculate daily and monthly costs
    const costPerDay = costPerEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
    const costPerMonth = costPerEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_MONTH)

    return {
      sizeBytes,
      perEpoch: costPerEpoch,
      perDay: costPerDay,
      perMonth: costPerMonth,
      withCDN
    }
  }

  /**
   * Check if payment allowances are sufficient for storage
   * @param sizeBytes - Storage size in bytes
   * @param withCDN - Whether CDN is enabled
   * @param paymentsService - Payments service instance
   * @returns Allowance check result
   */
  async checkAllowanceForStorage (
    sizeBytes: number,
    withCDN: boolean,
    paymentsService: PaymentsService
  ): Promise<{
    costs: StorageCostResult
    currentAllowances: {
      rateAllowance: bigint
      lockupAllowance: bigint
    }
    sufficient: boolean
    rateAllowanceNeeded: bigint
    lockupAllowanceNeeded: bigint
  }> {
    // Get current allowances for this Warm Storage service
    const approval = await paymentsService.serviceApproval(this._warmStorageAddress, TOKENS.USDFC)

    // Calculate storage costs
    const costs = await this.calculateStorageCost(sizeBytes, withCDN)

    // Check if allowances are sufficient
    const sufficient = approval.rateAllowance >= costs.perEpoch && approval.lockupAllowance >= costs.perMonth

    // Calculate how much more is needed
    const rateAllowanceNeeded = costs.perEpoch > approval.rateAllowance
      ? costs.perEpoch - approval.rateAllowance
      : 0n

    const lockupAllowanceNeeded = costs.perMonth > approval.lockupAllowance
      ? costs.perMonth - approval.lockupAllowance
      : 0n

    return {
      costs,
      currentAllowances: {
        rateAllowance: approval.rateAllowance,
        lockupAllowance: approval.lockupAllowance
      },
      sufficient,
      rateAllowanceNeeded,
      lockupAllowanceNeeded
    }
  }

  /**
   * Prepare for storage upload by checking balances and allowances
   * Returns approval steps if needed
   */
  async prepareStorageUpload (options: {
    sizeBytes: number
    withCDN: boolean
    paymentsService: PaymentsService
  }): Promise<{
    ready: boolean
    costs: StorageCostResult
    allowanceCheck: Awaited<ReturnType<typeof this.checkAllowanceForStorage>>
    requiredSteps: Array<{
      step: string
      description: string
      execute: () => Promise<ethers.TransactionResponse>
    }>
  }> {
    const { sizeBytes, withCDN, paymentsService } = options

    // Calculate costs
    const costs = await this.calculateStorageCost(sizeBytes, withCDN)

    // Check allowances
    const allowanceCheck = await this.checkAllowanceForStorage(sizeBytes, withCDN, paymentsService)

    // Build required steps
    const requiredSteps: Array<{
      step: string
      description: string
      execute: () => Promise<ethers.TransactionResponse>
    }> = []

    // Check if we need to approve service
    if (!allowanceCheck.sufficient) {
      requiredSteps.push({
        step: 'approveService',
        description: `Approve service with rate allowance ${allowanceCheck.rateAllowanceNeeded} and lockup allowance ${allowanceCheck.lockupAllowanceNeeded}`,
        execute: async () => await paymentsService.approveService(
          this._warmStorageAddress,
          allowanceCheck.rateAllowanceNeeded,
          allowanceCheck.lockupAllowanceNeeded,
          TOKENS.USDFC
        )
      })
    }

    // Check available funds
    const availableFunds = await paymentsService.availableFunds(TOKENS.USDFC)
    if (availableFunds < costs.perMonth) {
      const depositNeeded = costs.perMonth - availableFunds
      requiredSteps.push({
        step: 'deposit',
        description: `Deposit ${depositNeeded} USDFC to payments contract`,
        execute: async () => await paymentsService.deposit(depositNeeded, TOKENS.USDFC)
      })
    }

    return {
      ready: requiredSteps.length === 0,
      costs,
      allowanceCheck,
      requiredSteps
    }
  }

  // ========== Storage Provider Operations ==========

  /**
   * Get all approved storage providers
   * @returns Array of approved provider information
   */
  async getApprovedProviders (): Promise<ApprovedProviderInfo[]> {
    const contract = this._getWarmStorageContract()
    const count = await contract.getApprovedServiceProviderCount()

    const providers: ApprovedProviderInfo[] = []
    for (let i = 0; i < Number(count); i++) {
      const provider = await contract.getApprovedServiceProvider(i)
      providers.push({
        id: i,
        owner: provider.owner,
        pdpUrl: provider.pdpUrl,
        pieceRetrievalUrl: provider.pieceRetrievalUrl
      })
    }

    return providers
  }

  /**
   * Get a specific approved storage provider by ID
   * @param providerId - The provider ID
   * @returns Provider information
   */
  async getApprovedProvider (providerId: number): Promise<ApprovedProviderInfo> {
    const contract = this._getWarmStorageContract()
    const provider = await contract.getApprovedServiceProvider(providerId)
    return {
      id: providerId,
      owner: provider.owner,
      pdpUrl: provider.pdpUrl,
      pieceRetrievalUrl: provider.pieceRetrievalUrl
    }
  }

  /**
   * Get approved provider information by address or ID
   * @param providerAddressOrId - Provider address or ID
   * @returns Provider information
   */
  async getApprovedProviderByAddress (providerAddressOrId: string | number): Promise<ApprovedProviderInfo> {
    if (typeof providerAddressOrId === 'number') {
      return await this.getApprovedProvider(providerAddressOrId)
    }

    // Search through all providers to find by address
    const providers = await this.getApprovedProviders()
    const provider = providers.find(p => p.owner.toLowerCase() === providerAddressOrId.toLowerCase())

    if (provider == null) {
      // Return null provider info
      return {
        id: -1,
        owner: '0x0000000000000000000000000000000000000000',
        pdpUrl: '',
        pieceRetrievalUrl: ''
      }
    }

    return provider
  }

  /**
   * Register as a storage provider (requires owner permissions)
   * @param signer - Signer with owner permissions
   * @param pdpUrl - PDP service URL
   * @param pieceRetrievalUrl - Piece retrieval URL
   * @returns Transaction response
   */
  async registerServiceProvider (
    signer: ethers.Signer,
    pdpUrl: string,
    pieceRetrievalUrl: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.registerServiceProvider(pdpUrl, pieceRetrievalUrl)
  }

  /**
   * Approve a registered storage provider (requires owner permissions)
   * @param signer - Signer with owner permissions
   * @param providerAddress - Address of provider to approve
   * @returns Transaction response
   */
  async approveServiceProvider (
    signer: ethers.Signer,
    providerAddress: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.approveServiceProvider(providerAddress)
  }

  /**
   * Suspend an approved storage provider (requires owner permissions)
   * @param signer - Signer with owner permissions
   * @param providerId - ID of provider to suspend
   * @returns Transaction response
   */
  async suspendServiceProvider (
    signer: ethers.Signer,
    providerId: number
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.suspendServiceProvider(providerId)
  }

  /**
   * Unsuspend a suspended storage provider (requires owner permissions)
   * @param signer - Signer with owner permissions
   * @param providerId - ID of provider to unsuspend
   * @returns Transaction response
   */
  async unsuspendServiceProvider (
    signer: ethers.Signer,
    providerId: number
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.unsuspendServiceProvider(providerId)
  }

  // ========== Proving Period Operations ==========

  /**
   * Get current proving parameters
   * @returns Current proving period information
   */
  async getCurrentProvingParams (): Promise<ProvingParams> {
    const pdpVerifier = this._getPDPVerifier()
    const contract = pdpVerifier['_contract']

    // Get epochs per period and current epoch
    const [epochsPerPeriod, currentEpoch] = await Promise.all([
      contract.epochsPerPeriod(),
      contract.currentEpoch()
    ])

    const currentEpochNumber = Number(currentEpoch)
    const epochsPerPeriodNumber = Number(epochsPerPeriod)

    // Calculate current period
    const currentPeriod = Math.floor(currentEpochNumber / epochsPerPeriodNumber)

    // Calculate period boundaries
    const periodStart = currentPeriod * epochsPerPeriodNumber
    const periodEnd = (currentPeriod + 1) * epochsPerPeriodNumber - 1

    // Deadline is at the end of the period
    const deadline = periodEnd

    return {
      currentEpoch: currentEpochNumber,
      epochsPerPeriod,
      currentPeriod,
      periodStart,
      periodEnd,
      deadline
    }
  }
}