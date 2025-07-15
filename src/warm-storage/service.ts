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
 * const warmStorageService = new WarmStorageService(provider, warmStorageAddress)
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
 * Result of verifying a data set creation transaction
 */
export interface DataSetCreationVerification {
  /** Whether the transaction has been mined */
  transactionMined: boolean
  /** Whether the transaction was successful */
  transactionSuccess: boolean
  /** The data set ID that was created (if successful) */
  dataSetId?: number
  /** Whether the data set exists and is live on-chain */
  dataSetLive: boolean
  /** Block number where the transaction was mined (if mined) */
  blockNumber?: number
  /** Gas used by the transaction (if mined) */
  gasUsed?: bigint
  /** Any error message if verification failed */
  error?: string
}

/**
 * Information about a pending storage provider
 */
export interface PendingProviderInfo {
  /** PDP server URL */
  pdpUrl: string
  /** Piece retrieval URL */
  pieceRetrievalUrl: string
  /** Timestamp when registered */
  registeredAt: number
}

/**
 * Combined status information from both PDP server and chain
 */
export interface ComprehensiveDataSetStatus {
  /** Transaction hash */
  txHash: string
  /** Server-side status */
  serverStatus: DataSetCreationStatusResponse | null
  /** Chain verification status */
  chainStatus: DataSetCreationVerification
  /** Combined status summary */
  summary: {
    /** Whether creation is complete and successful, both on chain and on the server */
    isComplete: boolean
    /** Whether data set is live on chain */
    isLive: boolean
    /** Final data set ID if available */
    dataSetId: number | null
    /** Any error messages */
    error: string | null
  }
}

export class WarmStorageService {
  private readonly _provider: ethers.Provider
  private readonly _warmStorageAddress: string
  private _warmStorageContract: ethers.Contract | null = null
  private _pdpVerifier: PDPVerifier | null = null

  constructor (provider: ethers.Provider, warmStorageAddress: string) {
    this._provider = provider
    this._warmStorageAddress = warmStorageAddress
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
      this._pdpVerifier = new PDPVerifier(this._provider)
    }
    return this._pdpVerifier
  }

  // ========== Client Data Set Operations ==========

  /**
   * Get all data sets for a given client address
   * @param clientAddress - The client's wallet address
   * @returns Array of data set information
   */
  async getClientDataSets (clientAddress: string): Promise<DataSetInfo[]> {
    const warmStorageContract = this._getWarmStorageContract()

    try {
      // Call the getClientDataSets function on the contract
      const dataSetsData = await warmStorageContract.getClientDataSets(clientAddress)

      // Map the raw data to our DataSetInfo interface
      const dataSets: DataSetInfo[] = []

      // The contract returns an array of structs, we need to map them
      for (let i = 0; i < dataSetsData.length; i++) {
        const data = dataSetsData[i]

        // Skip entries with empty/default values (can happen with contract bugs or uninitialized data)
        if (data.payer === '0x0000000000000000000000000000000000000000' || Number(data.railId) === 0) {
          continue
        }

        dataSets.push({
          railId: Number(data.railId),
          payer: data.payer,
          payee: data.payee,
          commissionBps: Number(data.commissionBps),
          metadata: data.metadata,
          pieceMetadata: data.pieceMetadata, // This is already an array of strings
          clientDataSetId: Number(data.clientDataSetId),
          withCDN: data.withCDN
        })
      }

      return dataSets
    } catch (error) {
      throw new Error(`Failed to get client data sets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get enhanced data set information including chain details
   * @param clientAddress - The client's wallet address
   * @param onlyManaged - If true, only return data sets managed by this Warm Storage contract (default: false)
   * @returns Array of data set information with additional chain data and clear ID separation
   */
  async getClientDataSetsWithDetails (clientAddress: string, onlyManaged: boolean = false): Promise<EnhancedDataSetInfo[]> {
    const dataSets = await this.getClientDataSets(clientAddress)
    const pdpVerifier = this._getPDPVerifier()
    const warmStorageContract = this._getWarmStorageContract()

    // Process all data sets in parallel
    const enhancedDataSetsPromises = dataSets.map(async (dataSet) => {
      try {
        // Get the actual PDPVerifier data set ID from the rail ID
        const pdpVerifierDataSetId = await warmStorageContract.railToDataSet(dataSet.railId)

        // If railToDataSet returns 0, this rail doesn't exist in this Warm Storage contract
        if (Number(pdpVerifierDataSetId) === 0) {
          return onlyManaged
            ? null // Will be filtered out
            : {
                ...dataSet,
                pdpVerifierDataSetId: 0,
                nextPieceId: 0,
                currentPieceCount: 0,
                isLive: false,
                isManaged: false
              }
        }

        // Parallelize independent calls
        const [isLive, listenerResult] = await Promise.all([
          pdpVerifier.dataSetLive(Number(pdpVerifierDataSetId)),
          pdpVerifier.getDataSetListener(Number(pdpVerifierDataSetId)).catch(() => null)
        ])

        // Check if this data set is managed by our Warm Storage contract
        const isManaged = listenerResult != null && listenerResult.toLowerCase() === this._warmStorageAddress.toLowerCase()

        // Skip unmanaged data sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get next piece ID only if the data set is live
        const nextPieceId = isLive ? await pdpVerifier.getNextPieceId(Number(pdpVerifierDataSetId)) : 0

        return {
          ...dataSet,
          pdpVerifierDataSetId: Number(pdpVerifierDataSetId),
          nextPieceId: Number(nextPieceId),
          currentPieceCount: Number(nextPieceId),
          isLive,
          isManaged
        }
      } catch (error) {
        // Re-throw the error to let the caller handle it
        throw new Error(`Failed to get details for data set with rail ID ${dataSet.railId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedDataSetsPromises)

    // Filter out null values (from skipped data sets when onlyManaged is true)
    return results.filter((result): result is EnhancedDataSetInfo => result !== null)
  }

  /**
   * Get information needed to add pieces to an existing data set
   * @param dataSetId - The data set ID to get information for
   * @returns Information needed for adding pieces (next piece ID, client dataset ID)
   */
  async getAddPiecesInfo (dataSetId: number): Promise<AddPiecesInfo> {
    try {
      const warmStorageContract = this._getWarmStorageContract()
      const pdpVerifier = this._getPDPVerifier()

      // Parallelize all independent calls
      const [isLive, nextPieceId, listener, dataSetInfo] = await Promise.all([
        pdpVerifier.dataSetLive(Number(dataSetId)),
        pdpVerifier.getNextPieceId(Number(dataSetId)),
        pdpVerifier.getDataSetListener(Number(dataSetId)),
        warmStorageContract.getDataSet(Number(dataSetId))
      ])

      // Check if data set exists and is live
      if (!isLive) {
        throw new Error(`Data set ${dataSetId} does not exist or is not live`)
      }

      // Verify this data set is managed by our Warm Storage contract
      if (listener.toLowerCase() !== this._warmStorageAddress.toLowerCase()) {
        throw new Error(`Data set ${dataSetId} is not managed by this Warm Storage contract (${this._warmStorageAddress}), managed by ${String(listener)}`)
      }

      const clientDataSetId = Number(dataSetInfo.clientDataSetId)

      return {
        nextPieceId: Number(nextPieceId),
        clientDataSetId,
        currentPieceCount: Number(nextPieceId)
      }
    } catch (error) {
      throw new Error(`Failed to get add pieces info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get the next available client dataset ID for a client
   * This reads the current counter from the Warm Storage contract
   * @param clientAddress - The client's wallet address
   * @returns The next client dataset ID that will be assigned by this Warm Storage contract
   */
  async getNextClientDataSetId (clientAddress: string): Promise<number> {
    try {
      const warmStorageContract = this._getWarmStorageContract()

      // Get the current clientDataSetIDs counter for this client in this Warm Storage contract
      // This is the value that will be used for the next data set creation
      const currentCounter = await warmStorageContract.clientDataSetIDs(clientAddress)

      // Return the current counter value (it will be incremented during data set creation)
      return Number(currentCounter)
    } catch (error) {
      throw new Error(`Failed to get next client dataset ID: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Verify that a data set creation transaction was successful
   * This checks both the transaction status and on-chain data set state
   * @param txHashOrTransaction - Transaction hash or transaction object from data set creation
   * @returns Verification result with transaction and data set status
   */
  async verifyDataSetCreation (txHashOrTransaction: string | ethers.TransactionResponse): Promise<DataSetCreationVerification> {
    try {
      // Get transaction hash
      const txHash = typeof txHashOrTransaction === 'string' ? txHashOrTransaction : txHashOrTransaction.hash

      // Get transaction receipt
      let receipt: ethers.TransactionReceipt | null
      if (typeof txHashOrTransaction === 'string') {
        receipt = await this._provider.getTransactionReceipt(txHash)
      } else {
        // If we have a transaction object, use its wait method which is more efficient
        receipt = await txHashOrTransaction.wait(TIMING_CONSTANTS.TRANSACTION_CONFIRMATIONS)
      }

      if (receipt == null) {
        // Transaction not yet mined
        return {
          transactionMined: false,
          transactionSuccess: false,
          dataSetLive: false
        }
      }

      // Transaction is mined, check if it was successful
      const transactionSuccess = receipt.status === 1

      if (!transactionSuccess) {
        return {
          transactionMined: true,
          transactionSuccess: false,
          dataSetLive: false,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          error: 'Transaction failed'
        }
      }

      // Extract data set ID from transaction logs
      const pdpVerifier = this._getPDPVerifier()
      const dataSetId = await pdpVerifier.extractDataSetIdFromReceipt(receipt)

      if (dataSetId == null) {
        return {
          transactionMined: true,
          transactionSuccess: true,
          dataSetLive: false,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          error: 'Could not find DataSetCreated event in transaction'
        }
      }

      // Verify the data set exists and is live on-chain
      const isLive = await pdpVerifier.dataSetLive(dataSetId)

      return {
        transactionMined: true,
        transactionSuccess: true,
        dataSetId,
        dataSetLive: isLive,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
      }
    } catch (error) {
      return {
        transactionMined: false,
        transactionSuccess: false,
        dataSetLive: false,
        error: `Verification failed: ${error instanceof Error ? error.message : String(error)}`
      }
    }
  }

  /**
   * Get comprehensive status combining PDP server and chain information
   * @param txHashOrTransaction - Transaction hash or transaction object to check
   * @param pdpServer - PDPServer instance to check server status
   * @returns Combined status information
   */
  async getComprehensiveDataSetStatus (
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer: PDPServer
  ): Promise<ComprehensiveDataSetStatus> {
    // Get transaction hash
    const txHash = typeof txHashOrTransaction === 'string' ? txHashOrTransaction : txHashOrTransaction.hash

    // Get server status
    let serverStatus: DataSetCreationStatusResponse | null = null
    try {
      serverStatus = await pdpServer.getDataSetCreationStatus(txHash)
    } catch (error) {
      // Server might not have the status yet
    }

    // Get chain status (pass through the transaction object if we have it)
    const chainStatus = await this.verifyDataSetCreation(txHashOrTransaction)

    // Combine into summary
    const summary = {
      isComplete: chainStatus.transactionMined && chainStatus.dataSetLive && serverStatus != null && serverStatus.ok === true,
      isLive: chainStatus.dataSetLive,
      dataSetId: chainStatus.dataSetId ?? serverStatus?.dataSetId ?? null,
      error: chainStatus.error ?? null
    }

    return {
      txHash,
      serverStatus,
      chainStatus,
      summary
    }
  }

  /**
   * Wait for a data set to be created and become live
   * @param txHashOrTransaction - Transaction hash or transaction object from createDataSet
   * @param pdpServer - PDPServer instance to check server status
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @param pollIntervalMs - How often to check in milliseconds
   * @param onProgress - Optional callback for progress updates
   * @returns Final status when complete or timeout
   */
  async waitForDataSetCreationWithStatus (
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer: PDPServer,
    timeoutMs: number = TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS,
    pollIntervalMs: number = TIMING_CONSTANTS.DATA_SET_CREATION_POLL_INTERVAL_MS,
    onProgress?: (status: ComprehensiveDataSetStatus, elapsedMs: number) => void | Promise<void>
  ): Promise<ComprehensiveDataSetStatus> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getComprehensiveDataSetStatus(txHashOrTransaction, pdpServer)

      // Fire progress callback if provided
      if (onProgress != null) {
        try {
          await onProgress(status, Date.now() - startTime)
        } catch (error) {
          // Don't let callback errors break the polling loop
          console.error('Error in progress callback:', error)
        }
      }

      if (status.summary.isComplete || status.summary.error != null) {
        return status
      }

      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    throw new Error(`Timeout waiting for data set creation after ${timeoutMs}ms`)
  }

  // ========== Storage Cost Operations ==========

  /**
   * Calculate storage costs for a given size
   * @param sizeInBytes - Size of data to store in bytes
   * @returns Cost estimates per epoch, day, and month
   */
  async calculateStorageCost (
    sizeInBytes: number
  ): Promise<{
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
      withCDN: {
        perEpoch: bigint
        perDay: bigint
        perMonth: bigint
      }
    }> {
    const warmStorageContract = this._getWarmStorageContract()

    // Fetch pricing from chain
    let pricePerTiBPerMonthNoCDN: bigint
    let pricePerTiBPerMonthWithCDN: bigint
    let epochsPerMonth: bigint

    try {
      // Try the newer format first (4 values with CDN pricing)
      const result = await warmStorageContract.getServicePrice()
      pricePerTiBPerMonthNoCDN = BigInt(result.pricePerTiBPerMonthNoCDN)
      pricePerTiBPerMonthWithCDN = BigInt(result.pricePerTiBPerMonthWithCDN)
      epochsPerMonth = BigInt(result.epochsPerMonth)
    } catch (error) {
      console.error('Error calling getServicePrice:', error)
      throw error
    }

    // Calculate price per byte per epoch
    const sizeInBytesBigint = BigInt(sizeInBytes)
    const pricePerEpochNoCDN = (pricePerTiBPerMonthNoCDN * sizeInBytesBigint) / (SIZE_CONSTANTS.TiB * epochsPerMonth)
    const pricePerEpochWithCDN = (pricePerTiBPerMonthWithCDN * sizeInBytesBigint) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

    return {
      perEpoch: pricePerEpochNoCDN,
      perDay: pricePerEpochNoCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
      perMonth: pricePerEpochNoCDN * epochsPerMonth,
      withCDN: {
        perEpoch: pricePerEpochWithCDN,
        perDay: pricePerEpochWithCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
        perMonth: pricePerEpochWithCDN * epochsPerMonth
      }
    }
  }

  /**
   * Check if user has sufficient allowances for a storage operation and calculate costs
   * @param sizeInBytes - Size of data to store
   * @param withCDN - Whether CDN is enabled
   * @param paymentsService - PaymentsService instance to check allowances
   * @param lockupDays - Number of days for lockup period (defaults to 10)
   * @returns Allowance requirement details and storage costs
   */
  async checkAllowanceForStorage (
    sizeInBytes: number,
    withCDN: boolean,
    paymentsService: PaymentsService,
    lockupDays?: number
  ): Promise<{
      rateAllowanceNeeded: bigint
      lockupAllowanceNeeded: bigint
      currentRateAllowance: bigint
      currentLockupAllowance: bigint
      currentRateUsed: bigint
      currentLockupUsed: bigint
      sufficient: boolean
      message?: string
      costs: {
        perEpoch: bigint
        perDay: bigint
        perMonth: bigint
      }
      depositAmountNeeded: bigint
    }> {
    // Get current allowances for this Warm Storage service
    const approval = await paymentsService.serviceApproval(this._warmStorageAddress, TOKENS.USDFC)

    // Calculate storage costs
    const costs = await this.calculateStorageCost(sizeInBytes)
    const selectedCosts = withCDN ? costs.withCDN : costs
    const rateNeeded = selectedCosts.perEpoch

    // Calculate lockup period based on provided days (default: 10)
    const lockupPeriod = BigInt(lockupDays ?? TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS) * TIME_CONSTANTS.EPOCHS_PER_DAY
    const lockupNeeded = rateNeeded * lockupPeriod

    // Calculate required allowances (current usage + new requirement)
    const totalRateNeeded = BigInt(approval.rateUsed) + rateNeeded
    const totalLockupNeeded = BigInt(approval.lockupUsed) + lockupNeeded

    const sufficient = approval.rateAllowance >= totalRateNeeded &&
                      approval.lockupAllowance >= totalLockupNeeded

    let message
    if (!sufficient) {
      const messages = []
      if (approval.rateAllowance < totalRateNeeded) {
        messages.push(`Rate allowance insufficient: current ${String(approval.rateAllowance)}, need ${String(totalRateNeeded)}`)
      }
      if (approval.lockupAllowance < totalLockupNeeded) {
        messages.push(`Lockup allowance insufficient: current ${String(approval.lockupAllowance)}, need ${String(totalLockupNeeded)}`)
      }
      message = messages.join('. ')
    }

    return {
      rateAllowanceNeeded: totalRateNeeded,
      lockupAllowanceNeeded: totalLockupNeeded,
      currentRateAllowance: approval.rateAllowance,
      currentLockupAllowance: approval.lockupAllowance,
      currentRateUsed: approval.rateUsed,
      currentLockupUsed: approval.lockupUsed,
      sufficient,
      message,
      costs: {
        perEpoch: selectedCosts.perEpoch,
        perDay: selectedCosts.perDay,
        perMonth: selectedCosts.perMonth
      },
      depositAmountNeeded: lockupNeeded
    }
  }

  /**
   * Prepare for a storage upload by checking requirements and providing actions
   * @param options - Upload preparation options
   * @param paymentsService - PaymentsService instance for payment operations
   * @returns Cost estimate, allowance check, and required actions
   */
  async prepareStorageUpload (options: {
    dataSize: number
    withCDN?: boolean
  }, paymentsService: PaymentsService): Promise<{
      estimatedCost: {
        perEpoch: bigint
        perDay: bigint
        perMonth: bigint
      }
      allowanceCheck: {
        sufficient: boolean
        message?: string
      }
      actions: Array<{
        type: 'deposit' | 'approve' | 'approveService'
        description: string
        execute: () => Promise<ethers.TransactionResponse>
      }>
    }> {
    const costs = await this.calculateStorageCost(options.dataSize)
    const estimatedCost = (options.withCDN === true) ? costs.withCDN : costs

    const allowanceCheck = await this.checkAllowanceForStorage(
      options.dataSize,
      options.withCDN ?? false,
      paymentsService
    )

    const actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<ethers.TransactionResponse>
    }> = []

    // Check if deposit is needed
    const accountInfo = await paymentsService.accountInfo(TOKENS.USDFC)
    const requiredBalance = estimatedCost.perMonth // Require at least 1 month of funds

    if (accountInfo.availableFunds < requiredBalance) {
      const depositAmount = requiredBalance - accountInfo.availableFunds
      actions.push({
        type: 'deposit',
        description: `Deposit ${depositAmount} USDFC to payments contract`,
        execute: async () => await paymentsService.deposit(depositAmount, TOKENS.USDFC)
      })
    }

    // Check if service approval is needed
    if (!allowanceCheck.sufficient) {
      actions.push({
        type: 'approveService',
        description: `Approve service with rate allowance ${allowanceCheck.rateAllowanceNeeded} and lockup allowance ${allowanceCheck.lockupAllowanceNeeded}`,
        execute: async () => await paymentsService.approveService(
          this._warmStorageAddress,
          allowanceCheck.rateAllowanceNeeded,
          allowanceCheck.lockupAllowanceNeeded,
          TOKENS.USDFC
        )
      })
    }

    return {
      estimatedCost: {
        perEpoch: estimatedCost.perEpoch,
        perDay: estimatedCost.perDay,
        perMonth: estimatedCost.perMonth
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.message
      },
      actions
    }
  }

  // ========== Storage Provider Operations ==========

  /**
   * Register as a storage provider (requires signer)
   * @param signer - Signer for the storage provider account
   * @param pdpUrl - The PDP server URL
   * @param pieceRetrievalUrl - The piece retrieval URL
   * @returns Transaction response
   */
  async registerServiceProvider (
    signer: ethers.Signer,
    pdpUrl: string,
    pieceRetrievalUrl: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract().connect(signer) as ethers.Contract
    return await contract.registerServiceProvider(pdpUrl, pieceRetrievalUrl)
  }

  /**
   * Approve a pending storage provider (owner only)
   * @param signer - Signer for the contract owner account
   * @param providerAddress - Address of the provider to approve
   * @returns Transaction response
   */
  async approveServiceProvider (
    signer: ethers.Signer,
    providerAddress: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract().connect(signer) as ethers.Contract
    return await contract.approveServiceProvider(providerAddress)
  }

  /**
   * Reject a pending storage provider (owner only)
   * @param signer - Signer for the contract owner account
   * @param providerAddress - Address of the provider to reject
   * @returns Transaction response
   */
  async rejectServiceProvider (
    signer: ethers.Signer,
    providerAddress: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract().connect(signer) as ethers.Contract
    return await contract.rejectServiceProvider(providerAddress)
  }

  /**
   * Remove an approved storage provider (owner only)
   * @param signer - Signer for the contract owner account
   * @param providerId - ID of the provider to remove
   * @returns Transaction response
   */
  async removeServiceProvider (
    signer: ethers.Signer,
    providerId: number
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract().connect(signer) as ethers.Contract
    return await contract.removeServiceProvider(providerId)
  }

  /**
   * Add a service provider directly without registration process (owner only)
   * @param signer - Signer for the contract owner account
   * @param providerAddress - Address of the provider to add
   * @param pdpUrl - The PDP server URL
   * @param pieceRetrievalUrl - The piece retrieval URL
   * @returns Transaction response
   */
  async addServiceProvider (
    signer: ethers.Signer,
    providerAddress: string,
    pdpUrl: string,
    pieceRetrievalUrl: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract().connect(signer) as ethers.Contract
    return await contract.addServiceProvider(providerAddress, pdpUrl, pieceRetrievalUrl)
  }

  /**
   * Check if a provider is approved
   * @param providerAddress - Address of the provider to check
   * @returns Whether the provider is approved
   */
  async isProviderApproved (providerAddress: string): Promise<boolean> {
    const contract = this._getWarmStorageContract()
    return await contract.isProviderApproved(providerAddress)
  }

  /**
   * Get provider ID by address
   * @param providerAddress - Address of the provider
   * @returns Provider ID (0 if not approved)
   */
  async getProviderIdByAddress (providerAddress: string): Promise<number> {
    const contract = this._getWarmStorageContract()
    const id = await contract.getProviderIdByAddress(providerAddress)
    return Number(id)
  }

  /**
   * Get information about an approved provider
   * @param providerId - ID of the provider
   * @returns Provider information
   */
  async getApprovedProvider (providerId: number): Promise<ApprovedProviderInfo> {
    const contract = this._getWarmStorageContract()
    const info = await contract.getApprovedProvider(providerId)
    return {
      owner: info.owner,
      pdpUrl: info.pdpUrl,
      pieceRetrievalUrl: info.pieceRetrievalUrl,
      registeredAt: Number(info.registeredAt),
      approvedAt: Number(info.approvedAt)
    }
  }

  /**
   * Get information about a pending provider
   * @param providerAddress - Address of the pending provider
   * @returns Pending provider information
   */
  async getPendingProvider (providerAddress: string): Promise<PendingProviderInfo> {
    const contract = this._getWarmStorageContract()
    const info = await contract.pendingProviders(providerAddress)
    return {
      pdpUrl: info.pdpUrl,
      pieceRetrievalUrl: info.pieceRetrievalUrl,
      registeredAt: Number(info.registeredAt)
    }
  }

  /**
   * Get the next provider ID that will be assigned
   * @returns Next provider ID
   */
  async getNextProviderId (): Promise<number> {
    const contract = this._getWarmStorageContract()
    const id = await contract.nextServiceProviderId()
    return Number(id)
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner (): Promise<string> {
    const contract = this._getWarmStorageContract()
    return await contract.owner()
  }

  /**
   * Check if a signer is the contract owner
   * @param signer - Signer to check
   * @returns Whether the signer is the owner
   */
  async isOwner (signer: ethers.Signer): Promise<boolean> {
    const signerAddress = await signer.getAddress()
    const ownerAddress = await this.getOwner()
    return signerAddress.toLowerCase() === ownerAddress.toLowerCase()
  }

  /**
   * Get all approved providers
   * @returns Array of all approved providers
   */
  async getAllApprovedProviders (): Promise<ApprovedProviderInfo[]> {
    const contract = this._getWarmStorageContract()
    const providers = await contract.getAllApprovedProviders()

    return providers.map((p: any) => ({
      owner: p.owner,
      pdpUrl: p.pdpUrl,
      pieceRetrievalUrl: p.pieceRetrievalUrl,
      registeredAt: Number(p.registeredAt),
      approvedAt: Number(p.approvedAt)
    }))
  }

  /**
   * Get the service pricing information from the contract
   * @returns Service pricing details
   */
  async getServicePrice (): Promise<{
    pricePerTiBPerMonthNoCDN: bigint
    pricePerTiBPerMonthWithCDN: bigint
    tokenAddress: string
    epochsPerMonth: bigint
  }> {
    const contract = this._getWarmStorageContract()
    const result = await contract.getServicePrice()
    return {
      pricePerTiBPerMonthNoCDN: result.pricePerTiBPerMonthNoCDN,
      pricePerTiBPerMonthWithCDN: result.pricePerTiBPerMonthWithCDN,
      tokenAddress: result.tokenAddress,
      epochsPerMonth: result.epochsPerMonth
    }
  }

  // ========== Proving Period Operations ==========

  /**
   * Get the maximum proving period in epochs
   * This is the maximum time allowed between proofs before a fault is recorded
   * @returns Maximum proving period in epochs
   */
  async getMaxProvingPeriod (): Promise<number> {
    const contract = this._getWarmStorageContract()
    const maxProvingPeriod = await contract.getMaxProvingPeriod()
    return Number(maxProvingPeriod)
  }

  /**
   * Get the challenge window size in epochs
   * This is the window at the end of each proving period where proofs can be submitted
   * @returns Challenge window size in epochs
   */
  async getChallengeWindow (): Promise<number> {
    const contract = this._getWarmStorageContract()
    const challengeWindow = await contract.challengeWindow()
    return Number(challengeWindow)
  }

  /**
   * Get the maximum proving period in hours
   * Convenience method that converts epochs to hours
   * @returns Maximum proving period in hours
   */
  async getProvingPeriodInHours (): Promise<number> {
    const maxProvingPeriod = await this.getMaxProvingPeriod()
    // Convert epochs to hours: epochs * 30 seconds / 3600 seconds per hour
    return (maxProvingPeriod * 30) / 3600
  }

  /**
   * Get the challenge window in minutes
   * Convenience method that converts epochs to minutes
   * @returns Challenge window in minutes
   */
  async getChallengeWindowInMinutes (): Promise<number> {
    const challengeWindow = await this.getChallengeWindow()
    // Convert epochs to minutes: epochs * 30 seconds / 60 seconds per minute
    return (challengeWindow * 30) / 60
  }

  /**
   * Get comprehensive proving period information
   * @returns Object with all proving period timing information
   */
  async getProvingPeriodInfo (): Promise<{
    maxProvingPeriodEpochs: number
    challengeWindowEpochs: number
    maxProvingPeriodHours: number
    challengeWindowMinutes: number
    epochDurationSeconds: number
  }> {
    const [maxProvingPeriod, challengeWindow] = await Promise.all([
      this.getMaxProvingPeriod(),
      this.getChallengeWindow()
    ])

    return {
      maxProvingPeriodEpochs: maxProvingPeriod,
      challengeWindowEpochs: challengeWindow,
      maxProvingPeriodHours: (maxProvingPeriod * 30) / 3600,
      challengeWindowMinutes: (challengeWindow * 30) / 60,
      epochDurationSeconds: 30
    }
  }
}
