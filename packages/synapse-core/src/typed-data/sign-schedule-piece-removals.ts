import { type Account, type Chain, type Client, encodeAbiParameters, type Transport } from 'viem'
import { signTypedData } from 'viem/actions'
import { getChain } from '../chains.ts'
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
export async function signSchedulePieceRemovals(
  client: Client<Transport, Chain, Account>,
  options: SignSchedulePieceRemovalsOptions
) {
  const chain = getChain(client.chain.id)
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
