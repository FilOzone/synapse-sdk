import { type Account, type Chain, type Client, encodeAbiParameters, type Transport } from 'viem'
import { signTypedData } from 'viem/actions'
import { asChain } from '../chains.ts'
import { EIP712Types, getStorageDomain } from './type-definitions.ts'

export type SignDeleteDataSetOptions = {
  dataSetId: bigint
}

/**
 * Sign the delete data set message and abi encode the signature.
 *
 * @param client - The client to use to sign the message.
 * @param options - The options for the delete data set message.
 */
export async function signDeleteDataSet(client: Client<Transport, Chain, Account>, options: SignDeleteDataSetOptions) {
  const chain = asChain(client.chain)
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'DeleteDataSet',
    message: {
      dataSetId: options.dataSetId,
    },
  })
  const extraData = encodeAbiParameters([{ type: 'bytes' }], [signature])
  return extraData
}
