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

import { asChain } from '@filoz/synapse-core/chains'
import * as Verifier from '@filoz/synapse-core/pdp-verifier'
import { hexToPieceCID } from '@filoz/synapse-core/piece'
import type { Address, Chain, Client, Transport } from 'viem'
import type { PieceCID } from '../types.ts'
import { createError } from '../utils/index.ts'

export namespace PDPVerifier {
  export type OptionsType = {
    /** The client to use to interact with the PDPVerifier contract. */
    client: Client<Transport, Chain>
    /** The address of the PDPVerifier contract. If not provided, the default is the PDPVerifier contract address for the chain. */
    address?: Address
  }
}

export class PDPVerifier {
  private readonly _client: Client<Transport, Chain>
  private readonly _address: Address

  /**
   * Create a new PDPVerifier instance
   * @param options - {@link PDPVerifier.OptionsType}
   */
  constructor(options: PDPVerifier.OptionsType) {
    this._client = options.client
    this._address = options.address ?? asChain(options.client.chain).contracts.pdp.address
  }

  /**
   * Check if a data set is live
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Whether the data set exists and is live
   */
  async dataSetLive(dataSetId: bigint): Promise<boolean> {
    return await Verifier.dataSetLive(this._client, { dataSetId, contractAddress: this._address })
  }

  /**
   * Get the next piece ID for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The next piece ID to assign (total pieces ever added; does not decrease when pieces are removed)
   */
  async getNextPieceId(dataSetId: bigint): Promise<bigint> {
    return await Verifier.getNextPieceId(this._client, { dataSetId, contractAddress: this._address })
  }

  /**
   * Get the count of active pieces (non-zero leaf count) for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The number of active pieces in the data set
   */
  async getActivePieceCount(dataSetId: bigint): Promise<bigint> {
    return await Verifier.getActivePieceCount(this._client, { dataSetId, contractAddress: this._address })
  }

  /**
   * Get the data set listener (record keeper)
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The address of the listener contract
   */
  async getDataSetListener(dataSetId: bigint): Promise<Address> {
    return await Verifier.getDataSetListener(this._client, { dataSetId, contractAddress: this._address })
  }

  /**
   * Get the data set storage provider addresses
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Object with current storage provider and proposed storage provider
   */
  async getDataSetStorageProvider(
    dataSetId: bigint
  ): Promise<{ storageProvider: Address; proposedStorageProvider: Address }> {
    const [storageProvider, proposedStorageProvider] = await Verifier.getDataSetStorageProvider(this._client, {
      dataSetId,
      contractAddress: this._address,
    })
    return { storageProvider, proposedStorageProvider }
  }

  /**
   * Get the leaf count for a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns The number of leaves in the data set
   */
  async getDataSetLeafCount(dataSetId: bigint): Promise<bigint> {
    return await Verifier.getDataSetLeafCount(this._client, { dataSetId, contractAddress: this._address })
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
    dataSetId: bigint,
    options?: {
      offset?: bigint
      limit?: bigint
      signal?: AbortSignal
    }
  ): Promise<{
    pieces: Array<{ pieceCid: PieceCID; pieceId: bigint }>
    hasMore: boolean
  }> {
    const signal = options?.signal

    if (signal?.aborted) {
      throw new Error('Operation aborted')
    }

    const result = await Verifier.getActivePieces(this._client, {
      dataSetId,
      offset: options?.offset,
      limit: options?.limit,
      contractAddress: this._address,
    })

    return {
      pieces: result[0].map((piece, index) => {
        try {
          return {
            pieceCid: hexToPieceCID(piece.data),
            pieceId: result[1][index],
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
      hasMore: result[2],
    }
  }

  /**
   * Get pieces scheduled for removal from a data set
   * @param dataSetId - The PDPVerifier data set ID
   * @returns Array of piece IDs scheduled for removal
   */
  async getScheduledRemovals(dataSetId: bigint): Promise<Verifier.getScheduledRemovals.OutputType> {
    const result = await Verifier.getScheduledRemovals(this._client, { dataSetId, contractAddress: this._address })
    return result
  }

  /**
   * Get the PDPVerifier contract address for the current network
   */
  getContractAddress(): Address {
    return this._address
  }
}
