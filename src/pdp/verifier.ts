/**
 * PDPVerifier - Direct interaction with the PDPVerifier contract
 *
 * This is a low-level utility for interacting with the PDPVerifier contract.
 * It provides protocol-level operations without business logic.
 *
 * @example
 * ```typescript
 * import { PDPVerifier } from '@filoz/synapse-sdk/pdp'
 * import { ethers } from 'ethers'
 *
 * const provider = new ethers.JsonRpcProvider(rpcUrl)
 * const pdpVerifier = new PDPVerifier(provider, contractAddress)
 *
 * // Check if a proof set is live
 * const isLive = await pdpVerifier.proofSetLive(proofSetId)
 * console.log(`Proof set ${proofSetId} is ${isLive ? 'live' : 'not live'}`)
 * ```
 */

import { ethers } from 'ethers'
import { CONTRACT_ABIS } from '../utils/index.js'

export class PDPVerifier {
  private readonly _provider: ethers.Provider
  private readonly _contractAddress: string
  private readonly _contract: ethers.Contract

  constructor (provider: ethers.Provider, contractAddress: string) {
    this._provider = provider
    this._contractAddress = contractAddress
    this._contract = new ethers.Contract(
      this._contractAddress,
      CONTRACT_ABIS.PDP_VERIFIER,
      this._provider
    )
  }

  /**
   * Check if a proof set is live
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns Whether the proof set exists and is live
   */
  async proofSetLive (proofSetId: number): Promise<boolean> {
    return await this._contract.proofSetLive(proofSetId)
  }

  /**
   * Get the next root ID for a proof set
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The next root ID (which equals the current root count)
   */
  async getNextRootId (proofSetId: number): Promise<number> {
    const nextRootId = await this._contract.getNextRootId(proofSetId)
    return Number(nextRootId)
  }

  /**
   * Get the proof set listener (record keeper)
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The address of the listener contract
   */
  async getProofSetListener (proofSetId: number): Promise<string> {
    return await this._contract.getProofSetListener(proofSetId)
  }

  /**
   * Get the proof set owner addresses
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns Object with current owner and proposed owner
   */
  async getProofSetOwner (proofSetId: number): Promise<{ owner: string, proposedOwner: string }> {
    const [owner, proposedOwner] = await this._contract.getProofSetOwner(proofSetId)
    return { owner, proposedOwner }
  }

  /**
   * Get the leaf count for a proof set
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The number of leaves in the proof set
   */
  async getProofSetLeafCount (proofSetId: number): Promise<number> {
    const leafCount = await this._contract.getProofSetLeafCount(proofSetId)
    return Number(leafCount)
  }

  /**
   * Extract proof set ID from a transaction receipt by looking for ProofSetCreated events
   * @param receipt - Transaction receipt
   * @returns Proof set ID if found, null otherwise
   */
  extractProofSetIdFromReceipt (receipt: ethers.TransactionReceipt): number | null {
    try {
      // Parse logs looking for ProofSetCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = this._contract.interface.parseLog({
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
   * Get the PDPVerifier contract address for the current network
   */
  getContractAddress (): string {
    return this._contract.target as string
  }
}
