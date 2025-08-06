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
 * Service price information
 */
export interface ServicePriceInfo {
  /** Price per TiB per month without CDN (in base units) */
  pricePerTiBPerMonthNoCDN: bigint
  /** Price per TiB per month with CDN (in base units) */
  pricePerTiBPerMonthWithCDN: bigint
  /** Token address for payments */
  tokenAddress: string
  /** Number of epochs per month */
  epochsPerMonth: bigint
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
 * Result of verifying data set creation on-chain
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
  /** Error message if something went wrong */
  error?: string
}

/**
 * Comprehensive data set status combining server and chain information
 */
export interface ComprehensiveDataSetStatus {
  server: DataSetCreationStatusResponse | null
  chain: DataSetCreationVerification
  summary: {
    isComplete: boolean
    dataSetId: number | null
    error: string | null
    estimatedRemainingMs: number | null
  }
}

/**
 * Information about a pending provider registration
 */
export interface PendingProviderInfo {
  /** Service URL for the provider */
  serviceURL: string
  /** Peer ID (UTF-8 encoded bytes) */
  peerId: string
  /** Block height when registered */
  registeredAt: number
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
    try {
      const contract = this._getWarmStorageContract()
      const dataSetData = await contract.getClientDataSets(client)

      // Convert from on-chain format to our interface
      return dataSetData.map((ds: any) => ({
        railId: Number(ds.pdpRailId), // Using pdpRailId from contract
        payer: ds.payer,
        payee: ds.payee,
        commissionBps: Number(ds.commissionBps),
        metadata: ds.metadata,
        pieceMetadata: ds.pieceMetadata, // This is already an array of strings
        clientDataSetId: Number(ds.clientDataSetId),
        withCDN: ds.withCDN
      }))
    } catch (error) {
      throw new Error(`Failed to get client data sets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get all data sets for a client with enhanced details
   * This includes live status and management information
   * @param client - The client address
   * @param onlyManaged - If true, only return data sets managed by this Warm Storage contract
   * @returns Array of enhanced data set information
   */
  async getClientDataSetsWithDetails (client: string, onlyManaged: boolean = false): Promise<EnhancedDataSetInfo[]> {
    const dataSets = await this.getClientDataSets(client)
    const pdpVerifier = this._getPDPVerifier()
    const contract = this._getWarmStorageContract()

    // Process all data sets in parallel
    const enhancedDataSetsPromises = dataSets.map(async (dataSet) => {
      try {
        // Get the actual PDPVerifier data set ID from the rail ID
        const pdpVerifierDataSetId = Number(await contract.railToDataSet(dataSet.railId))

        // If railToDataSet returns 0, this rail doesn't exist in this Warm Storage contract
        if (pdpVerifierDataSetId === 0) {
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
          pdpVerifier.dataSetLive(pdpVerifierDataSetId),
          pdpVerifier.getDataSetListener(pdpVerifierDataSetId).catch(() => null)
        ])

        // Check if this data set is managed by our Warm Storage contract
        const isManaged = listenerResult != null && listenerResult.toLowerCase() === this._warmStorageAddress.toLowerCase()

        // Skip unmanaged data sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get next piece ID only if the data set is live
        const nextPieceId = isLive ? await pdpVerifier.getNextPieceId(pdpVerifierDataSetId) : 0

        return {
          ...dataSet,
          pdpVerifierDataSetId,
          nextPieceId: Number(nextPieceId),
          currentPieceCount: Number(nextPieceId),
          isLive,
          isManaged
        }
      } catch (error) {
        // Re-throw the error to let the caller handle it
        throw new Error(`Failed to get details for data set with enhanced info ${dataSet.railId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedDataSetsPromises)

    // Filter out null values (from skipped data sets when onlyManaged is true)
    return results.filter((result): result is EnhancedDataSetInfo => result !== null)
  }

  /**
   * Get information for adding pieces to a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Helper information for adding pieces
   */
  async getAddPiecesInfo (dataSetId: number): Promise<AddPiecesInfo> {
    try {
      const contract = this._getWarmStorageContract()
      const pdpVerifier = this._getPDPVerifier()

      // Parallelize all independent calls
      const [isLive, nextPieceId, listener, dataSetInfo] = await Promise.all([
        pdpVerifier.dataSetLive(Number(dataSetId)),
        pdpVerifier.getNextPieceId(Number(dataSetId)),
        pdpVerifier.getDataSetListener(Number(dataSetId)),
        contract.getDataSet(Number(dataSetId))
      ])

      // Check if data set exists and is live
      if (!isLive) {
        throw new Error(`Data set ${dataSetId} does not exist or is not live`)
      }

      // Verify this data set is managed by our Warm Storage contract
      if (listener.toLowerCase() !== this._warmStorageAddress.toLowerCase()) {
        throw new Error(`Data set ${dataSetId} is not managed by this WarmStorage contract (${this._warmStorageAddress}), managed by ${String(listener)}`)
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
   * Get the next client dataset ID for a given client
   * This reads the current counter from the WarmStorage contract
   * @param clientAddress - The client's wallet address
   * @returns  next client dataset ID that will be assigned by this WarmStorage contract
   */
  async getNextClientDataSetId (clientAddress: string): Promise<number> {
    try {
      const contract = this._getWarmStorageContract()

      // Get the current clientDataSetIDs counter for this client in this WarmStorage contract
      // This is the value that will be used for the next proof set creation
      const currentCounter = await contract.clientDataSetIDs(clientAddress)

      // Return the current counter value (it will be incremented during proof set creation)
      return Number(currentCounter)
    } catch (error) {
      throw new Error(`Failed to get next client dataset ID: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Verify data set creation on-chain
   * @param txHashOrTransaction - Transaction hash or transaction object
   * @returns Verification result with data set ID if found
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
      // Error during verification (e.g., network issues)
      return {
        transactionMined: false,
        transactionSuccess: false,
        dataSetLive: false,
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
    if (pdpServer != null) {
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
    }

    // Get chain status (pass through the transaction object if we have it)
    performance.mark('synapse:verifyDataSetCreation-start')
    const chainStatus = await this.verifyDataSetCreation(txHashOrTransaction)
    performance.mark('synapse:verifyDataSetCreation-end')
    performance.measure('synapse:verifyDataSetCreation', 'synapse:verifyDataSetCreation-start', 'synapse:verifyDataSetCreation-end')

    // Combine into summary
    const isComplete = chainStatus.transactionMined && chainStatus.transactionSuccess && chainStatus.dataSetId != null && chainStatus.dataSetLive
    const dataSetId = serverStatus?.dataSetId ?? chainStatus.dataSetId ?? null

    // Determine error from server status or chain status
    let error: string | null = chainStatus.error ?? null
    if (serverStatus != null && serverStatus.ok === false) {
      error = `Server reported transaction failed (status: ${serverStatus.txStatus})`
    }

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
      if (status.summary.error != null && status.chain.transactionMined) {
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
   * Get the current service price per TiB per month
   * @returns Service price information for both CDN and non-CDN options
   */
  async getServicePrice (): Promise<ServicePriceInfo> {
    const contract = this._getWarmStorageContract()
    const pricing = await contract.getServicePrice()
    return {
      pricePerTiBPerMonthNoCDN: pricing.pricePerTiBPerMonthNoCDN,
      pricePerTiBPerMonthWithCDN: pricing.pricePerTiBPerMonthWithCDN,
      tokenAddress: pricing.tokenAddress,
      epochsPerMonth: pricing.epochsPerMonth
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
    const pricePerTiBPerMonth = withCDN ? servicePriceInfo.pricePerTiBPerMonthWithCDN : servicePriceInfo.pricePerTiBPerMonthNoCDN

    // Calculate monthly cost based on size
    const costPerMonth = (BigInt(sizeBytes) * pricePerTiBPerMonth) / BigInt(SIZE_CONSTANTS.TIB_IN_BYTES)

    // Calculate epoch and daily costs from monthly
    const costPerEpoch = costPerMonth / BigInt(TIME_CONSTANTS.EPOCHS_PER_MONTH)
    const costPerDay = costPerEpoch * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)

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
   * @param lockupDays - Number of days for lockup period (defaults to 10)
   * @returns Allowance check result
   */
  async checkAllowanceForStorage (
    sizeBytes: number,
    withCDN: boolean,
    paymentsService: PaymentsService,
    lockupDays?: number
  ): Promise<{
      costs: StorageCostResult
      currentAllowances: {
        rateAllowance: bigint
        lockupAllowance: bigint
      }
      sufficient: boolean
      rateAllowanceNeeded: bigint
      lockupAllowanceNeeded: bigint
      depositAmountNeeded: bigint
    }> {
    // Get current allowances for this Warm Storage service
    const approval = await paymentsService.serviceApproval(this._warmStorageAddress, TOKENS.USDFC)

    // Calculate storage costs
    const costs = await this.calculateStorageCost(sizeBytes, withCDN)

    // Calculate lockup period based on provided days (default: 10)
    const lockupPeriod = BigInt(lockupDays ?? Number(TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS)) * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
    const lockupNeeded = costs.perEpoch * lockupPeriod

    // Calculate required allowances (current usage + new requirement)
    const totalRateNeeded = BigInt(approval.rateUsed) + costs.perEpoch
    const totalLockupNeeded = BigInt(approval.lockupUsed) + lockupNeeded

    // Check if allowances are sufficient
    const sufficient = approval.rateAllowance >= totalRateNeeded && approval.lockupAllowance >= totalLockupNeeded

    // Calculate how much more is needed
    const rateAllowanceNeeded = totalRateNeeded > approval.rateAllowance
      ? totalRateNeeded - approval.rateAllowance
      : 0n

    const lockupAllowanceNeeded = totalLockupNeeded > approval.lockupAllowance
      ? totalLockupNeeded - approval.lockupAllowance
      : 0n

    return {
      costs,
      currentAllowances: {
        rateAllowance: approval.rateAllowance,
        lockupAllowance: approval.lockupAllowance
      },
      sufficient,
      rateAllowanceNeeded,
      lockupAllowanceNeeded,
      depositAmountNeeded: lockupNeeded
    }
  }

  /**
   * Prepare for storage upload by checking balances and allowances
   *
   * This method performs a comprehensive check of the prerequisites for storage upload,
   * including verifying sufficient funds and service allowances. It returns a list of
   * actions that need to be executed before the upload can proceed.
   *
   * @param options - Configuration options for the storage upload
   * @param options.dataSize - Size of data to store in bytes
   * @param options.withCDN - Whether to enable CDN for faster retrieval (optional, defaults to false)
   * @param paymentsService - Instance of PaymentsService for handling payment operations
   *
   * @returns Object containing:
   *   - estimatedCost: Breakdown of storage costs (per epoch, day, and month)
   *   - allowanceCheck: Status of service allowances with optional message
   *   - actions: Array of required actions (deposit, approveService) that need to be executed
   *
   * @example
   * ```typescript
   * const prep = await warmStorageService.prepareStorageUpload(
   *   { dataSize: 1024 * 1024 * 1024, withCDN: true },
   *   paymentsService
   * )
   *
   * if (prep.actions.length > 0) {
   *   for (const action of prep.actions) {
   *     console.log(`Executing: ${action.description}`)
   *     await action.execute()
   *   }
   * }
   * ```
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
    // Parallelize cost calculation and allowance check
    const [costs, allowanceCheck] = await Promise.all([
      this.calculateStorageCost(options.dataSize, options.withCDN ?? false),
      this.checkAllowanceForStorage(
        options.dataSize,
        options.withCDN ?? false,
        paymentsService
      )
    ])

    const actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<ethers.TransactionResponse>
    }> = []

    // Check if deposit is needed
    const accountInfo = await paymentsService.accountInfo(TOKENS.USDFC)
    const requiredBalance = costs.perMonth // Require at least 1 month of funds

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
        perEpoch: costs.perEpoch,
        perDay: costs.perDay,
        perMonth: costs.perMonth
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.sufficient
          ? undefined
          : `Insufficient allowances: rate needed ${allowanceCheck.rateAllowanceNeeded}, lockup needed ${allowanceCheck.lockupAllowanceNeeded}`
      },
      actions
    }
  }

  // ========== Storage Provider Operations ==========

  /**
   * Register as a storage provider
   * @param signer - Signer to register as provider
   * @param serviceURL - HTTP service URL for the provider
   * @param peerId - Optional libp2p peer ID (pass empty string if not provided)
   * @returns Transaction response
   */
  async registerServiceProvider (
    signer: ethers.Signer,
    serviceURL: string,
    peerId: string = ''
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    // Convert peerId string to bytes (UTF-8 encoding)
    const peerIdBytes = ethers.toUtf8Bytes(peerId)
    return await contractWithSigner.registerServiceProvider(serviceURL, peerIdBytes)
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
   * Reject a pending service provider registration (owner only)
   * @param signer - Signer for the contract owner account
   * @param providerAddress - Address of the provider to reject
   * @returns Transaction response
   */
  async rejectServiceProvider (
    signer: ethers.Signer,
    providerAddress: string
  ): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.rejectServiceProvider(providerAddress)
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
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.removeServiceProvider(providerId)
  }

  /**
   * Check if an address is an approved provider
   * @param providerAddress - Address to check
   * @returns Whether the address is an approved provider
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

    // Map new contract structure to SDK interface with backwards compatibility
    return {
      storageProvider: info.storageProvider,
      serviceURL: info.serviceURL,
      peerId: ethers.toUtf8String(info.peerId),
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
    const result = await contract.pendingProviders(providerAddress)

    // The contract returns a tuple: (serviceURL, peerId as bytes, registeredAt)
    const [serviceURL, peerIdBytes, registeredAt] = result

    // Check if provider exists (empty values indicate non-existent provider)
    if (serviceURL == null || serviceURL === '') {
      throw new Error(`Pending provider ${providerAddress} not found`)
    }

    // Decode peerId from bytes to string
    let peerId = ''
    if (peerIdBytes != null && peerIdBytes !== '0x' && peerIdBytes !== '0x00') {
      try {
        // Convert bytes to string
        peerId = ethers.toUtf8String(peerIdBytes)
      } catch {
        // If not UTF-8, keep as hex string
        peerId = peerIdBytes
      }
    }

    // Map contract structure to SDK interface
    return {
      serviceURL,
      peerId,
      registeredAt: Number(registeredAt)
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
      storageProvider: p.storageProvider,
      serviceURL: p.serviceURL,
      peerId: ethers.toUtf8String(p.peerId),
      registeredAt: Number(p.registeredAt),
      approvedAt: Number(p.approvedAt)
    }))
  }

  /**
   * Add a service provider directly (admin function)
   * @param signer - Signer with owner permissions
   * @param provider - Provider address
   * @param pdpUrl - PDP service URL
   * @param pieceRetrievalUrl - Piece retrieval URL
   * @returns Transaction response
   */
  async addServiceProvider (signer: ethers.Signer, provider: string, pdpUrl: string, pieceRetrievalUrl: string): Promise<ethers.ContractTransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.addServiceProvider(provider, pdpUrl, pieceRetrievalUrl)
  }

  // ========== Proving Period Operations ==========

  /**
   * Get the maximum proving period from the WarmStorage contract
   * @returns Maximum proving period in epochs
   */
  async getMaxProvingPeriod (): Promise<number> {
    const contract = this._getWarmStorageContract()
    const maxPeriod = await contract.getMaxProvingPeriod()
    return Number(maxPeriod)
  }

  /**
   * Get the challenge window size from the WarmStorage contract
   * @returns Challenge window size in epochs
   */
  async getChallengeWindow (): Promise<number> {
    const contract = this._getWarmStorageContract()
    const window = await contract.challengeWindow()
    return Number(window)
  }
}
