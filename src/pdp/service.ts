/**
 * PDPService - Handles non-payment related interactions with Pandora contracts
 *
 * This is a standalone utility for querying proof sets and other Pandora contract state.
 *
 * @example
 * ```typescript
 * import { PDPService } from '@filoz/synapse-sdk/pdp'
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const pdpService = new PDPService(provider, pandoraAddress)
 *
 * // Get proof sets for a client
 * const proofSets = await pdpService.getClientProofSets(clientAddress)
 * console.log(`Client has ${proofSets.length} proof sets`)
 * ```
 */

import { ethers } from 'ethers'
import type { ProofSetInfo, EnhancedProofSetInfo } from '../types.js'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from '../utils/index.js'

/**
 * Information about a proof set creation event
 */
export interface ProofSetCreationInfo {
  /** The proof set ID that was created */
  proofSetId: number
  /** Transaction hash that created the proof set */
  txHash: string
  /** Block number where it was created */
  blockNumber: number
  /** The client address that created it */
  client: string
}

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

export class PDPService {
  private readonly _provider: ethers.Provider
  private readonly _pandoraAddress: string
  private _pandoraContract: ethers.Contract | null = null
  private _pdpVerifierContract: ethers.Contract | null = null

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
   * Get cached PDPVerifier contract instance or create new one
   */
  private async _getPDPVerifierContract (): Promise<ethers.Contract> {
    if (this._pdpVerifierContract == null) {
      // Detect network to get the correct PDPVerifier address
      const network = await this._provider.getNetwork()
      const chainId = Number(network.chainId)

      let pdpVerifierAddress: string
      if (chainId === 314) {
        pdpVerifierAddress = CONTRACT_ADDRESSES.PDP_VERIFIER.mainnet
      } else if (chainId === 314159) {
        pdpVerifierAddress = CONTRACT_ADDRESSES.PDP_VERIFIER.calibration
      } else {
        throw new Error(`Unsupported network: ${chainId}. Only Filecoin mainnet (314) and calibration (314159) are supported.`)
      }

      this._pdpVerifierContract = new ethers.Contract(
        pdpVerifierAddress,
        CONTRACT_ABIS.PDP_VERIFIER,
        this._provider
      )
    }
    return this._pdpVerifierContract
  }

  /**
   * Get all proof sets for a given client address with additional chain information
   * @param clientAddress - The client's wallet address
   * @returns Array of proof set information with chain details
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
    const pdpVerifier = await this._getPDPVerifierContract()

    const enhancedProofSets = []

    for (const proofSet of proofSets) {
      try {
        // Get the actual PDPVerifier proof set ID from the rail ID
        const pandoraContract = this._getPandoraContract()
        const pdpVerifierProofSetId = await pandoraContract.railToProofSet(proofSet.railId)

        // If railToProofSet returns 0, this rail doesn't exist in this Pandora contract
        if (Number(pdpVerifierProofSetId) === 0) {
          // Skip unmanaged proof sets if onlyManaged is true
          if (onlyManaged) {
            continue
          }

          enhancedProofSets.push({
            ...proofSet,
            pdpVerifierProofSetId: 0,
            nextRootId: 0,
            currentRootCount: 0,
            isLive: false,
            isManaged: false
          })
          continue
        }

        // Get additional chain information using the PDPVerifier proof set ID
        const isLive = await pdpVerifier.proofSetLive(pdpVerifierProofSetId)
        const nextRootId = isLive === true ? await pdpVerifier.getNextRootId(pdpVerifierProofSetId) : 0

        // Check if this proof set is managed by our Pandora contract
        let isManaged = false
        try {
          const listener = await pdpVerifier.getProofSetListener(pdpVerifierProofSetId)
          isManaged = listener.toLowerCase() === this._pandoraAddress.toLowerCase()
        } catch (e) {
          // Could not get listener - proof set might not exist or have other issues
          isManaged = false
        }

        // Skip unmanaged proof sets if onlyManaged is true
        if (onlyManaged && !isManaged) {
          continue
        }

        enhancedProofSets.push({
          ...proofSet,
          pdpVerifierProofSetId: Number(pdpVerifierProofSetId),
          nextRootId: Number(nextRootId),
          currentRootCount: Number(nextRootId),
          isLive,
          isManaged
        })
      } catch (error) {
        // Error getting details for this proof set

        // Skip problematic proof sets if onlyManaged is true
        if (onlyManaged) {
          continue
        }

        // If we can't get details for a proof set, include it but mark as problematic
        enhancedProofSets.push({
          ...proofSet,
          pdpVerifierProofSetId: 0,
          nextRootId: 0,
          currentRootCount: 0,
          isLive: false,
          isManaged: false
        })
      }
    }

    return enhancedProofSets
  }

  /**
   * Get only the proof sets managed by this Pandora contract
   * @param clientAddress - The client's wallet address
   * @returns Array of proof set information filtered to only include managed proof sets
   */
  async getManagedProofSets (clientAddress: string): Promise<EnhancedProofSetInfo[]> {
    return await this.getClientProofSetsWithDetails(clientAddress, true)
  }

  /**
   * Get information needed to add roots to an existing proof set
   * @param railId - The Pandora rail ID to get information for
   * @returns Information needed for adding roots (next root ID, client dataset ID)
   */
  async getAddRootsInfo (railId: number): Promise<AddRootsInfo> {
    try {
      const pandoraContract = this._getPandoraContract()
      const pdpVerifier = await this._getPDPVerifierContract()

      // Get the actual PDPVerifier proof set ID from the rail ID
      const pdpVerifierProofSetId = await pandoraContract.railToProofSet(railId)

      // Check if proof set exists and is live
      const isLive = await pdpVerifier.proofSetLive(pdpVerifierProofSetId)
      if (isLive === false) {
        throw new Error(`Proof set with rail ID ${railId} (PDPVerifier ID ${String(pdpVerifierProofSetId)}) does not exist or is not live`)
      }

      // Get the next root ID (this is the count of roots currently in the proof set)
      const nextRootId = await pdpVerifier.getNextRootId(pdpVerifierProofSetId)

      // Verify this proof set is managed by our Pandora contract
      const listener = await pdpVerifier.getProofSetListener(pdpVerifierProofSetId)
      if (listener.toLowerCase() !== this._pandoraAddress.toLowerCase()) {
        throw new Error(`Proof set with rail ID ${railId} (PDPVerifier ID ${String(pdpVerifierProofSetId)}) is not managed by this Pandora contract (${this._pandoraAddress}), managed by ${String(listener)}`)
      }

      // Get client dataset ID from the proof set info stored in Pandora
      const proofSetInfo = await pandoraContract.proofSetInfo(railId)
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
   * Find recent proof set creations for a client by searching events
   * @param clientAddress - The client's wallet address
   * @param fromBlock - Block number to search from (default: recent blocks)
   * @returns Array of proof set creation information
   */
  async findRecentProofSetCreations (clientAddress: string, fromBlock?: number): Promise<ProofSetCreationInfo[]> {
    try {
      const pdpVerifier = await this._getPDPVerifierContract()
      const currentBlock = await this._provider.getBlockNumber()

      // Default to searching the last 10,000 blocks (roughly 5 hours on Filecoin)
      const searchFromBlock = fromBlock ?? Math.max(0, currentBlock - 10000)

      // Get ProofSetCreated events
      const filter = pdpVerifier.filters.ProofSetCreated()
      const events = await pdpVerifier.queryFilter(filter, searchFromBlock, currentBlock)

      const creations: ProofSetCreationInfo[] = []

      for (const event of events) {
        // Type guard to check if event has args property (EventLog vs Log)
        if ('args' in event && event.args != null) {
          const proofSetId = Number(event.args.setId)

          // Check if this proof set is managed by our Pandora contract
          try {
            const listener = await pdpVerifier.getProofSetListener(proofSetId)
            if (listener.toLowerCase() === this._pandoraAddress.toLowerCase()) {
              // Check if this client owns this proof set
              const clientProofSets = await this.getClientProofSets(clientAddress)
              const matchingProofSet = clientProofSets.find(ps => ps.railId === proofSetId)

              if (matchingProofSet != null) {
                creations.push({
                  proofSetId,
                  txHash: event.transactionHash,
                  blockNumber: event.blockNumber,
                  client: clientAddress
                })
              }
            }
          } catch (e) {
            // Skip proof sets we can't access
            continue
          }
        }
      }

      // Sort by block number (newest first)
      return creations.sort((a, b) => b.blockNumber - a.blockNumber)
    } catch (error) {
      throw new Error(`Failed to find recent proof set creations: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Verify that a proof set creation transaction was successful
   * This checks both the transaction status and on-chain proof set state
   * @param txHash - Transaction hash from proof set creation
   * @returns Verification result with transaction and proof set status
   */
  async verifyProofSetCreation (txHash: string): Promise<ProofSetCreationVerification> {
    try {
      // Get transaction receipt
      const receipt = await this._provider.getTransactionReceipt(txHash)

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
      const proofSetId = await this._extractProofSetIdFromReceipt(receipt)

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
      const pdpVerifier = await this._getPDPVerifierContract()
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
   * Wait for a proof set creation transaction to be mined and verified
   * This polls the chain until the transaction is confirmed and the proof set is live
   * @param txHash - Transaction hash from proof set creation
   * @param timeoutMs - Maximum time to wait in milliseconds (default: 5 minutes)
   * @param pollIntervalMs - How often to check in milliseconds (default: 2 seconds)
   * @returns Promise that resolves when proof set is confirmed or rejects on timeout/failure
   */
  async waitForProofSetCreation (
    txHash: string,
    timeoutMs: number = 300000,
    pollIntervalMs: number = 2000
  ): Promise<ProofSetCreationVerification> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeoutMs) {
      const verification = await this.verifyProofSetCreation(txHash)

      // If transaction failed, return immediately
      if (verification.transactionMined && !verification.transactionSuccess) {
        return verification
      }

      // If proof set is live, we're done
      if (verification.proofSetLive && verification.proofSetId != null) {
        return verification
      }

      // If there was an error (other than not mined yet), return it
      if (verification.error != null && verification.transactionMined) {
        return verification
      }

      // Wait before next poll
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    // Timeout reached
    throw new Error(`Timeout waiting for proof set creation after ${timeoutMs}ms`)
  }

  /**
   * Extract proof set ID from a transaction receipt by looking for ProofSetCreated events
   * @param receipt - Transaction receipt
   * @returns Proof set ID if found, null otherwise
   */
  private async _extractProofSetIdFromReceipt (receipt: ethers.TransactionReceipt): Promise<number | null> {
    try {
      const pdpVerifier = await this._getPDPVerifierContract()

      // Parse logs looking for ProofSetCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = pdpVerifier.interface.parseLog({
            topics: log.topics,
            data: log.data
          })

          if (parsedLog != null && parsedLog.name === 'ProofSetCreated') {
            return Number(parsedLog.args.setId)
          }
        } catch (e) {
          // Not a log from our contract, continue
          continue
        }
      }

      return null
    } catch (error) {
      throw new Error(`Failed to extract proof set ID from receipt: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Get the Pandora contract address this service is configured for
   */
  getPandoraAddress (): string {
    return this._pandoraAddress
  }
}
