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
 * const pdpVerifier = new PDPVerifier(provider)
 *
 * // Check if a proof set is live
 * const isLive = await pdpVerifier.proofSetLive(proofSetId)
 * console.log(`Proof set ${proofSetId} is ${isLive ? 'live' : 'not live'}`)
 * ```
 */

import { ethers } from 'ethers'
import { CONTRACT_ABIS, CONTRACT_ADDRESSES } from '../utils/index.js'

export class PDPVerifier {
  private readonly _provider: ethers.Provider
  private _contract: ethers.Contract | null = null
  private _chainId: number | null = null

  constructor (provider: ethers.Provider) {
    this._provider = provider
  }

  /**
   * Get the PDPVerifier contract instance
   */
  private async _getContract (): Promise<ethers.Contract> {
    if (this._contract == null) {
      // Detect network to get the correct PDPVerifier address
      const network = await this._provider.getNetwork()
      this._chainId = Number(network.chainId)

      let pdpVerifierAddress: string
      if (this._chainId === 314) {
        pdpVerifierAddress = CONTRACT_ADDRESSES.PDP_VERIFIER.mainnet
      } else if (this._chainId === 314159) {
        pdpVerifierAddress = CONTRACT_ADDRESSES.PDP_VERIFIER.calibration
      } else {
        throw new Error(`Unsupported network: ${this._chainId}. Only Filecoin mainnet (314) and calibration (314159) are supported.`)
      }

      this._contract = new ethers.Contract(
        pdpVerifierAddress,
        CONTRACT_ABIS.PDP_VERIFIER,
        this._provider
      )
    }
    return this._contract
  }

  /**
   * Check if a proof set is live
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns Whether the proof set exists and is live
   */
  async proofSetLive (proofSetId: number): Promise<boolean> {
    const contract = await this._getContract()
    return await contract.proofSetLive(proofSetId)
  }

  /**
   * Get the next root ID for a proof set
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The next root ID (which equals the current root count)
   */
  async getNextRootId (proofSetId: number): Promise<number> {
    const contract = await this._getContract()
    const nextRootId = await contract.getNextRootId(proofSetId)
    return Number(nextRootId)
  }

  /**
   * Get the proof set listener (record keeper)
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The address of the listener contract
   */
  async getProofSetListener (proofSetId: number): Promise<string> {
    const contract = await this._getContract()
    return await contract.getProofSetListener(proofSetId)
  }

  /**
   * Get the proof set owner addresses
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns Object with current owner and proposed owner
   */
  async getProofSetOwner (proofSetId: number): Promise<{ owner: string, proposedOwner: string }> {
    const contract = await this._getContract()
    const [owner, proposedOwner] = await contract.getProofSetOwner(proofSetId)
    return { owner, proposedOwner }
  }

  /**
   * Get the leaf count for a proof set
   * @param proofSetId - The PDPVerifier proof set ID
   * @returns The number of leaves in the proof set
   */
  async getProofSetLeafCount (proofSetId: number): Promise<number> {
    const contract = await this._getContract()
    const leafCount = await contract.getProofSetLeafCount(proofSetId)
    return Number(leafCount)
  }

  /**
   * Extract proof set ID from a transaction receipt by looking for ProofSetCreated events
   * @param receipt - Transaction receipt
   * @returns Proof set ID if found, null otherwise
   */
  async extractProofSetIdFromReceipt (receipt: ethers.TransactionReceipt): Promise<number | null> {
    try {
      const contract = await this._getContract()

      // Parse logs looking for ProofSetCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog({
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
  async getContractAddress (): Promise<string> {
    const contract = await this._getContract()
    return contract.target as string
  }
}
