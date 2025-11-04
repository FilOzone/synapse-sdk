import { type Account, type Chain, type Client, encodeAbiParameters, type Transport, toHex } from 'viem'
import { signTypedData } from 'viem/actions'
import { getChain } from '../chains.ts'
import type { PieceCID } from '../piece.ts'
import { EIP712Types, getStorageDomain, type MetadataEntry } from './type-definitions.ts'

export type SignAddPiecesOptions = {
  clientDataSetId: bigint
  nonce: bigint
  pieces: { pieceCid: PieceCID; metadata: MetadataEntry[] }[]
}

/**
 * Sign and abi encode the add pieces extra data
 *
 * @param client - The client to use to sign the extra data.
 * @param options - The options for the add pieces extra data.
 */
export async function signAddPieces(client: Client<Transport, Chain, Account>, options: SignAddPiecesOptions) {
  const chain = getChain(client.chain.id)
  const signature = await signTypedData(client, {
    account: client.account,
    domain: getStorageDomain({ chain }),
    types: EIP712Types,
    primaryType: 'AddPieces',
    message: {
      clientDataSetId: options.clientDataSetId,
      nonce: options.nonce,
      pieceData: options.pieces.map((piece) => {
        return {
          data: toHex(piece.pieceCid.bytes),
        }
      }),
      pieceMetadata: options.pieces.map((piece, index) => ({
        pieceIndex: BigInt(index),
        metadata: piece.metadata,
      })),
    },
  })

  const metadataKV = Array.from(options.pieces, (piece) => piece.metadata) as MetadataEntry[][]

  const keys = metadataKV.map((item) => item.map((item) => item.key))
  const values = metadataKV.map((item) => item.map((item) => item.value))

  const extraData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'string[][]' }, { type: 'string[][]' }, { type: 'bytes' }],
    [options.nonce, keys, values, signature]
  )
  return extraData
}
