import type { Account, Chain, Client, Transport } from 'viem'
import * as Piece from '../piece.ts'
import * as SP from '../sp.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'
import { getDataSet } from './data-sets.ts'

export type UploadOptions = {
  dataSetId: bigint
  data: File[]
}

export async function upload(client: Client<Transport, Chain, Account>, options: UploadOptions) {
  const dataSet = await getDataSet(client, {
    dataSetId: options.dataSetId,
  })

  const uploadResponses = await Promise.all(
    options.data.map(async (file: File) => {
      const data = new Uint8Array(await file.arrayBuffer())
      const pieceCid = Piece.calculate(data)
      await SP.uploadPiece({
        data,
        pieceCid,
        endpoint: dataSet.pdp.serviceURL,
      })

      await SP.findPiece({
        pieceCid,
        endpoint: dataSet.pdp.serviceURL,
      })

      return {
        pieceCid,
        metadata: { name: file.name, type: file.type },
      }
    })
  )

  const nonce = randU256()

  const addPieces = await SP.addPieces({
    dataSetId: options.dataSetId,
    pieces: uploadResponses.map((response) => response.pieceCid),
    endpoint: dataSet.pdp.serviceURL,
    extraData: await signAddPieces(client, {
      clientDataSetId: dataSet.clientDataSetId,
      nonce,
      pieces: uploadResponses.map((response) => ({
        pieceCid: response.pieceCid,
        metadata: pieceMetadataObjectToEntry(response.metadata),
      })),
    }),
  })

  return addPieces
}
