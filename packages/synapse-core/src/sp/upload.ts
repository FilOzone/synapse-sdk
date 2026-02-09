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

export namespace upload {
  export type Events = {
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
  export type OptionsType = {
    /** The ID of the data set. */
    dataSetId: bigint
    /** The data to upload. */
    data: File[]
    /** The callback to call when an event occurs. */
    onEvent?: <T extends keyof upload.Events>(event: T, data: upload.Events[T]) => void
  }
  export type OutputType = {
    pieceCid: Piece.PieceCID
    url: string
    metadata: { name: string; type: string }
  }
  export type ErrorType =
    | DataSetNotFoundError
    | SP.uploadPiece.ErrorType
    | SP.findPiece.ErrorType
    | SP.addPieces.ErrorType
    | signAddPieces.ErrorType
}

/**
 * Upload multiplepieces to a data set on the PDP API.
 *
 * @param client - The client to use to upload the pieces.
 * @param options - {@link upload.OptionsType}
 * @returns Upload response {@link upload.OutputType}
 * @throws Errors {@link upload.ErrorType}
 */
export async function upload(client: Client<Transport, Chain, Account>, options: upload.OptionsType) {
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
