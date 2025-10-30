import type { Account, Address, Chain, Client, Transport } from 'viem'
import { encodeAbiParameters } from 'viem'
import { signTypedData } from 'viem/actions'
import { getChain } from '../chains.ts'
import { EIP712Types, getStorageDomain, type MetadataEntry } from './type-definitions.ts'

export type signDataSetOptions = {
  clientDataSetId: bigint
  payee: Address
  /**
   * If client is from a session key this should be set to the actual payer address
   */
  payer?: Address
  metadata: MetadataEntry[]
}

/**
 * Sign and abi encode the create data set extra data
 *
 * @param client - The client to use to sign the message.
 * @param options - The options for the create data set extra data.
 */
export async function signCreateDataSet(client: Client<Transport, Chain, Account>, options: signDataSetOptions) {
  const chain = getChain(client.chain.id)
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'CreateDataSet',
    message: {
      clientDataSetId: options.clientDataSetId,
      payee: options.payee,
      metadata: options.metadata,
    },
  })

  const keys = options.metadata.map((item) => item.key)
  const values = options.metadata.map((item) => item.value)
  const payer = options.payer ?? client.account.address

  const extraData = encodeAbiParameters(
    [{ type: 'address' }, { type: 'uint256' }, { type: 'string[]' }, { type: 'string[]' }, { type: 'bytes' }],
    [payer, options.clientDataSetId, keys, values, signature]
  )

  return extraData
}
