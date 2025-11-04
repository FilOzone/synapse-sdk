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
import { hexToPieceCID } from '../piece/piece.ts'
import type { PieceCID } from '../types.ts'
import { CONTRACT_ABIS, createError } from '../utils/index.ts'

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
   * Get active pieces for a data set with pagination
   * @param dataSetId - The PDPVerifier data set ID
   * @param options - Optional configuration object
   * @param options.offset - The offset to start from (default: 0)
   * @param options.limit - The maximum number of pieces to return (default: 100)
   * @param options.signal - Optional AbortSignal to cancel the operation
   * @returns Object containing pieces, piece IDs, raw sizes, and hasMore flag
   */
  async getActivePieces(
    dataSetId: number,
    options?: {
      offset?: number
      limit?: number
      signal?: AbortSignal
    }
  ): Promise<{
    pieces: Array<{ pieceCid: PieceCID; pieceId: number }>
    hasMore: boolean
  }> {
    const offset = options?.offset ?? 0
    const limit = options?.limit ?? 100
    const signal = options?.signal

    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    const result = await this._contract.getActivePieces(dataSetId, offset, limit)

    return {
      pieces: result[0].map((piece: { data: string }, index: number) => {
        try {
          return {
            pieceCid: hexToPieceCID(piece.data),
            pieceId: Number(result[1][index]),
          }
        } catch (error) {
          throw createError(
            'PDPVerifier',
            'getActivePieces',
            `Failed to convert piece data to PieceCID: ${error instanceof Error ? error.message : String(error)}`,
            error
          )
        }
      }),
      hasMore: Boolean(result[2]),
    }
  }

  /**
   * Get the PDPVerifier contract address for the current network
   */
  getContractAddress(): string {
    return this._contract.target as string
  }
}
