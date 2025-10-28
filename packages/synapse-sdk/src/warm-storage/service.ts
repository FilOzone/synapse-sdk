/**
 * WarmStorageService - Consolidated interface for all Warm Storage contract operations
 *
 * This combines functionality for:
 * - Data set management and queries
 * - Service provider registration and management
 * - Client dataset ID tracking
 * - Data set creation verification
 * - CDN service management
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
 * // Register as a service provider
 * const signer = await provider.getSigner()
 * await warmStorageService.registerServiceProvider(signer, pdpUrl, retrievalUrl)
 * ```
 */

import { ethers } from 'ethers'
import type { PaymentsService } from '../payments/service.ts'
import type { DataSetCreationStatusResponse, PDPServer } from '../pdp/server.ts'
import { PDPVerifier } from '../pdp/verifier.ts'
import type { DataSetInfo, EnhancedDataSetInfo } from '../types.ts'
import { CONTRACT_ADDRESSES, SIZE_CONSTANTS, TIME_CONSTANTS, TIMING_CONSTANTS } from '../utils/constants.ts'
import { CONTRACT_ABIS, createError, getFilecoinNetworkType, TOKENS } from '../utils/index.ts'

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
  private _warmStorageViewContract: ethers.Contract | null = null
  private _pdpVerifier: PDPVerifier | null = null

  // All discovered addresses
  private readonly _addresses: {
    pdpVerifier: string
    payments: string
    usdfcToken: string
    filBeamBeneficiary: string
    viewContract: string
    serviceProviderRegistry: string
    sessionKeyRegistry: string
  }

  /**
   * Private constructor - use WarmStorageService.create() instead
   */
  private constructor(
    provider: ethers.Provider,
    warmStorageAddress: string,
    addresses: {
      pdpVerifier: string
      payments: string
      usdfcToken: string
      filBeamBeneficiary: string
      viewContract: string
      serviceProviderRegistry: string
      sessionKeyRegistry: string
    }
  ) {
    this._provider = provider
    this._warmStorageAddress = warmStorageAddress
    this._addresses = addresses
  }

  /**
   * Create a new WarmStorageService instance with initialized addresses
   */
  static async create(provider: ethers.Provider, warmStorageAddress: string): Promise<WarmStorageService> {
    // Get network from provider and validate it's a supported Filecoin network
    const networkName = await getFilecoinNetworkType(provider)

    // Initialize all contract addresses using Multicall3
    const multicall = new ethers.Contract(
      CONTRACT_ADDRESSES.MULTICALL3[networkName],
      CONTRACT_ABIS.MULTICALL3,
      provider
    )

    const iface = new ethers.Interface(CONTRACT_ABIS.WARM_STORAGE)

    const calls = [
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('pdpVerifierAddress'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('paymentsContractAddress'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('usdfcTokenAddress'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('filBeamBeneficiaryAddress'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('viewContractAddress'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('serviceProviderRegistry'),
      },
      {
        target: warmStorageAddress,
        allowFailure: false,
        callData: iface.encodeFunctionData('sessionKeyRegistry'),
      },
    ]

    const results = await multicall.aggregate3.staticCall(calls)

    const addresses = {
      pdpVerifier: iface.decodeFunctionResult('pdpVerifierAddress', results[0].returnData)[0],
      payments: iface.decodeFunctionResult('paymentsContractAddress', results[1].returnData)[0],
      usdfcToken: iface.decodeFunctionResult('usdfcTokenAddress', results[2].returnData)[0],
      filBeamBeneficiary: iface.decodeFunctionResult('filBeamBeneficiaryAddress', results[3].returnData)[0],
      viewContract: iface.decodeFunctionResult('viewContractAddress', results[4].returnData)[0],
      serviceProviderRegistry: iface.decodeFunctionResult('serviceProviderRegistry', results[5].returnData)[0],
      sessionKeyRegistry: iface.decodeFunctionResult('sessionKeyRegistry', results[6].returnData)[0],
    }

    return new WarmStorageService(provider, warmStorageAddress, addresses)
  }

  getPDPVerifierAddress(): string {
    return this._addresses.pdpVerifier
  }

  getPaymentsAddress(): string {
    return this._addresses.payments
  }

  getUSDFCTokenAddress(): string {
    return this._addresses.usdfcToken
  }

  getViewContractAddress(): string {
    return this._addresses.viewContract
  }

  getServiceProviderRegistryAddress(): string {
    return this._addresses.serviceProviderRegistry
  }

  getSessionKeyRegistryAddress(): string {
    return this._addresses.sessionKeyRegistry
  }

  /**
   * Get the provider instance
   * @returns The ethers provider
   */
  getProvider(): ethers.Provider {
    return this._provider
  }

  /**
   * Get cached Warm Storage contract instance or create new one
   */
  private _getWarmStorageContract(): ethers.Contract {
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
   * Get cached Warm Storage View contract instance or create new one
   */
  private _getWarmStorageViewContract(): ethers.Contract {
    if (this._warmStorageViewContract == null) {
      const viewAddress = this.getViewContractAddress()
      this._warmStorageViewContract = new ethers.Contract(viewAddress, CONTRACT_ABIS.WARM_STORAGE_VIEW, this._provider)
    }
    return this._warmStorageViewContract
  }

  /**
   * Get cached PDPVerifier instance or create new one
   */
  private _getPDPVerifier(): PDPVerifier {
    if (this._pdpVerifier == null) {
      const address = this.getPDPVerifierAddress()
      this._pdpVerifier = new PDPVerifier(this._provider, address)
    }
    return this._pdpVerifier
  }

  // ========== Client Data Set Operations ==========

  /**
   * Get a single data set by ID
   * @param dataSetId - The data set ID to retrieve
   * @returns Data set information
   * @throws Error if data set doesn't exist
   */
  async getDataSet(dataSetId: number): Promise<DataSetInfo> {
    const viewContract = this._getWarmStorageViewContract()
    const ds = await viewContract.getDataSet(dataSetId)

    if (Number(ds.pdpRailId) === 0) {
      throw createError('WarmStorageService', 'getDataSet', `Data set ${dataSetId} does not exist`)
    }

    // Convert from on-chain format to our interface
    return {
      pdpRailId: Number(ds.pdpRailId),
      cacheMissRailId: Number(ds.cacheMissRailId),
      cdnRailId: Number(ds.cdnRailId),
      payer: ds.payer,
      payee: ds.payee,
      serviceProvider: ds.serviceProvider,
      commissionBps: Number(ds.commissionBps),
      clientDataSetId: ds.clientDataSetId,
      pdpEndEpoch: Number(ds.pdpEndEpoch),
      providerId: Number(ds.providerId),
      dataSetId,
    }
  }

  /**
   * Get all data sets for a specific client
   * @param clientAddress - The client address
   * @returns Array of data set information
   */
  async getClientDataSets(clientAddress: string): Promise<DataSetInfo[]> {
    try {
      const viewContract = this._getWarmStorageViewContract()
      const dataSetData = await viewContract.getClientDataSets(clientAddress)

      // Convert from on-chain format to our interface
      return dataSetData.map((ds: any) => ({
        pdpRailId: Number(ds.pdpRailId),
        cacheMissRailId: Number(ds.cacheMissRailId),
        cdnRailId: Number(ds.cdnRailId),
        payer: ds.payer,
        payee: ds.payee,
        serviceProvider: ds.serviceProvider,
        commissionBps: Number(ds.commissionBps),
        clientDataSetId: ds.clientDataSetId,
        pdpEndEpoch: Number(ds.pdpEndEpoch),
        providerId: Number(ds.providerId),
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
  async getClientDataSetsWithDetails(client: string, onlyManaged: boolean = false): Promise<EnhancedDataSetInfo[]> {
    const pdpVerifier = this._getPDPVerifier()
    const viewContract = this._getWarmStorageViewContract()

    // Query dataset IDs directly from the view contract
    const ids: bigint[] = await viewContract.clientDataSets(client)
    if (ids.length === 0) return []

    // Enhance all in parallel using dataset IDs
    const enhancedDataSetsPromises = ids.map(async (idBigInt) => {
      const pdpVerifierDataSetId = Number(idBigInt)
      try {
        const base = await this.getDataSet(pdpVerifierDataSetId)

        // Parallelize independent calls
        const [isLive, listenerResult, metadata] = await Promise.all([
          pdpVerifier.dataSetLive(pdpVerifierDataSetId),
          pdpVerifier.getDataSetListener(pdpVerifierDataSetId).catch(() => null),
          this.getDataSetMetadata(pdpVerifierDataSetId).catch(() => Object.create(null) as Record<string, string>),
        ])

        // Check if this data set is managed by our Warm Storage contract
        const isManaged =
          listenerResult != null && listenerResult.toLowerCase() === this._warmStorageAddress.toLowerCase()

        // Skip unmanaged data sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get next piece ID only if the data set is live
        const nextPieceId = isLive ? await pdpVerifier.getNextPieceId(pdpVerifierDataSetId) : 0n

        return {
          ...base,
          pdpVerifierDataSetId,
          nextPieceId: Number(nextPieceId),
          currentPieceCount: Number(nextPieceId),
          isLive,
          isManaged,
          withCDN: base.cdnRailId > 0,
          metadata,
        }
      } catch (error) {
        throw new Error(
          `Failed to get details for data set ${pdpVerifierDataSetId}: ${error instanceof Error ? error.message : String(error)}`
        )
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedDataSetsPromises)

    // Filter out null values (from skipped data sets when onlyManaged is true)
    return results.filter((result): result is EnhancedDataSetInfo => result !== null)
  }

  /**
   * Validate that a dataset is live and managed by this WarmStorage contract
   *
   * Performs validation checks in parallel:
   * - Dataset exists and is live
   * - Dataset is managed by this WarmStorage contract
   *
   * @param dataSetId - The PDPVerifier data set ID
   * @throws if dataset is not valid for operations
   */
  async validateDataSet(dataSetId: number): Promise<void> {
    const pdpVerifier = this._getPDPVerifier()

    // Parallelize validation checks
    const [isLive, listener] = await Promise.all([
      pdpVerifier.dataSetLive(Number(dataSetId)),
      pdpVerifier.getDataSetListener(Number(dataSetId)),
    ])

    // Check if data set exists and is live
    if (!isLive) {
      throw new Error(`Data set ${dataSetId} does not exist or is not live`)
    }

    // Verify this data set is managed by our Warm Storage contract
    if (listener.toLowerCase() !== this._warmStorageAddress.toLowerCase()) {
      throw new Error(
        `Data set ${dataSetId} is not managed by this WarmStorage contract (${
          this._warmStorageAddress
        }), managed by ${String(listener)}`
      )
    }
  }

  /**
   * Verify that a data set creation transaction was successful
   * This checks both the transaction status and on-chain data set state
   * @param txHashOrTransaction - Transaction hash or transaction object
   * @returns Verification result with data set ID if found
   */
  async verifyDataSetCreation(
    txHashOrTransaction: string | ethers.TransactionResponse
  ): Promise<DataSetCreationVerification> {
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
          dataSetLive: false,
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
          error: 'Transaction failed',
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
          error: 'Could not find DataSetCreated event in transaction',
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
        gasUsed: receipt.gasUsed,
      }
    } catch (error) {
      // Error during verification (e.g., network issues)
      return {
        transactionMined: false,
        transactionSuccess: false,
        dataSetLive: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Get comprehensive data set creation status combining server and chain info
   * @param txHashOrTransaction - Transaction hash or transaction object
   * @param pdpServer - PDP server instance for status checks
   * @returns Combined status information
   */
  async getComprehensiveDataSetStatus(
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
        performance.measure(
          'synapse:pdpServer.getDataSetCreationStatus',
          'synapse:pdpServer.getDataSetCreationStatus-start',
          'synapse:pdpServer.getDataSetCreationStatus-end'
        )
      } catch {
        performance.mark('synapse:pdpServer.getDataSetCreationStatus-end')
        performance.measure(
          'synapse:pdpServer.getDataSetCreationStatus',
          'synapse:pdpServer.getDataSetCreationStatus-start',
          'synapse:pdpServer.getDataSetCreationStatus-end'
        )
        // Server doesn't have status yet or error occurred
      }
    }

    // Get chain status (pass through the transaction object if we have it)
    performance.mark('synapse:verifyDataSetCreation-start')
    const chainStatus = await this.verifyDataSetCreation(txHashOrTransaction)
    performance.mark('synapse:verifyDataSetCreation-end')
    performance.measure(
      'synapse:verifyDataSetCreation',
      'synapse:verifyDataSetCreation-start',
      'synapse:verifyDataSetCreation-end'
    )

    // Combine into summary
    // isComplete should be true only when BOTH chain and server have confirmed the data set creation
    const isComplete =
      chainStatus.transactionMined &&
      chainStatus.transactionSuccess &&
      chainStatus.dataSetId != null &&
      chainStatus.dataSetLive &&
      serverStatus != null &&
      serverStatus.ok === true &&
      serverStatus.dataSetCreated
    const dataSetId = serverStatus?.dataSetId ?? chainStatus.dataSetId ?? null

    // Determine error from server status or chain status
    let error: string | null = chainStatus.error ?? null
    if (serverStatus != null && serverStatus.ok === false) {
      error = `Server reported transaction failed (status: ${serverStatus.txStatus})`
    }

    return {
      txHash,
      serverStatus,
      chainStatus,
      summary: {
        isComplete,
        isLive: chainStatus.dataSetLive,
        dataSetId,
        error,
      },
    }
  }

  /**
   * Wait for data set creation with status updates
   * @param txHashOrTransaction - Transaction hash or transaction object to wait for
   * @param pdpServer - PDP server for status checks
   * @param maxWaitTime - Maximum time to wait in milliseconds
   * @param pollInterval - Polling interval in milliseconds
   * @param onProgress - Optional progress callback
   * @returns Final comprehensive status
   */
  async waitForDataSetCreationWithStatus(
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer: PDPServer,
    maxWaitTime: number = TIMING_CONSTANTS.DATA_SET_CREATION_TIMEOUT_MS,
    pollInterval: number = TIMING_CONSTANTS.DATA_SET_CREATION_POLL_INTERVAL_MS,
    onProgress?: (status: ComprehensiveDataSetStatus, elapsedMs: number) => Promise<void>
  ): Promise<ComprehensiveDataSetStatus> {
    const startTime = Date.now()

    while (Date.now() - startTime < maxWaitTime) {
      const status = await this.getComprehensiveDataSetStatus(txHashOrTransaction, pdpServer)
      const elapsedMs = Date.now() - startTime

      // Fire progress callback if provided
      if (onProgress != null) {
        try {
          await onProgress(status, elapsedMs)
        } catch (error) {
          // Don't let callback errors break the polling loop
          console.error('Error in progress callback:', error)
        }
      }

      // Check if complete
      if (status.summary.isComplete) {
        return status
      }

      // Check for errors
      if (status.summary.error != null && status.chainStatus.transactionMined) {
        // Transaction confirmed but failed
        throw new Error(status.summary.error)
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, pollInterval))
    }

    // Timeout
    throw new Error(`Data set creation timed out after ${maxWaitTime / 1000} seconds`)
  }

  // ========== Metadata Operations ==========

  /**
   * Get all metadata for a data set
   * @param dataSetId - The data set ID
   * @returns Object with metadata key-value pairs
   */
  async getDataSetMetadata(dataSetId: number): Promise<Record<string, string>> {
    const viewContract = this._getWarmStorageViewContract()
    const [keys, values] = await viewContract.getAllDataSetMetadata(dataSetId)

    // Create a prototype-safe object to avoid pollution risks from arbitrary keys
    const metadata: Record<string, string> = Object.create(null)
    for (let i = 0; i < keys.length; i++) {
      metadata[keys[i]] = values[i]
    }
    return metadata
  }

  /**
   * Get specific metadata key for a data set
   * @param dataSetId - The data set ID
   * @param key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getDataSetMetadataByKey(dataSetId: number, key: string): Promise<string | null> {
    const viewContract = this._getWarmStorageViewContract()
    const [exists, value] = await viewContract.getDataSetMetadata(dataSetId, key)
    return exists ? value : null
  }

  /**
   * Get all metadata for a piece in a data set
   * @param dataSetId - The data set ID
   * @param pieceId - The piece ID
   * @returns Object with metadata key-value pairs
   */
  async getPieceMetadata(dataSetId: number, pieceId: number): Promise<Record<string, string>> {
    const viewContract = this._getWarmStorageViewContract()
    const [keys, values] = await viewContract.getAllPieceMetadata(dataSetId, pieceId)

    // Create a prototype-safe object to avoid pollution risks from arbitrary keys
    const metadata: Record<string, string> = Object.create(null)
    for (let i = 0; i < keys.length; i++) {
      metadata[keys[i]] = values[i]
    }
    return metadata
  }

  /**
   * Get specific metadata key for a piece in a data set
   * @param dataSetId - The data set ID
   * @param pieceId - The piece ID
   * @param key - The metadata key to retrieve
   * @returns The metadata value if it exists, null otherwise
   */
  async getPieceMetadataByKey(dataSetId: number, pieceId: number, key: string): Promise<string | null> {
    const viewContract = this._getWarmStorageViewContract()
    const [exists, value] = await viewContract.getPieceMetadata(dataSetId, pieceId, key)
    return exists ? value : null
  }

  // ========== Storage Cost Operations ==========

  /**
   * Get the current service price per TiB per month
   * @returns Service price information for both CDN and non-CDN options
   */
  async getServicePrice(): Promise<ServicePriceInfo> {
    const contract = this._getWarmStorageContract()
    const pricing = await contract.getServicePrice()
    return {
      pricePerTiBPerMonthNoCDN: pricing.pricePerTiBPerMonthNoCDN,
      pricePerTiBPerMonthWithCDN: pricing.pricePerTiBPerMonthWithCDN,
      tokenAddress: pricing.tokenAddress,
      epochsPerMonth: pricing.epochsPerMonth,
    }
  }

  /**
   * Calculate storage costs for a given size
   * @param sizeInBytes - Size of data to store in bytes
   * @returns Cost estimates per epoch, day, and month for both CDN and non-CDN
   */
  async calculateStorageCost(sizeInBytes: number): Promise<{
    perEpoch: bigint
    perDay: bigint
    perMonth: bigint
    withCDN: {
      perEpoch: bigint
      perDay: bigint
      perMonth: bigint
    }
  }> {
    const servicePriceInfo = await this.getServicePrice()

    // Calculate price per byte per epoch
    const sizeInBytesBigint = BigInt(sizeInBytes)
    const pricePerEpochNoCDN =
      (servicePriceInfo.pricePerTiBPerMonthNoCDN * sizeInBytesBigint) /
      (SIZE_CONSTANTS.TiB * servicePriceInfo.epochsPerMonth)
    const pricePerEpochWithCDN =
      (servicePriceInfo.pricePerTiBPerMonthWithCDN * sizeInBytesBigint) /
      (SIZE_CONSTANTS.TiB * servicePriceInfo.epochsPerMonth)

    return {
      perEpoch: pricePerEpochNoCDN,
      perDay: pricePerEpochNoCDN * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY),
      perMonth: pricePerEpochNoCDN * servicePriceInfo.epochsPerMonth,
      withCDN: {
        perEpoch: pricePerEpochWithCDN,
        perDay: pricePerEpochWithCDN * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY),
        perMonth: pricePerEpochWithCDN * servicePriceInfo.epochsPerMonth,
      },
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
  async checkAllowanceForStorage(
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
    // Get current allowances and calculate costs in parallel
    const [approval, costs] = await Promise.all([
      paymentsService.serviceApproval(this._warmStorageAddress, TOKENS.USDFC),
      this.calculateStorageCost(sizeInBytes),
    ])

    const selectedCosts = withCDN ? costs.withCDN : costs
    const rateNeeded = selectedCosts.perEpoch

    // Calculate lockup period based on provided days (default: 10)
    const lockupPeriod =
      BigInt(lockupDays ?? Number(TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS)) * BigInt(TIME_CONSTANTS.EPOCHS_PER_DAY)
    const lockupNeeded = rateNeeded * lockupPeriod

    // Calculate required allowances (current usage + new requirement)
    const totalRateNeeded = BigInt(approval.rateUsed) + rateNeeded
    const totalLockupNeeded = BigInt(approval.lockupUsed) + lockupNeeded

    // Check if allowances are sufficient
    const sufficient = approval.rateAllowance >= totalRateNeeded && approval.lockupAllowance >= totalLockupNeeded

    // Calculate how much more is needed
    const rateAllowanceNeeded = totalRateNeeded > approval.rateAllowance ? totalRateNeeded - approval.rateAllowance : 0n

    const lockupAllowanceNeeded =
      totalLockupNeeded > approval.lockupAllowance ? totalLockupNeeded - approval.lockupAllowance : 0n

    // Build optional message
    let message: string | undefined
    if (!sufficient) {
      const needsRate = rateAllowanceNeeded > 0n
      const needsLockup = lockupAllowanceNeeded > 0n
      if (needsRate && needsLockup) {
        message = 'Insufficient rate and lockup allowances'
      } else if (needsRate) {
        message = 'Insufficient rate allowance'
      } else if (needsLockup) {
        message = 'Insufficient lockup allowance'
      }
    }

    return {
      rateAllowanceNeeded,
      lockupAllowanceNeeded,
      currentRateAllowance: approval.rateAllowance,
      currentLockupAllowance: approval.lockupAllowance,
      currentRateUsed: approval.rateUsed,
      currentLockupUsed: approval.lockupUsed,
      sufficient,
      message,
      costs: selectedCosts,
      depositAmountNeeded: lockupNeeded,
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
   *   { dataSize: Number(SIZE_CONSTANTS.GiB), withCDN: true },
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
  async prepareStorageUpload(
    options: {
      dataSize: number
      withCDN?: boolean
    },
    paymentsService: PaymentsService
  ): Promise<{
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
      this.calculateStorageCost(options.dataSize),
      this.checkAllowanceForStorage(options.dataSize, options.withCDN ?? false, paymentsService),
    ])

    // Select the appropriate costs based on CDN option
    const selectedCosts = (options.withCDN ?? false) ? costs.withCDN : costs

    const actions: Array<{
      type: 'deposit' | 'approve' | 'approveService'
      description: string
      execute: () => Promise<ethers.TransactionResponse>
    }> = []

    // Check if deposit is needed
    const accountInfo = await paymentsService.accountInfo(TOKENS.USDFC)
    const requiredBalance = selectedCosts.perMonth // Require at least 1 month of funds

    if (accountInfo.availableFunds < requiredBalance) {
      const depositAmount = requiredBalance - accountInfo.availableFunds
      actions.push({
        type: 'deposit',
        description: `Deposit ${depositAmount} USDFC to payments contract`,
        execute: async () => await paymentsService.deposit(depositAmount, TOKENS.USDFC),
      })
    }

    // Check if service approval is needed
    if (!allowanceCheck.sufficient) {
      actions.push({
        type: 'approveService',
        description: `Approve service with rate allowance ${allowanceCheck.rateAllowanceNeeded} and lockup allowance ${allowanceCheck.lockupAllowanceNeeded}`,
        execute: async () =>
          await paymentsService.approveService(
            this._warmStorageAddress,
            allowanceCheck.rateAllowanceNeeded,
            allowanceCheck.lockupAllowanceNeeded,
            TIME_CONSTANTS.EPOCHS_PER_MONTH, // 30 days max lockup period
            TOKENS.USDFC
          ),
      })
    }

    return {
      estimatedCost: {
        perEpoch: selectedCosts.perEpoch,
        perDay: selectedCosts.perDay,
        perMonth: selectedCosts.perMonth,
      },
      allowanceCheck: {
        sufficient: allowanceCheck.sufficient,
        message: allowanceCheck.sufficient
          ? undefined
          : `Insufficient allowances: rate needed ${allowanceCheck.rateAllowanceNeeded}, lockup needed ${allowanceCheck.lockupAllowanceNeeded}`,
      },
      actions,
    }
  }

  // ========== Data Set Operations ==========

  /**
   * Terminate a data set with given ID
   * @param signer - Signer which created this dataset
   * @param dataSetId  - ID of the data set to terminate
   * @returns Transaction receipt
   */
  async terminateDataSet(signer: ethers.Signer, dataSetId: number): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.terminateService(dataSetId)
  }

  // ========== Service Provider Approval Operations ==========

  /**
   * Add an approved provider by ID (owner only)
   * @param signer - Signer with owner permissions
   * @param providerId - Provider ID from registry
   * @returns Transaction response
   */
  async addApprovedProvider(signer: ethers.Signer, providerId: number): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.addApprovedProvider(providerId)
  }

  /**
   * Remove an approved provider by ID (owner only)
   * @param signer - Signer with owner permissions
   * @param providerId - Provider ID from registry
   * @returns Transaction response
   */
  async removeApprovedProvider(signer: ethers.Signer, providerId: number): Promise<ethers.TransactionResponse> {
    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract

    // First, we need to find the index of this provider in the array
    const viewContract = this._getWarmStorageViewContract()
    const approvedIds = await viewContract.getApprovedProviders(0n, 0n)
    const index = approvedIds.findIndex((id: bigint) => Number(id) === providerId)

    if (index === -1) {
      throw new Error(`Provider ${providerId} is not in the approved list`)
    }

    return await contractWithSigner.removeApprovedProvider(providerId, index)
  }

  /**
   * Get list of approved provider IDs
   * @returns Array of approved provider IDs
   */
  async getApprovedProviderIds(): Promise<number[]> {
    const viewContract = this._getWarmStorageViewContract()
    const providerIds = await viewContract.getApprovedProviders(0n, 0n)
    return providerIds.map((id: bigint) => Number(id))
  }

  /**
   * Check if a provider ID is approved
   * @param providerId - Provider ID to check
   * @returns Whether the provider is approved
   */
  async isProviderIdApproved(providerId: number): Promise<boolean> {
    const viewContract = this._getWarmStorageViewContract()
    return await viewContract.isProviderApproved(providerId)
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner(): Promise<string> {
    const contract = this._getWarmStorageContract()
    return await contract.owner()
  }

  /**
   * Check if a signer is the contract owner
   * @param signer - Signer to check
   * @returns Whether the signer is the owner
   */
  async isOwner(signer: ethers.Signer): Promise<boolean> {
    const signerAddress = await signer.getAddress()
    const ownerAddress = await this.getOwner()
    return signerAddress.toLowerCase() === ownerAddress.toLowerCase()
  }

  // ========== Proving Period Operations ==========

  /**
   * Get the maximum proving period from the WarmStorage contract
   * @returns Maximum proving period in epochs
   */
  async getMaxProvingPeriod(): Promise<number> {
    const viewContract = this._getWarmStorageViewContract()
    const maxPeriod = await viewContract.getMaxProvingPeriod()
    return Number(maxPeriod)
  }

  /**
   * Get the challenge window size from the WarmStorage contract
   * @returns Challenge window size in epochs
   */
  async getChallengeWindow(): Promise<number> {
    const viewContract = this._getWarmStorageViewContract()
    const window = await viewContract.challengeWindow()
    return Number(window)
  }
  /**
   * Increments the fixed locked-up amounts for CDN payment rails.
   *
   * This method tops up the prepaid balance for CDN services by adding to the existing
   * lockup amounts. Both CDN and cache miss rails can be incremented independently.
   *
   * @param dataSetId - The ID of the data set
   * @param cdnAmountToAdd - Amount to add to the CDN rail lockup
   * @param cacheMissAmountToAdd - Amount to add to the cache miss rail lockup
   * @returns Transaction response
   */
  async topUpCDNPaymentRails(
    signer: ethers.Signer,
    dataSetId: number,
    cdnAmountToAdd: bigint,
    cacheMissAmountToAdd: bigint
  ): Promise<ethers.TransactionResponse> {
    if (cdnAmountToAdd < 0n || cacheMissAmountToAdd < 0n) {
      throw new Error('Top up amounts must be positive')
    }
    if (cdnAmountToAdd === 0n && cacheMissAmountToAdd === 0n) {
      throw new Error('At least one top up amount must be >0')
    }

    const contract = this._getWarmStorageContract()
    const contractWithSigner = contract.connect(signer) as ethers.Contract
    return await contractWithSigner.topUpCDNPaymentRails(dataSetId, cdnAmountToAdd, cacheMissAmountToAdd)
  }
}
