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
 * // Check if a data set is live
 * const isLive = await pdpVerifier.dataSetLive(dataSetId)
 * console.log(`Data set ${dataSetId} is ${isLive ? 'live' : 'not live'}`)
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
   * Check if a data set is live
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Whether the data set exists and is live
   */
  async dataSetLive (dataSetId: number): Promise<boolean> {
    const contract = await this._getContract()
    return await contract.dataSetLive(dataSetId)
  }

  /**
   * Get the next piece ID for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The next piece ID (which equals the current piece count)
   */
  async getNextPieceId (dataSetId: number): Promise<number> {
    const contract = await this._getContract()
    const nextPieceId = await contract.getNextPieceId(dataSetId)
    return Number(nextPieceId)
  }

  /**
   * Get the data set listener (record keeper)
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The address of the listener contract
   */
  async getDataSetListener (dataSetId: number): Promise<string> {
    const contract = await this._getContract()
    return await contract.getDataSetListener(dataSetId)
  }

  /**
   * Get the data set owner addresses
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Object with current owner and proposed owner
   */
  async getDataSetOwner (dataSetId: number): Promise<{ owner: string, proposedOwner: string }> {
    const contract = await this._getContract()
    const [owner, proposedOwner] = await contract.getDataSetOwner(dataSetId)
    return { owner, proposedOwner }
  }

  /**
   * Get the leaf count for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The number of leaves in the data set
   */
  async getDataSetLeafCount (dataSetId: number): Promise<number> {
    const contract = await this._getContract()
    const leafCount = await contract.getDataSetLeafCount(dataSetId)
    return Number(leafCount)
  }

  /**
   * Extract data set ID from a transaction receipt by looking for DataSetCreated events
   * @param receipt - Transaction receipt
   * @returns Data set ID if found, null otherwise
   */
  async extractDataSetIdFromReceipt (receipt: ethers.TransactionReceipt): Promise<number | null> {
    try {
      const contract = await this._getContract()

      // Parse logs looking for DataSetCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = contract.interface.parseLog({
            topics: log.topics,
            data: log.data
          })

          if (parsedLog != null && parsedLog.name === 'DataSetCreated') {
            return Number(parsedLog.args.setId)
          }
        } catch (e) {
          // Not a log from our contract, continue
          continue
        }
      }

      return null
    } catch (error) {
      throw new Error(`Failed to extract data set ID from receipt: ${error instanceof Error ? error.message : String(error)}`)
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
