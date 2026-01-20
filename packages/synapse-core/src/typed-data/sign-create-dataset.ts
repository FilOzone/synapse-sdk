import type {
  Account,
  Address,
  Chain,
  Client,
  EncodeAbiParametersErrorType,
  Hex,
  SignTypedDataErrorType,
  Transport,
} from 'viem'
import { encodeAbiParameters } from 'viem'
import { signTypedData } from 'viem/actions'
import { asChain } from '../chains.ts'
import { EIP712Types, getStorageDomain, type MetadataEntry } from './type-definitions.ts'

export type signCreateDataSetOptions = {
  /** The client data set id (nonce). */
  clientDataSetId: bigint
  /** The payee address. */
  payee: Address
  /** The payer address. If client is from a session key this should be set to the actual payer address. */
  payer?: Address
  /** The metadata for the data set. */
  metadata?: MetadataEntry[]
}

export const signCreateDataSetAbiParameters = [
  { type: 'address' },
  { type: 'uint256' },
  { type: 'string[]' },
  { type: 'string[]' },
  { type: 'bytes' },
] as const

/**
 * Sign and abi encode the create data set extra data
 *
 * @param client - The client to use to sign the message.
 * @param options - {@link signCreateDataSetOptions}
 * @throws { SignTypedDataErrorType | EncodeAbiParametersErrorType}
 */
export async function signCreateDataSet(client: Client<Transport, Chain, Account>, options: signCreateDataSetOptions) {
  const chain = asChain(client.chain)
  const metadata = options.metadata ?? []
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'CreateDataSet',
    message: {
      clientDataSetId: options.clientDataSetId,
      payee: options.payee,
      metadata,
    },
  })

  const keys = metadata.map((item) => item.key)
  const values = metadata.map((item) => item.value)
  const payer = options.payer ?? client.account.address

  const extraData = encodeAbiParameters(signCreateDataSetAbiParameters, [
    payer,
    options.clientDataSetId,
    keys,
    values,
    signature,
  ])

  return extraData
}

export namespace signCreateDataSet {
  /** The options for the create data set. */
  export type OptionsType = signCreateDataSetOptions
  /** The extra data for the create data set. */
  export type ReturnType = Hex
  /** The errors that can occur when signing the create data set. */
  export type ErrorType = SignTypedDataErrorType | EncodeAbiParametersErrorType | asChain.ErrorType
}
