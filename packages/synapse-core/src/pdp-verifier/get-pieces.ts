import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ReadContractErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import { hexToPieceCID } from '../piece/piece.ts'
import { metadataArrayToObject } from '../utils/metadata.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import { getAllPieceMetadataCall } from '../warm-storage/get-all-piece-metadata.ts'
import type { PdpDataSet, Piece, PieceWithMetadata } from '../warm-storage/types.ts'
import { type getActivePieces, getActivePiecesCall } from './get-active-pieces.ts'
import { getScheduledRemovalsCall } from './get-scheduled-removals.ts'

export namespace getPieces {
  export type OptionsType = Simplify<
    Omit<getActivePieces.OptionsType, 'dataSetId'> & {
      /** The data set to get the pieces from. */
      dataSet: PdpDataSet
      /** The address of the user. */
      address: Address
    }
  >

  export type OutputType = {
    pieces: Piece[]
    hasMore: boolean
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get pieces for a data set with pagination
 *
 * @example
 * ```ts
 * import { getPieces } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [piecesData, pieceIds, hasMore] = await getPieces(client, {
 *   dataSetId: 1n,
 * })
 * ```
 *
 * @param client - The client to use to get the active pieces.
 * @param options - {@link getPieces.OptionsType}
 * @returns The active pieces for the data set {@link getPieces.OutputType}
 * @throws Errors {@link getPieces.ErrorType}
 */
export async function getPieces(
  client: Client<Transport, Chain>,
  options: getPieces.OptionsType
): Promise<getPieces.OutputType> {
  const chain = asChain(client.chain)

  const address = options.address
  const serviceURL = options.dataSet.provider.pdp.serviceURL
  const [activePiecesResult, removalsResult] = await multicall(client, {
    contracts: [
      getActivePiecesCall({
        chain: client.chain,
        dataSetId: options.dataSet.dataSetId,
        offset: options.offset,
        limit: options.limit,
        contractAddress: options.contractAddress,
      }),
      getScheduledRemovalsCall({
        chain: client.chain,
        dataSetId: options.dataSet.dataSetId,
        contractAddress: options.contractAddress,
      }),
    ],
    allowFailure: false,
  })

  // deduplicate the removals
  const removals = Array.from(new Set(removalsResult))

  return {
    hasMore: activePiecesResult[2],
    pieces: activePiecesResult[0]
      .map((piece, index) => {
        const cid = hexToPieceCID(piece.data)
        return {
          cid,
          id: activePiecesResult[1][index],
          url: createPieceUrl({
            cid: cid.toString(),
            cdn: options.dataSet.cdn,
            address,
            chain,
            serviceURL,
          }),
        }
      })
      .filter((piece) => !removals.includes(piece.id)),
  }
}

export namespace getPiecesWithMetadata {
  export type OptionsType = Simplify<
    Omit<getActivePieces.OptionsType, 'dataSetId'> & {
      /** The data set to get the pieces from. */
      dataSet: PdpDataSet
      /** The address of the user. */
      address: Address
    }
  >

  export type OutputType = {
    pieces: PieceWithMetadata[]
    hasMore: boolean
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get pieces with metadata for a data set with pagination
 *
 * @example
 * ```ts
 * import { getPiecesWithMetadata } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [piecesData, pieceIds, hasMore] = await getPiecesWithMetadata(client, {
 *   dataSetId: 1n,
 * })
 * ```
 *
 * @param client - The client to use to get the active pieces.
 * @param options - {@link getPiecesWithMetadata.OptionsType}
 * @returns The active pieces for the data set {@link getPiecesWithMetadata.OutputType}
 * @throws Errors {@link getPiecesWithMetadata.ErrorType}
 */
export async function getPiecesWithMetadata(
  client: Client<Transport, Chain>,
  options: getPiecesWithMetadata.OptionsType
): Promise<getPiecesWithMetadata.OutputType> {
  const pieces = await getPieces(client, options)
  const metadata = await multicall(client, {
    allowFailure: false,
    contracts: pieces.pieces.map((piece) =>
      getAllPieceMetadataCall({
        chain: client.chain,
        dataSetId: options.dataSet.dataSetId,
        pieceId: piece.id,
        contractAddress: options.contractAddress,
      })
    ),
  })
  return {
    pieces: pieces.pieces.map((piece, index) => ({
      ...piece,
      metadata: metadataArrayToObject(metadata[index]),
    })),
    hasMore: pieces.hasMore,
  }
}
