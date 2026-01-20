import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type EncodeAbiParametersErrorType,
  encodeAbiParameters,
  type Hex,
  type Transport,
} from 'viem'
import type { PieceCID } from '../piece.ts'
import { signAddPieces } from './sign-add-pieces.ts'
import { signCreateDataSet } from './sign-create-dataset.ts'
import type { MetadataEntry } from './type-definitions.ts'

export const signcreateDataSetAndAddPiecesAbiParameters = [{ type: 'bytes' }, { type: 'bytes' }] as const

/**
 * Sign and abi encode the create data set and add pieces extra data
 *
 * @param client - The client to use to sign the extra data.
 * @param options - {@link signCreateDataSetAndAddPieces.OptionsType}
 * @returns Encoded extra data {@link signCreateDataSetAndAddPieces.ReturnType}
 * @throws Errors {@link signCreateDataSetAndAddPieces.ErrorType}
 */
export async function signCreateDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: signCreateDataSetAndAddPieces.OptionsType
): Promise<signCreateDataSetAndAddPieces.ReturnType> {
  const dataSetExtraData = await signCreateDataSet(client, options)
  const addPiecesExtraData = await signAddPieces(client, options)
  return encodeAbiParameters(signcreateDataSetAndAddPiecesAbiParameters, [dataSetExtraData, addPiecesExtraData])
}

export namespace signCreateDataSetAndAddPieces {
  export type OptionsType = {
    /** The client data set id to use for the signature. */
    clientDataSetId: bigint
    /** The payee address to use for the signature. */
    payee: Address
    /** The payer address to use for the signature. If client is from a session key this should be set to the actual payer address. */
    payer?: Address
    /** Dataset metadata. */
    metadata?: MetadataEntry[]
    /** The pieces with metadata to sign. */
    pieces: { pieceCid: PieceCID; metadata?: MetadataEntry[] }[]
    /** The nonce to use for the add pieces signature. */
    nonce?: bigint
    /** The verifying contract to use. If not provided, the default is the FilecoinWarmStorageService contract address. */
    verifyingContract?: Address
  }
  export type ReturnType = Hex
  export type ErrorType = signCreateDataSet.ErrorType | signAddPieces.ErrorType | EncodeAbiParametersErrorType
}
