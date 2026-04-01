import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { Account, Chain, Client, Hex, Transport } from 'viem'
import { DeletePieceError } from '../errors/pdp.ts'
import { signSchedulePieceRemovals } from '../typed-data/sign-schedule-piece-removals.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'

export namespace deletePiece {
  export type OptionsType = {
    serviceURL: string
    dataSetId: bigint
    pieceId: bigint
    extraData: Hex
  }
  export type OutputType = {
    hash: Hex
  }
  export type ErrorType = DeletePieceError | TimeoutError | NetworkError | AbortError
}

/**
 * Delete a piece from a data set on the PDP API.
 *
 * DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}
 *
 * @param options - {@link deletePiece.OptionsType}
 * @returns Hash of the delete operation {@link deletePiece.OutputType}
 * @throws Errors {@link deletePiece.ErrorType}
 */
export async function deletePiece(options: deletePiece.OptionsType): Promise<deletePiece.OutputType> {
  const { serviceURL, dataSetId, pieceId, extraData } = options
  const response = await request.json.delete<{ txHash: Hex }>(
    new URL(`pdp/data-sets/${dataSetId}/pieces/${pieceId}`, serviceURL),
    {
      body: { extraData },
      timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
    }
  )

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DeletePieceError(await response.error.response.text())
    }
    throw response.error
  }

  return { hash: response.result.txHash }
}

export namespace schedulePieceDeletion {
  export type OptionsType = {
    /** The piece ID to delete. */
    pieceId: bigint
    /** The data set ID to delete the piece from. */
    dataSetId: bigint
    /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
    clientDataSetId: bigint
    /** The service URL of the PDP API. */
    serviceURL: string
  }
  export type OutputType = deletePiece.OutputType
  export type ErrorType = deletePiece.ErrorType
}

/**
 * Schedule a piece deletion
 *
 * Call the Service Provider API to schedule the piece deletion.
 *
 * @param client - The client to use to schedule the piece deletion.
 * @param options - {@link schedulePieceDeletion.OptionsType}
 * @returns schedule piece deletion operation hash {@link schedulePieceDeletion.OutputType}
 * @throws Errors {@link schedulePieceDeletion.ErrorType}
 *
 * @example
 * ```ts
 * import { schedulePieceDeletion } from '@filoz/synapse-core/sp'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await schedulePieceDeletion(client, {
 *   pieceId: 1n,
 *   dataSetId: 1n,
 *   clientDataSetId: 1n,
 *   serviceURL: 'https://pdp.example.com',
 * })
 *
 * console.log(result.hash)
 * ```
 */
export async function schedulePieceDeletion(
  client: Client<Transport, Chain, Account>,
  options: schedulePieceDeletion.OptionsType
): Promise<schedulePieceDeletion.OutputType> {
  return deletePiece({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieceId: options.pieceId,
    extraData: await signSchedulePieceRemovals(client, {
      clientDataSetId: options.clientDataSetId,
      pieceIds: [options.pieceId],
    }),
  })
}
