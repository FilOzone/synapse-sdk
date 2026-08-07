import { type Chain, encodeAbiParameters } from 'viem'
import { signTypedData } from 'viem/actions'
import { asChain } from '../chains.ts'
import type { AccountClient } from '../types.ts'
import { EIP712Types, getStorageDomain } from './type-definitions.ts'

export type SignTerminateServiceOptions = {
  dataSetId: bigint
}

/**
 * Sign the terminate service message and abi encode the signature.
 *
 * @param client - The client to use to sign the message.
 * @param options - The options for the terminate service message.
 */
export async function signTerminateService<chain extends Chain>(
  client: AccountClient<chain>,
  options: SignTerminateServiceOptions
) {
  const chain = asChain(client.chain)
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'TerminateService',
    message: {
      dataSetId: options.dataSetId,
    },
  })
  const extraData = encodeAbiParameters([{ type: 'bytes' }], [signature])
  return extraData
}
