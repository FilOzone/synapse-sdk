import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { Account, Chain, Client, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { InvalidUploadSizeError, LocationHeaderError, PostPieceError, UploadPieceError } from '../errors/pdp.ts'
import { DataSetNotFoundError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece.ts'
import * as Piece from '../piece/piece.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from '../utils/constants.ts'
import { createPieceUrl } from '../utils/piece-url.ts'
import { getPdpDataSet } from '../warm-storage/get-pdp-data-set.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { addPieces, findPiece } from './index.ts'

export namespace uploadPiece {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The data to upload. */
    data: Uint8Array
    /** The piece CID to upload. */
    pieceCid: PieceCID
  }
  export type ErrorType = InvalidUploadSizeError | LocationHeaderError | TimeoutError | NetworkError | AbortError
}

/**
 * Upload a piece to the PDP API.
 *
 * POST /pdp/piece
 *
 * @param options - {@link uploadPiece.OptionsType}
 * @throws Errors {@link uploadPiece.ErrorType}
 */
export async function uploadPiece(options: uploadPiece.OptionsType): Promise<void> {
  const size = options.data.length
  if (size < SIZE_CONSTANTS.MIN_UPLOAD_SIZE || size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
    throw new InvalidUploadSizeError(size)
  }

  const pieceCid = options.pieceCid
  if (!Piece.isPieceCID(pieceCid)) {
    throw new Error(`Invalid PieceCID: ${String(options.pieceCid)}`)
  }
  const response = await request.post(new URL(`pdp/piece`, options.serviceURL), {
    body: JSON.stringify({
      pieceCid: pieceCid.toString(),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PostPieceError(await response.error.response.text())
    }
    throw response.error
  }
  if (response.result.status === 200) {
    // Piece already exists on server
    return
  }

  // Extract upload ID from Location header
  const location = response.result.headers.get('Location')
  const uploadUuid = location?.split('/').pop()
  if (!location || !uploadUuid) {
    throw new LocationHeaderError(location)
  }

  const uploadResponse = await request.put(new URL(`pdp/piece/upload/${uploadUuid}`, options.serviceURL), {
    body: options.data as BufferSource,
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': options.data.length.toString(),
    },
    timeout: false,
  })

  if (uploadResponse.error) {
    if (HttpError.is(uploadResponse.error)) {
      throw new UploadPieceError(await uploadResponse.error.response.text())
    }
    throw uploadResponse.error
  }
}

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
  export type ErrorType = DataSetNotFoundError | uploadPiece.ErrorType | findPiece.ErrorType | addPieces.ErrorType
}

/**
 * Upload multiple pieces to a data set on the PDP API.
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
      await uploadPiece({
        data,
        pieceCid,
        serviceURL,
      })
      options.onEvent?.('pieceUploaded', { pieceCid, dataSet })

      await findPiece({
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

  const addPiecesResponse = await addPieces(client, {
    serviceURL,
    dataSetId: options.dataSetId,
    pieces: uploadResponses.map((response) => ({
      pieceCid: response.pieceCid,
      metadata: response.metadata,
    })),
    clientDataSetId: dataSet.clientDataSetId,
  })

  return { ...addPiecesResponse, pieces: uploadResponses }
}
