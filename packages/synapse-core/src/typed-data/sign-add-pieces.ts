import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type EncodeAbiParametersErrorType,
  encodeAbiParameters,
  type Hex,
  type SignTypedDataErrorType,
  type Transport,
  toHex,
} from 'viem'
import { signTypedData } from 'viem/actions'
import { asChain } from '../chains.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { compactPieceMetadata } from '../utils/compact-piece-metadata.ts'
import { randU256 } from '../utils/rand.ts'
import { EIP712Types, getStorageDomain, type MetadataEntry } from './type-definitions.ts'

export type SignAddPiecesOptions = {
  /** The client data set id to use for the signature. */
  clientDataSetId: bigint
  /** The pieces to sign. */
  pieces: { pieceCid: PieceCID; metadata?: MetadataEntry[] }[]
  /** The nonce to use for the signature. */
  nonce?: bigint
  /** The verifying contract to use. If not provided, the default is the FilecoinWarmStorageService contract address. */
  verifyingContract?: Address
}

export const signAddPiecesAbiParameters = [
  { type: 'uint256' },
  { type: 'string[][]' },
  { type: 'string[][]' },
  { type: 'bytes' },
] as const

/**
 * Sign and abi encode the add pieces extra data
 *
 * @param client - The client to use to sign the extra data.
 * @param options - {@link SignAddPiecesOptions}
 * @returns Encoded extra data {@link signAddPieces.ReturnType}
 * @throws Errors {@link signAddPieces.ErrorType}
 */
export async function signAddPieces(
  client: Client<Transport, Chain, Account>,
  options: signAddPieces.OptionsType
): Promise<signAddPieces.ReturnType> {
  const chain = asChain(client.chain)
  const { clientDataSetId, nonce: _nonce, pieces, verifyingContract } = options
  const nonce = _nonce ?? randU256()
  const pieceMetadata = compactPieceMetadata(Array.from(pieces, (piece) => piece.metadata ?? []) as MetadataEntry[][])

  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain, verifyingContract }),
    types: EIP712Types,
    primaryType: 'AddPieces',
    message: {
      clientDataSetId,
      nonce,
      pieceData: pieces.map((piece) => {
        return {
          data: toHex(piece.pieceCid.bytes),
        }
      }),

      pieceMetadata: pieceMetadata.map((metadata, index) => ({
        pieceIndex: BigInt(index),
        metadata,
      })),
    },
  })

  const keys = pieceMetadata.map((item) => item.map((item) => item.key))
  const values = pieceMetadata.map((item) => item.map((item) => item.value))

  const extraData = encodeAbiParameters(signAddPiecesAbiParameters, [nonce, keys, values, signature])
  return extraData
}

export namespace signAddPieces {
  export type OptionsType = SignAddPiecesOptions
  /** The extra data for the add pieces. */
  export type ReturnType = Hex
  /** The errors that can occur when signing the add pieces. */
  export type ErrorType = SignTypedDataErrorType | EncodeAbiParametersErrorType | asChain.ErrorType
}
