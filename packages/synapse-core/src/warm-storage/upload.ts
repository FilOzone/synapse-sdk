import type { Account, Chain, Client, Transport } from 'viem'
import * as PDP from '../sp.ts'
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
    options.data.map(async (data) => {
      const upload = await PDP.uploadPiece({
        data: new Uint8Array(await data.arrayBuffer()),
        endpoint: dataSet.pdp.serviceURL,
      })

      await PDP.findPiece({
        pieceCid: upload.pieceCid,
        endpoint: dataSet.pdp.serviceURL,
      })

      return {
        pieceCid: upload.pieceCid,
        metadata: { name: data.name, type: data.type },
      }
    })
  )

  const nonce = randU256()

  const addPieces = await PDP.addPieces({
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
