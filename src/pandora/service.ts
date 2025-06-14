/**
 * PandoraService - Consolidated interface for all Pandora contract operations
 *
 * This combines functionality for:
 * - Proof set management and queries
 * - Storage provider registration and management
 * - Client dataset ID tracking
 * - Proof set creation verification
 *
 * @example
 * ```typescript
 * import { PandoraService } from '@filoz/synapse-sdk/pandora'
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const pandoraService = new PandoraService(provider, pandoraAddress)
 *
 * // Get proof sets for a client
 * const proofSets = await pandoraService.getClientProofSets(clientAddress)
 * console.log(`Client has ${proofSets.length} proof sets`)
 *
 * // Register as a storage provider
 * const signer = await provider.getSigner()
 * await pandoraService.registerServiceProvider(signer, pdpUrl, retrievalUrl)
 * ```
 */

import { ethers } from 'ethers'
import type { ProofSetInfo, EnhancedProofSetInfo, ApprovedProviderInfo } from '../types.js'
import { CONTRACT_ABIS, TOKENS } from '../utils/index.js'
import { PDPVerifier } from '../pdp/verifier.js'
import type { PDPServer, ProofSetCreationStatusResponse } from '../pdp/server.js'
import { PaymentsService } from '../payments/service.js'
import { SIZE_CONSTANTS, TIME_CONSTANTS, TIMING_CONSTANTS } from '../utils/constants.js'

/**
 * Helper information for adding roots to a proof set
 */
export interface AddRootsInfo {
  /** The next root ID to use when adding roots */
  nextRootId: number
  /** The client dataset ID for this proof set */
  clientDataSetId: number
  /** Current number of roots in the proof set */
  currentRootCount: number
}

/**
 * Result of verifying a proof set creation transaction
 */
export interface ProofSetCreationVerification {
  /** Whether the transaction has been mined */
  transactionMined: boolean
  /** Whether the transaction was successful */
  transactionSuccess: boolean
  /** The proof set ID that was created (if successful) */
  proofSetId?: number
  /** Whether the proof set exists and is live on-chain */
  proofSetLive: boolean
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
export interface ComprehensiveProofSetStatus {
  /** Transaction hash */
  txHash: string
  /** Server-side status */
  serverStatus: ProofSetCreationStatusResponse | null
  /** Chain verification status */
  chainStatus: ProofSetCreationVerification
  /** Combined status summary */
  summary: {
    /** Whether creation is complete and successful, both on chain and on the server */
    isComplete: boolean
    /** Whether proof set is live on chain */
    isLive: boolean
    /** Final proof set ID if available */
    proofSetId: number | null
    /** Any error messages */
    error: string | null
  }
}

export class PandoraService {
  private readonly _provider: ethers.Provider
  private readonly _pandoraAddress: string
  private _pandoraContract: ethers.Contract | null = null
  private _pdpVerifier: PDPVerifier | null = null

  constructor (provider: ethers.Provider, pandoraAddress: string) {
    this._provider = provider
    this._pandoraAddress = pandoraAddress
  }

  /**
   * Get cached Pandora contract instance or create new one
   */
  private _getPandoraContract (): ethers.Contract {
    if (this._pandoraContract == null) {
      this._pandoraContract = new ethers.Contract(
        this._pandoraAddress,
        CONTRACT_ABIS.PANDORA_SERVICE,
        this._provider
      )
    }
    return this._pandoraContract
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

  // ========== Client Proof Set Operations ==========

  /**
   * Get all proof sets for a given client address
   * @param clientAddress - The client's wallet address
   * @returns Array of proof set information
   */
  async getClientProofSets (clientAddress: string): Promise<ProofSetInfo[]> {
    const pandoraContract = this._getPandoraContract()

    try {
      // Call the getClientProofSets function on the contract
      const proofSetsData = await pandoraContract.getClientProofSets(clientAddress)

      // Map the raw data to our ProofSetInfo interface
      const proofSets: ProofSetInfo[] = []

      // The contract returns an array of structs, we need to map them
      for (let i = 0; i < proofSetsData.length; i++) {
        const data = proofSetsData[i]

        // Skip entries with empty/default values (can happen with contract bugs or uninitialized data)
        if (data.payer === '0x0000000000000000000000000000000000000000' || Number(data.railId) === 0) {
          continue
        }

        proofSets.push({
          railId: Number(data.railId),
          payer: data.payer,
          payee: data.payee,
          commissionBps: Number(data.commissionBps),
          metadata: data.metadata,
          rootMetadata: data.rootMetadata, // This is already an array of strings
          clientDataSetId: Number(data.clientDataSetId),
          withCDN: data.withCDN
        })
      }

      return proofSets
    } catch (error) {
      throw new Error(`Failed to get client proof sets: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get enhanced proof set information including chain details
   * @param clientAddress - The client's wallet address
   * @param onlyManaged - If true, only return proof sets managed by this Pandora contract (default: false)
   * @returns Array of proof set information with additional chain data and clear ID separation
   */
  async getClientProofSetsWithDetails (clientAddress: string, onlyManaged: boolean = false): Promise<EnhancedProofSetInfo[]> {
    const proofSets = await this.getClientProofSets(clientAddress)
    const pdpVerifier = this._getPDPVerifier()
    const pandoraContract = this._getPandoraContract()

    // Process all proof sets in parallel
    const enhancedProofSetsPromises = proofSets.map(async (proofSet) => {
      try {
        // Get the actual PDPVerifier proof set ID from the rail ID
        const pdpVerifierProofSetId = await pandoraContract.railToProofSet(proofSet.railId)

        // If railToProofSet returns 0, this rail doesn't exist in this Pandora contract
        if (Number(pdpVerifierProofSetId) === 0) {
          return onlyManaged
            ? null // Will be filtered out
            : {
                ...proofSet,
                pdpVerifierProofSetId: 0,
                nextRootId: 0,
                currentRootCount: 0,
                isLive: false,
                isManaged: false
              }
        }

        // Parallelize independent calls
        const [isLive, listenerResult] = await Promise.all([
          pdpVerifier.proofSetLive(Number(pdpVerifierProofSetId)),
          pdpVerifier.getProofSetListener(Number(pdpVerifierProofSetId)).catch(() => null)
        ])

        // Check if this proof set is managed by our Pandora contract
        const isManaged = listenerResult != null && listenerResult.toLowerCase() === this._pandoraAddress.toLowerCase()

        // Skip unmanaged proof sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          return null // Will be filtered out
        }

        // Get next root ID only if the proof set is live
        const nextRootId = isLive ? await pdpVerifier.getNextRootId(Number(pdpVerifierProofSetId)) : 0

        return {
          ...proofSet,
          pdpVerifierProofSetId: Number(pdpVerifierProofSetId),
          nextRootId: Number(nextRootId),
          currentRootCount: Number(nextRootId),
          isLive,
          isManaged
        }
      } catch (error) {
        // Re-throw the error to let the caller handle it
        throw new Error(`Failed to get details for proof set with rail ID ${proofSet.railId}: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    // Wait for all promises to resolve
    const results = await Promise.all(enhancedProofSetsPromises)

    // Filter out null values (from skipped proof sets when onlyManaged is true)
    return results.filter((result): result is EnhancedProofSetInfo => result !== null)
  }

  /**
   * Get information needed to add roots to an existing proof set
   * @param proofSetId - The proof set ID to get information for
   * @returns Information needed for adding roots (next root ID, client dataset ID)
   */
  async getAddRootsInfo (proofSetId: number): Promise<AddRootsInfo> {
    try {
      const pandoraContract = this._getPandoraContract()
      const pdpVerifier = this._getPDPVerifier()

      // Parallelize all independent calls
      const [isLive, nextRootId, listener, proofSetInfo] = await Promise.all([
        pdpVerifier.proofSetLive(Number(proofSetId)),
        pdpVerifier.getNextRootId(Number(proofSetId)),
        pdpVerifier.getProofSetListener(Number(proofSetId)),
        pandoraContract.getProofSet(Number(proofSetId))
      ])

      // Check if proof set exists and is live
      if (!isLive) {
        throw new Error(`Proof set ${proofSetId} does not exist or is not live`)
      }

      // Verify this proof set is managed by our Pandora contract
      if (listener.toLowerCase() !== this._pandoraAddress.toLowerCase()) {
        throw new Error(`Proof set ${proofSetId} is not managed by this Pandora contract (${this._pandoraAddress}), managed by ${String(listener)}`)
      }

      const clientDataSetId = Number(proofSetInfo.clientDataSetId)

      return {
        nextRootId: Number(nextRootId),
        clientDataSetId,
        currentRootCount: Number(nextRootId)
      }
    } catch (error) {
      throw new Error(`Failed to get add roots info: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get the next available client dataset ID for a client
   * This reads the current counter from the Pandora contract
   * @param clientAddress - The client's wallet address
   * @returns The next client dataset ID that will be assigned by this Pandora contract
   */
  async getNextClientDataSetId (clientAddress: string): Promise<number> {
    try {
      const pandoraContract = this._getPandoraContract()

      // Get the current clientDataSetIDs counter for this client in this Pandora contract
      // This is the value that will be used for the next proof set creation
      const currentCounter = await pandoraContract.clientDataSetIDs(clientAddress)

      // Return the current counter value (it will be incremented during proof set creation)
      return Number(currentCounter)
    } catch (error) {
      throw new Error(`Failed to get next client dataset ID: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Verify that a proof set creation transaction was successful
   * This checks both the transaction status and on-chain proof set state
   * @param txHashOrTransaction - Transaction hash or transaction object from proof set creation
   * @returns Verification result with transaction and proof set status
   */
  async verifyProofSetCreation (txHashOrTransaction: string | ethers.TransactionResponse): Promise<ProofSetCreationVerification> {
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
          proofSetLive: false
        }
      }

      // Transaction is mined, check if it was successful
      const transactionSuccess = receipt.status === 1

      if (!transactionSuccess) {
        return {
          transactionMined: true,
          transactionSuccess: false,
          proofSetLive: false,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          error: 'Transaction failed'
        }
      }

      // Extract proof set ID from transaction logs
      const pdpVerifier = this._getPDPVerifier()
      const proofSetId = await pdpVerifier.extractProofSetIdFromReceipt(receipt)

      if (proofSetId == null) {
        return {
          transactionMined: true,
          transactionSuccess: true,
          proofSetLive: false,
          blockNumber: receipt.blockNumber,
          gasUsed: receipt.gasUsed,
          error: 'Could not find ProofSetCreated event in transaction'
        }
      }

      // Verify the proof set exists and is live on-chain
      const isLive = await pdpVerifier.proofSetLive(proofSetId)

      return {
        transactionMined: true,
        transactionSuccess: true,
        proofSetId,
        proofSetLive: isLive,
        blockNumber: receipt.blockNumber,
        gasUsed: receipt.gasUsed
      }
    } catch (error) {
      return {
        transactionMined: false,
        transactionSuccess: false,
        proofSetLive: false,
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
  async getComprehensiveProofSetStatus (
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer: PDPServer
  ): Promise<ComprehensiveProofSetStatus> {
    // Get transaction hash
    const txHash = typeof txHashOrTransaction === 'string' ? txHashOrTransaction : txHashOrTransaction.hash

    // Get server status
    let serverStatus: ProofSetCreationStatusResponse | null = null
    try {
      serverStatus = await pdpServer.getProofSetCreationStatus(txHash)
    } catch (error) {
      // Server might not have the status yet
    }

    // Get chain status (pass through the transaction object if we have it)
    const chainStatus = await this.verifyProofSetCreation(txHashOrTransaction)

    // Combine into summary
    const summary = {
      isComplete: chainStatus.transactionMined && chainStatus.proofSetLive && serverStatus != null && serverStatus.ok === true,
      isLive: chainStatus.proofSetLive,
      proofSetId: chainStatus.proofSetId ?? serverStatus?.proofSetId ?? null,
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
   * Wait for a proof set to be created and become live
   * @param txHashOrTransaction - Transaction hash or transaction object from createProofSet
   * @param pdpServer - PDPServer instance to check server status
   * @param timeoutMs - Maximum time to wait in milliseconds
   * @param pollIntervalMs - How often to check in milliseconds
   * @param onProgress - Optional callback for progress updates
   * @returns Final status when complete or timeout
   */
  async waitForProofSetCreationWithStatus (
    txHashOrTransaction: string | ethers.TransactionResponse,
    pdpServer: PDPServer,
    timeoutMs: number = TIMING_CONSTANTS.PROOF_SET_CREATION_TIMEOUT_MS,
    pollIntervalMs: number = TIMING_CONSTANTS.PROOF_SET_CREATION_POLL_INTERVAL_MS,
    onProgress?: (status: ComprehensiveProofSetStatus, elapsedMs: number) => void | Promise<void>
  ): Promise<ComprehensiveProofSetStatus> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const status = await this.getComprehensiveProofSetStatus(txHashOrTransaction, pdpServer)

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

    throw new Error(`Timeout waiting for proof set creation after ${timeoutMs}ms`)
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
    const pandoraContract = this._getPandoraContract()

    // Fetch pricing from chain
    let pricePerTiBPerMonthNoCDN: bigint
    let pricePerTiBPerMonthWithCDN: bigint
    let epochsPerMonth: bigint

    try {
      // Try the newer format first (4 values with CDN pricing)
      const result = await pandoraContract.getServicePrice()
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
   * @returns Allowance requirement details and storage costs
   */
  async checkAllowanceForStorage (
    sizeInBytes: number,
    withCDN: boolean,
    paymentsService: PaymentsService
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
    }> {
    // Get current allowances for this Pandora service
    const approval = await paymentsService.serviceApproval(this._pandoraAddress, TOKENS.USDFC)

    // Calculate storage costs
    const costs = await this.calculateStorageCost(sizeInBytes)
    const selectedCosts = withCDN ? costs.withCDN : costs
    const rateNeeded = selectedCosts.perEpoch

    // Default lockup period is 10 days = 28,800 epochs
    const lockupNeeded = rateNeeded * TIME_CONSTANTS.DEFAULT_LOCKUP_PERIOD

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
      }
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
          this._pandoraAddress,
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
    const contract = this._getPandoraContract().connect(signer) as ethers.Contract
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
    const contract = this._getPandoraContract().connect(signer) as ethers.Contract
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
    const contract = this._getPandoraContract().connect(signer) as ethers.Contract
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
    const contract = this._getPandoraContract().connect(signer) as ethers.Contract
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
    const contract = this._getPandoraContract().connect(signer) as ethers.Contract
    return await contract.addServiceProvider(providerAddress, pdpUrl, pieceRetrievalUrl)
  }

  /**
   * Check if a provider is approved
   * @param providerAddress - Address of the provider to check
   * @returns Whether the provider is approved
   */
  async isProviderApproved (providerAddress: string): Promise<boolean> {
    const contract = this._getPandoraContract()
    return await contract.isProviderApproved(providerAddress)
  }

  /**
   * Get provider ID by address
   * @param providerAddress - Address of the provider
   * @returns Provider ID (0 if not approved)
   */
  async getProviderIdByAddress (providerAddress: string): Promise<number> {
    const contract = this._getPandoraContract()
    const id = await contract.getProviderIdByAddress(providerAddress)
    return Number(id)
  }

  /**
   * Get information about an approved provider
   * @param providerId - ID of the provider
   * @returns Provider information
   */
  async getApprovedProvider (providerId: number): Promise<ApprovedProviderInfo> {
    const contract = this._getPandoraContract()
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
    const contract = this._getPandoraContract()
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
    const contract = this._getPandoraContract()
    const id = await contract.nextServiceProviderId()
    return Number(id)
  }

  /**
   * Get the contract owner address
   * @returns Owner address
   */
  async getOwner (): Promise<string> {
    const contract = this._getPandoraContract()
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
    const nextId = await this.getNextProviderId()
    const providers: ApprovedProviderInfo[] = []

    // Provider IDs start at 1
    for (let i = 1; i < nextId; i++) {
      try {
        const provider = await this.getApprovedProvider(i)
        // Skip if provider was removed (owner would be zero address)
        if (provider.owner !== '0x0000000000000000000000000000000000000000') {
          providers.push(provider)
        }
      } catch (e) {
        // Provider might have been removed
        continue
      }
    }

    return providers
  }
}
