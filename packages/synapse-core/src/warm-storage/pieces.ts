import { CID } from 'multiformats'
import pRetry from 'p-retry'
import { type Account, type Address, type Chain, type Client, type Hex, hexToBytes, type Transport } from 'viem'
import { getTransaction, readContract, waitForTransactionReceipt } from 'viem/actions'
import { getChain } from '../chains.ts'
import type { PieceCID } from '../piece.ts'
import * as PDP from '../sp.ts'
import { signSchedulePieceRemovals } from '../typed-data/sign-schedule-piece-removals.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import type { DataSet } from './data-sets.ts'

export type DeletePieceOptions = {
  pieceId: bigint
  dataSet: DataSet
}

/**
 * Delete a piece from a data set
 *
 * Call the Service Provider API to delete the piece.
 *
 * @param client - The client to use to delete the piece.
 * @param options - The options for the delete piece.
 * @param options.dataSetId - The ID of the data set.
 * @param options.clientDataSetId - The ID of the client data set.
 * @param options.pieceId - The ID of the piece.
 * @param options.endpoint - The endpoint of the PDP API.
 * @returns The transaction hash of the delete operation.
 */
export async function deletePiece(client: Client<Transport, Chain, Account>, options: DeletePieceOptions) {
  return PDP.deletePiece({
    endpoint: options.dataSet.pdp.serviceURL,
    dataSetId: options.dataSet.dataSetId,
    pieceId: options.pieceId,
    extraData: await signSchedulePieceRemovals(client, {
      clientDataSetId: options.dataSet.clientDataSetId,
      pieceIds: [options.pieceId],
    }),
  })
}

export type PollForDeletePieceStatusOptions = {
  txHash: Hex
}

/**
 * Poll for the delete piece status.
 *
 * Waits for the transaction to be mined and then polls for the transaction receipt.
 *
 * @param client - The client to use to poll for the delete piece status.
 * @param options - The options for the poll for the delete piece status.
 * @param options.txHash - The hash of the transaction to poll for.
 * @returns
 */
export async function pollForDeletePieceStatus(
  client: Client<Transport, Chain>,
  options: PollForDeletePieceStatusOptions
) {
  try {
    await pRetry(
      async () => {
        const transaction = await getTransaction(client, {
          hash: options.txHash,
        })
        if (transaction.blockNumber === null) {
          throw new Error('Transaction not found')
        }
        return transaction
      },
      {
        factor: 1,
        minTimeout: 4000,
        retries: Infinity,
        maxRetryTime: 180000,
      }
    )
  } catch {
    // no-op
  }
  const receipt = await waitForTransactionReceipt(client, {
    hash: options.txHash,
  })
  return receipt
}

export type GetPiecesOptions = {
  dataSet: DataSet
  address: Address
}

export type Piece = {
  cid: PieceCID
  id: bigint
  url: string
}

/**
 * Get the pieces for a data set
 *
 * Calls the PDP Verifier contract to get the pieces.
 *
 * @param client - The client to use to get the pieces.
 * @param options - The options for the get pieces.
 * @param options.dataSet - The data set to get the pieces from.
 * @param options.address - The address of the user.
 */
export async function getPieces(client: Client<Transport, Chain>, options: GetPiecesOptions) {
  const chain = getChain(client.chain.id)
  const address = options.address
  const [data, ids, hasMore] = await readContract(client, {
    address: chain.contracts.pdp.address,
    abi: chain.contracts.pdp.abi,
    functionName: 'getActivePieces',
    args: [options.dataSet.dataSetId, 0n, 100n],
  })

  const removals = await readContract(client, {
    address: chain.contracts.pdp.address,
    abi: chain.contracts.pdp.abi,
    functionName: 'getScheduledRemovals',
    args: [options.dataSet.dataSetId],
  })

  const removalsDeduped = Array.from(new Set(removals))

  return {
    pieces: data
      .map((piece, index) => {
        const cid = CID.decode(hexToBytes(piece.data)) as PieceCID
        return {
          cid,
          id: ids[index],
          url: createPieceUrl(cid.toString(), options.dataSet.cdn, address, chain.id, options.dataSet.pdp.serviceURL),
        }
      })
      .filter((piece) => !removalsDeduped.includes(piece.id)),
    hasMore,
  }
}
