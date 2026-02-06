import type { Account, Chain, Client, Transport } from 'viem'
import { signSchedulePieceRemovals } from '../typed-data/sign-schedule-piece-removals.ts'
import * as SP from './sp.ts'

export namespace schedulePieceDeletion {
  export type OptionsType = {
    /** The piece ID to delete. */
    pieceId: bigint
    /** The data set ID to delete the piece from. */
    dataSetId: bigint
    /** The client data set ID. */
    clientDataSetId: bigint
    /** The service URL of the PDP API. */
    serviceURL: string
  }
  export type OutputType = SP.deletePiece.OutputType
  export type ErrorType = SP.deletePiece.ErrorType
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
  return SP.deletePiece({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieceId: options.pieceId,
    extraData: await signSchedulePieceRemovals(client, {
      clientDataSetId: options.clientDataSetId,
      pieceIds: [options.pieceId],
    }),
  })
}
