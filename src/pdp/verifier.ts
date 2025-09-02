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
 * // Check if a data set is live
 * const isLive = await pdpVerifier.dataSetLive(dataSetId)
 * console.log(`Data set ${dataSetId} is ${isLive ? 'live' : 'not live'}`)
 * ```
 */

import { ethers } from 'ethers'
import { CONTRACT_ABIS } from '../utils/index.ts'

export class PDPVerifier {
  private readonly _provider: ethers.Provider
  private readonly _contractAddress: string
  private readonly _contract: ethers.Contract

  constructor(provider: ethers.Provider, contractAddress: string) {
    this._provider = provider
    this._contractAddress = contractAddress
    this._contract = new ethers.Contract(this._contractAddress, CONTRACT_ABIS.PDP_VERIFIER, this._provider)
  }

  /**
   * Check if a data set is live
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Whether the data set exists and is live
   */
  async dataSetLive(dataSetId: number): Promise<boolean> {
    return await this._contract.dataSetLive(dataSetId)
  }

  /**
   * Get the next piece ID for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The next piece ID (which equals the current piece count)
   */
  async getNextPieceId(dataSetId: number): Promise<number> {
    const nextPieceId = await this._contract.getNextPieceId(dataSetId)
    return Number(nextPieceId)
  }

  /**
   * Get the data set listener (record keeper)
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The address of the listener contract
   */
  async getDataSetListener(dataSetId: number): Promise<string> {
    return await this._contract.getDataSetListener(dataSetId)
  }

  /**
   * Get the data set storage provider addresses
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Object with current storage provider and proposed storage provider
   */
  async getDataSetStorageProvider(
    dataSetId: number
  ): Promise<{ storageProvider: string; proposedStorageProvider: string }> {
    const [storageProvider, proposedStorageProvider] = await this._contract.getDataSetStorageProvider(dataSetId)
    return { storageProvider, proposedStorageProvider }
  }

  /**
   * Get the leaf count for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The number of leaves in the data set
   */
  async getDataSetLeafCount(dataSetId: number): Promise<number> {
    const leafCount = await this._contract.getDataSetLeafCount(dataSetId)
    return Number(leafCount)
  }

  /**
   * Extract data set ID from a transaction receipt by looking for DataSetCreated events
   * @param receipt - Transaction receipt
   * @returns Data set ID if found, null otherwise
   */
  extractDataSetIdFromReceipt(receipt: ethers.TransactionReceipt): number | null {
    try {
      // Parse logs looking for DataSetCreated event
      for (const log of receipt.logs) {
        try {
          const parsedLog = this._contract.interface.parseLog({
            topics: log.topics,
            data: log.data,
          })

          if (parsedLog != null && parsedLog.name === 'DataSetCreated') {
            return Number(parsedLog.args.setId)
          }
        } catch {
          // ignore error
        }
      }

      return null
    } catch (error) {
      throw new Error(
        `Failed to extract data set ID from receipt: ${error instanceof Error ? error.message : String(error)}`
      )
    }
  }

  /**
   * Get the PDPVerifier contract address for the current network
   */
  getContractAddress(): string {
    return this._contract.target as string
  }
}
