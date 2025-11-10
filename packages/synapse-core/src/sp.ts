/**
 * Synapse Core - Service Provider HTTP Operations
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * ```
 *
 * @packageDocumentation
 */

import { HttpError, request, TimeoutError } from 'iso-web/http'
import type { Simplify } from 'type-fest'
import { type Address, type Hex, isHex } from 'viem'
import {
  AddPiecesError,
  CreateDataSetError,
  DeletePieceError,
  FindPieceError,
  GetDataSetError,
  InvalidUploadSizeError,
  LocationHeaderError,
  PollDataSetCreationStatusError,
  PollForAddPiecesStatusError,
  PostPieceError,
  UploadPieceError,
} from './errors/pdp.ts'
import type { PieceCID } from './piece.ts'
import * as Piece from './piece.ts'
import { SIZE_CONSTANTS } from './utils/constants.ts'
import { createPieceUrl } from './utils/piece-url.ts'

let TIMEOUT = 1000 * 60 * 5 // 5 minutes
export const RETRIES = Infinity
export const FACTOR = 1
export const MIN_TIMEOUT = 4000 // interval between retries in milliseconds

// Just for testing purposes
export function setTimeout(timeout: number) {
  TIMEOUT = timeout
}

/**
 * The options for the create data set on PDP API.
 *
 * @param endpoint - The endpoint of the PDP API.
 * @param recordKeeper - The address of the record keeper.
 * @param extraData - The extra data for the create data set.
 */
export type PDPCreateDataSetOptions = {
  endpoint: string
  recordKeeper: Address
  extraData: Hex
}

/**
 * Create a data set on PDP API
 *
 * POST /pdp/data-sets
 *
 * @param options - The options for the create data set on PDP API.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.recordKeeper - The address of the record keeper.
 * @param options.extraData - The extra data for the create data set.
 * @returns The response from the create data set on PDP API.
 */
export async function createDataSet(options: PDPCreateDataSetOptions) {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets`, options.endpoint), {
    body: JSON.stringify({
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new CreateDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  const location = response.result.headers.get('Location')
  const hash = location?.split('/').pop()
  if (!location || !hash || !isHex(hash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: hash,
    statusUrl: new URL(location, options.endpoint).toString(),
  }
}

export type PollForDataSetCreationStatusOptions = {
  statusUrl: string
}

export type DataSetCreatedResponse =
  | {
      createMessageHash: Hex
      dataSetCreated: false
      service: string
      txStatus: 'pending' | 'confirmed' | 'rejected'
      ok: boolean
    }
  | DataSetCreateSuccess

export type DataSetCreateSuccess = {
  createMessageHash: Hex
  dataSetCreated: true
  service: string
  txStatus: 'confirmed'
  ok: true
  dataSetId: number
}

/**
 * Poll for the data set creation status.
 *
 * GET /pdp/data-sets/created({txHash})
 *
 * @param options - The options for the poll for data set creation status.
 * @param options.statusUrl - The status URL of the data set creation.
 * @returns The data set creation status.
 */
export async function pollForDataSetCreationStatus(options: PollForDataSetCreationStatusOptions) {
  const response = await request.json.get<DataSetCreatedResponse>(options.statusUrl, {
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as DataSetCreatedResponse

        if (data.dataSetCreated) {
          return response
        }
        throw new Error('Not created yet')
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Not created yet',
      retries: RETRIES,
      factor: FACTOR,
      minTimeout: MIN_TIMEOUT,
    },

    timeout: TIMEOUT,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PollDataSetCreationStatusError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result as DataSetCreateSuccess
}

export type PDPCreateDataSetAndAddPiecesOptions = {
  endpoint: string
  recordKeeper: Address
  extraData: Hex
  pieces: PieceCID[]
}

/**
 * Create a data set and add pieces to it on PDP API
 *
 * POST /pdp/data-sets/create-and-add
 *
 * @param options - The options for the create data set and add pieces to it on PDP API.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.recordKeeper - The address of the record keeper.
 * @param options.extraData - The extra data for the create data set.
 * @returns The response from the create data set and add pieces to it on PDP API.
 */
export async function createDataSetAndAddPieces(options: PDPCreateDataSetAndAddPiecesOptions) {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets/create-and-add`, options.endpoint), {
    body: JSON.stringify({
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new CreateDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  const location = response.result.headers.get('Location')
  const hash = location?.split('/').pop()
  if (!location || !hash || !isHex(hash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: hash,
    statusUrl: new URL(location, options.endpoint).toString(),
  }
}

export type GetDataSetOptions = {
  endpoint: string
  dataSetId: bigint
}

export type GetDataSetResponse = {
  id: number
  nextChallengeEpoch: number
  pieces: SPPiece[]
}

export type SPPiece = {
  pieceCid: string
  pieceId: number
  subPieceCid: string
  subPieceOffset: number
}

/**
 * Get a data set from the PDP API.
 *
 * GET /pdp/data-sets/{dataSetId}
 *
 * @param options - The options for the get data set from the PDP API.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.dataSetId - The ID of the data set.
 * @returns The data set from the PDP API.
 */
export async function getDataSet(options: GetDataSetOptions) {
  const response = await request.json.get<GetDataSetResponse>(
    new URL(`pdp/data-sets/${options.dataSetId}`, options.endpoint)
  )
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new GetDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result
}

export type GetPiecesForDataSetOptions = {
  endpoint: string
  dataSetId: bigint
  chainId: number
  address: Address
  cdn: boolean
}

export type SPPieceWithUrl = Simplify<
  SPPiece & {
    pieceUrl: string
  }
>

/**
 * Get the pieces for a data set from the PDP API.
 *
 *
 * @param options - The options for the get pieces for data set.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.dataSetId - The ID of the data set.
 * @param options.chainId - The chain ID.
 * @param options.address - The address of the user.
 * @param options.cdn - Whether the CDN is enabled.
 */
export async function getPiecesForDataSet(options: GetPiecesForDataSetOptions): Promise<SPPieceWithUrl[]> {
  const dataSet = await getDataSet(options)
  const pieces = dataSet.pieces.map((piece) => ({
    pieceCid: piece.pieceCid,
    pieceId: piece.pieceId,
    pieceUrl: createPieceUrl(piece.pieceCid, options.cdn, options.address, options.chainId, options.endpoint),
    subPieceCid: piece.subPieceCid,
    subPieceOffset: piece.subPieceOffset,
  }))

  return pieces
}

export type UploadPieceOptions = {
  endpoint: string
  data: Uint8Array
  pieceCid: PieceCID
}

export type UploadPieceResponse = {
  pieceCid: PieceCID
  size: number
}

/**
 * Upload a piece to the PDP API.
 *
 * POST /pdp/piece
 *
 * @param options - The options for the upload piece.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.data - The data to upload.
 * @returns The response from the upload piece.
 */
export async function uploadPiece(options: UploadPieceOptions): Promise<void> {
  const size = options.data.length
  if (size < SIZE_CONSTANTS.MIN_UPLOAD_SIZE || size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
    throw new InvalidUploadSizeError(size)
  }

  const pieceCid = options.pieceCid
  if (!Piece.isPieceCID(pieceCid)) {
    throw new Error(`Invalid PieceCID: ${String(options.pieceCid)}`)
  }
  const response = await request.post(new URL(`pdp/piece`, options.endpoint), {
    body: JSON.stringify({
      pieceCid: pieceCid.toString(),
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
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

  const uploadResponse = await request.put(new URL(`pdp/piece/upload/${uploadUuid}`, options.endpoint), {
    body: options.data,
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

export type FindPieceOptions = {
  endpoint: string
  pieceCid: PieceCID
}

/**
 * Find a piece on the PDP API.
 *
 * GET /pdp/piece?pieceCid={pieceCid}
 *
 * @param options - The options for the find piece.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.pieceCid - The piece CID to find.
 * @returns
 */
export async function findPiece(options: FindPieceOptions): Promise<PieceCID> {
  const { pieceCid, endpoint } = options
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })

  const response = await request.json.get<{ pieceCid: string }>(new URL(`pdp/piece?${params.toString()}`, endpoint), {
    retry: {
      statusCodes: [404],
      retries: RETRIES,
      factor: FACTOR,
    },
    timeout: TIMEOUT,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new FindPieceError(await response.error.response.text())
    }
    if (TimeoutError.is(response.error)) {
      throw new FindPieceError('Timeout waiting for piece to be found')
    }
    throw response.error
  }
  const data = response.result
  return Piece.parse(data.pieceCid)
}

export type AddPiecesOptions = {
  endpoint: string
  dataSetId: bigint
  pieces: PieceCID[]
  extraData: Hex
}

/**
 * Add pieces to a data set on the PDP API.
 *
 * POST /pdp/data-sets/{dataSetId}/pieces
 *
 * @param options - The options for the add pieces.
 * @param options.endpoint - The endpoint of the PDP API.
 * @param options.dataSetId - The ID of the data set.
 * @param options.pieces - The pieces to add.
 * @param options.extraData - The extra data for the add pieces.
 * @returns The response from the add pieces.
 */
export async function addPieces(options: AddPiecesOptions) {
  const { endpoint, dataSetId, pieces, extraData } = options
  const response = await request.post(new URL(`pdp/data-sets/${dataSetId}/pieces`, endpoint), {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pieces: pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
      extraData: extraData,
    }),
    timeout: TIMEOUT,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new AddPiecesError(await response.error.response.text())
    }
    throw response.error
  }
  const location = response.result.headers.get('Location')
  const txHash = location?.split('/').pop()
  if (!location || !txHash || !isHex(txHash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: txHash as Hex,
    statusUrl: new URL(location, endpoint).toString(),
  }
}

export type AddPiecesResponse =
  | {
      addMessageOk: null
      dataSetId: number
      pieceCount: number
      piecesAdded: boolean
      txHash: Hex
      txStatus: 'pending' | 'confirmed' | 'rejected'
    }
  | {
      addMessageOk: true
      confirmedPieceIds: number[]
      dataSetId: number
      pieceCount: number
      piecesAdded: boolean
      txHash: Hex
      txStatus: 'pending' | 'confirmed' | 'rejected'
    }
  | AddPiecesSuccess

export type AddPiecesSuccess = {
  addMessageOk: true
  confirmedPieceIds: number[]
  dataSetId: number
  pieceCount: number
  piecesAdded: true
  txHash: Hex
  txStatus: 'confirmed'
}

export type PollForAddPiecesStatusOptions = {
  statusUrl: string
}

/**
 * Poll for the add pieces status.
 *
 * GET /pdp/data-sets/{dataSetId}/pieces/added/{txHash}
 *
 * @param options - The options for the poll for add pieces status.
 * @param options.statusUrl - The status URL of the add pieces.
 * @returns The add pieces status.
 */
export async function pollForAddPiecesStatus(options: PollForAddPiecesStatusOptions) {
  const response = await request.json.get<AddPiecesResponse>(options.statusUrl, {
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as AddPiecesResponse

        if (data.piecesAdded) {
          return response
        }
        throw new Error('Not added yet')
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Not added yet',
      retries: RETRIES,
      factor: FACTOR,
      minTimeout: MIN_TIMEOUT,
    },
    timeout: 1000 * 60 * 5,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PollForAddPiecesStatusError(await response.error.response.text())
    }
    throw response.error
  }
  return response.result as AddPiecesSuccess
}

export type DeletePieceOptions = {
  endpoint: string
  dataSetId: bigint
  pieceId: bigint
  extraData: Hex
}

export type DeletePieceResponse = {
  txHash: Hex
}

/**
 * Delete a piece from a data set on the PDP API.
 *
 * DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}
 */
export async function deletePiece(options: DeletePieceOptions) {
  const { endpoint, dataSetId, pieceId, extraData } = options
  const response = await request.json.delete<DeletePieceResponse>(
    new URL(`pdp/data-sets/${dataSetId}/pieces/${pieceId}`, endpoint),
    {
      body: { extraData },
    }
  )

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DeletePieceError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result
}

export async function ping(endpoint: string) {
  const response = await request.get(new URL(`pdp/ping`, endpoint))
  if (response.error) {
    throw new Error('Ping failed')
  }
  return response.result
}
