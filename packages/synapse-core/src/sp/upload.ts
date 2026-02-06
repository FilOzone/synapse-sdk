import type { Account, Chain, Client, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { DataSetNotFoundError } from '../errors/warm-storage.ts'
import * as Piece from '../piece.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import { getPdpDataSet } from '../warm-storage/get-pdp-data-set.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import * as SP from './sp.ts'
export interface Events {
  pieceUploaded: {
    pieceCid: Piece.PieceCID
    dataSet: PdpDataSet
  }
  pieceParked: {
    pieceCid: Piece.PieceCID
    url: string
    dataSet: PdpDataSet
  }
}

export type UploadOptions = {
  dataSetId: bigint
  data: File[]
  onEvent?<T extends keyof Events>(event: T, data: Events[T]): void
}

export async function upload(client: Client<Transport, Chain, Account>, options: UploadOptions) {
  const dataSet = await getPdpDataSet(client, {
    dataSetId: options.dataSetId,
  })
  if (!dataSet) {
    throw new DataSetNotFoundError(options.dataSetId)
  }
  const chain = asChain(client.chain)
  const serviceURL = dataSet.provider.pdp.serviceURL

  const uploadResponses = await Promise.all(
    options.data.map(async (file: File) => {
      const data = new Uint8Array(await file.arrayBuffer())
      const pieceCid = Piece.calculate(data)
      const url = createPieceUrl({
        cid: pieceCid.toString(),
        cdn: dataSet.cdn,
        address: client.account.address,
        chain: chain,
        serviceURL,
      })
      await SP.uploadPiece({
        data,
        pieceCid,
        serviceURL,
      })
      options.onEvent?.('pieceUploaded', { pieceCid, dataSet })

      await SP.findPiece({
        pieceCid,
        serviceURL,
        retry: true,
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
    serviceURL,
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
