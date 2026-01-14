import type { Account, Chain, Client, Transport } from 'viem'
import * as Piece from '../piece.ts'
import * as SP from '../sp.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import { type DataSet, getDataSet } from './data-sets.ts'

interface Events {
  pieceUploaded: {
    pieceCid: Piece.PieceCID
    dataSet: DataSet
  }
  pieceParked: {
    pieceCid: Piece.PieceCID
    url: string
    dataSet: DataSet
  }
}

export type UploadOptions = {
  dataSetId: bigint
  data: File[]
  onEvent?<T extends keyof Events>(event: T, data: Events[T]): void
}

export async function upload(client: Client<Transport, Chain, Account>, options: UploadOptions) {
  const dataSet = await getDataSet(client, {
    dataSetId: options.dataSetId,
  })

  const uploadResponses = await Promise.all(
    options.data.map(async (file: File) => {
      const data = new Uint8Array(await file.arrayBuffer())
      const pieceCid = Piece.calculate(data)
      const url = createPieceUrl(
        pieceCid.toString(),
        dataSet.cdn,
        client.account.address,
        client.chain.id,
        dataSet.pdp.serviceURL
      )

      await SP.uploadPiece({
        data,
        pieceCid,
        endpoint: dataSet.pdp.serviceURL,
      })
      options.onEvent?.('pieceUploaded', { pieceCid, dataSet })

      await SP.findPiece({
        pieceCid,
        endpoint: dataSet.pdp.serviceURL,
      })

      options.onEvent?.('pieceParked', { pieceCid, url, dataSet })

      return {
        pieceCid,
        url,
        metadata: { name: file.name, type: file.type },
      }
    })
  )

  const addPieces = await SP.addPieces({
    dataSetId: options.dataSetId,
    pieces: uploadResponses.map((response) => response.pieceCid),
    endpoint: dataSet.pdp.serviceURL,
    extraData: await signAddPieces(client, {
      clientDataSetId: dataSet.clientDataSetId,
      pieces: uploadResponses.map((response) => ({
        pieceCid: response.pieceCid,
        metadata: pieceMetadataObjectToEntry(response.metadata),
      })),
    }),
  })

  return { ...addPieces, pieces: uploadResponses }
}
