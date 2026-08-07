import { type Chain, encodeAbiParameters } from 'viem'
import { signTypedData } from 'viem/actions'
import { asChain } from '../chains.ts'
import type { AccountClient } from '../types.ts'
import { EIP712Types, getStorageDomain } from './type-definitions.ts'

export type SignSchedulePieceRemovalsOptions = {
  clientDataSetId: bigint
  pieceIds: bigint[]
}

/**
 * Sign the schedule piece removals and abi encode the signature
 *
 * @param client - The client to use to sign the message.
 * @param options - The options for the schedule piece removals message.
 */
export async function signSchedulePieceRemovals<chain extends Chain>(
  client: AccountClient<chain>,
  options: SignSchedulePieceRemovalsOptions
) {
  const chain = asChain(client.chain)
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'SchedulePieceRemovals',
    message: {
      clientDataSetId: options.clientDataSetId,
      pieceIds: options.pieceIds,
    },
  })
  const extraData = encodeAbiParameters([{ type: 'bytes' }], [signature])
  return extraData
}
