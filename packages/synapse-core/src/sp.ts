/**
 * Service Provider HTTP Operations
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * ```
 *
 * @module sp
 */

import { type AbortError, HttpError, type NetworkError, request, TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import type { Simplify } from 'type-fest'
import { type Address, type Hex, isHex } from 'viem'
import {
  AddPiecesError,
  CreateDataSetError,
  DeletePieceError,
  DownloadPieceError,
  FindPieceError,
  GetDataSetError,
  InvalidUploadSizeError,
  LocationHeaderError,
  PostPieceError,
  UploadPieceError,
  WaitDataSetCreationStatusError,
  WaitForAddPiecesStatusError,
} from './errors/pdp.ts'
import type { PieceCID } from './piece.ts'
import * as Piece from './piece.ts'
import type * as TypedData from './typed-data/index.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from './utils/constants.ts'
import { createPieceUrl, createPieceUrlPDP } from './utils/piece-url.ts'
import { asReadableStream } from './utils/streams.ts'

let TIMEOUT = RETRY_CONSTANTS.MAX_RETRY_TIME
export const RETRIES = RETRY_CONSTANTS.RETRIES
export const FACTOR = RETRY_CONSTANTS.FACTOR
export const MIN_TIMEOUT = RETRY_CONSTANTS.DELAY_TIME

// Just for testing purposes
export function setTimeout(timeout: number) {
  TIMEOUT = timeout
}
export function resetTimeout() {
  TIMEOUT = RETRY_CONSTANTS.MAX_RETRY_TIME
}

export { AbortError, NetworkError, TimeoutError } from 'iso-web/http'

export namespace createDataSet {
  /**
   * The options for the create data set on PDP API.
   */
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set. */
    extraData: Hex
  }

  export type ReturnType = {
    txHash: Hex
    statusUrl: string
  }

  export type ErrorType = CreateDataSetError | LocationHeaderError | TimeoutError | NetworkError | AbortError

  export type RequestBody = {
    recordKeeper: Address
    extraData: Hex
  }
}

/**
 * Create a data set on PDP API
 *
 * POST /pdp/data-sets
 *
 * @param options - {@link createDataSet.OptionsType}
 * @returns Transaction hash and status URL. {@link createDataSet.ReturnType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSet(options: createDataSet.OptionsType): Promise<createDataSet.ReturnType> {
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

export namespace waitForDataSetCreationStatus {
  export type OptionsType = {
    statusUrl: string
  }
  export type ReturnType = DataSetCreateSuccess
  export type ErrorType = WaitDataSetCreationStatusError | TimeoutError | NetworkError | AbortError
}
/**
 * Wait for the data set creation status.
 *
 * GET /pdp/data-sets/created({txHash})
 *
 * @param options - {@link waitForDataSetCreationStatus.OptionsType}
 * @returns Status {@link waitForDataSetCreationStatus.ReturnType}
 * @throws Errors {@link waitForDataSetCreationStatus.ErrorType}
 */
export async function waitForDataSetCreationStatus(
  options: waitForDataSetCreationStatus.OptionsType
): Promise<waitForDataSetCreationStatus.ReturnType> {
  const response = await request.json.get<waitForDataSetCreationStatus.ReturnType>(options.statusUrl, {
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as waitForDataSetCreationStatus.ReturnType

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
      throw new WaitDataSetCreationStatusError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result as waitForDataSetCreationStatus.ReturnType
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set and add pieces. */
    extraData: Hex
    /** The pieces to add. */
    pieces: PieceCID[]
  }
  export type ReturnType = {
    /** The transaction hash. */
    txHash: Hex
    /** The status URL. */
    statusUrl: string
  }
  export type ErrorType = CreateDataSetError | LocationHeaderError | TimeoutError | NetworkError | AbortError
  export type RequestBody = {
    recordKeeper: Address
    extraData: Hex
    pieces: {
      pieceCid: ToString<PieceCID>
      subPieces: { subPieceCid: ToString<PieceCID> }[]
    }[]
  }
}

/**
 * Create a data set and add pieces to it on PDP API
 *
 * POST /pdp/data-sets/create-and-add
 *
 * @param options - {@link createDataSetAndAddPieces.OptionsType}
 * @returns Hash and status URL {@link createDataSetAndAddPieces.ReturnType}
 * @throws Errors {@link createDataSetAndAddPieces.ErrorType}
 */
export async function createDataSetAndAddPieces(
  options: createDataSetAndAddPieces.OptionsType
): Promise<createDataSetAndAddPieces.ReturnType> {
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

export type SPPiece = {
  pieceCid: string
  pieceId: number
  subPieceCid: string
  subPieceOffset: number
}

export namespace getDataSet {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The ID of the data set. */
    dataSetId: bigint
  }
  export type ReturnType = {
    id: number
    nextChallengeEpoch: number
    pieces: SPPiece[]
  }
  export type ErrorType = GetDataSetError | TimeoutError | NetworkError | AbortError
}

/**
 * Get a data set from the PDP API.
 *
 * GET /pdp/data-sets/{dataSetId}
 *
 * @param options - {@link getDataSet.OptionsType}
 * @returns The data set from the PDP API. {@link getDataSet.ReturnType}
 * @throws Errors {@link getDataSet.ErrorType}
 */
export async function getDataSet(options: getDataSet.OptionsType): Promise<getDataSet.ReturnType> {
  const response = await request.json.get<getDataSet.ReturnType>(
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

export type SPPieceWithUrl = Simplify<
  SPPiece & {
    pieceUrl: string
  }
>

export namespace getPiecesForDataSet {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The chain ID. */
    chainId: number
    /** The address of the user. */
    address: Address
    /** Whether the CDN is enabled. */
    cdn: boolean
  }
  export type ReturnType = SPPieceWithUrl[]
  export type ErrorType = GetDataSetError | TimeoutError | NetworkError | AbortError
}

/**
 * Get the pieces for a data set from the PDP API.
 *
 * @param options - {@link getPiecesForDataSet.OptionsType}
 * @returns Pieces with URLs. {@link getPiecesForDataSet.ReturnType}
 * @throws Errors {@link getPiecesForDataSet.ErrorType}
 */
export async function getPiecesForDataSet(
  options: getPiecesForDataSet.OptionsType
): Promise<getPiecesForDataSet.ReturnType> {
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

export namespace uploadPiece {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
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

export type UploadPieceStreamingOptions = {
  endpoint: string
  data: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>
  size?: number
  onProgress?: (bytesUploaded: number) => void
  pieceCid?: PieceCID
  signal?: AbortSignal
}

export type UploadPieceResponse = {
  pieceCid: PieceCID
  size: number
}

/**
 * Upload piece data using the 3-step CommP-last streaming protocol.
 *
 * Protocol:
 * 1. POST /pdp/piece/uploads → get upload session UUID
 * 2. PUT /pdp/piece/uploads/{uuid} → stream data while calculating CommP
 * 3. POST /pdp/piece/uploads/{uuid} → finalize with calculated CommP
 *
 * @param options - Upload options
 * @param options.endpoint - The endpoint of the PDP API
 * @param options.data - AsyncIterable or ReadableStream yielding Uint8Array chunks
 * @param options.size - Optional known size for Content-Length header
 * @param options.onProgress - Optional progress callback
 * @param options.signal - Optional AbortSignal to cancel the upload
 * @returns PieceCID and size of uploaded data
 * @throws Error if upload fails at any step or if size exceeds MAX_UPLOAD_SIZE
 */
export async function uploadPieceStreaming(options: UploadPieceStreamingOptions): Promise<UploadPieceResponse> {
  // Create upload session (POST /pdp/piece/uploads)
  const createResponse = await request.post(new URL('pdp/piece/uploads', options.endpoint), {
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (createResponse.error) {
    if (HttpError.is(createResponse.error)) {
      throw new PostPieceError(`Failed to create upload session: ${await createResponse.error.response.text()}`)
    }
    throw createResponse.error
  }

  if (createResponse.result.status !== 201) {
    throw new PostPieceError(`Expected 201 Created, got ${createResponse.result.status}`)
  }

  // Extract UUID from Location header: /pdp/piece/uploads/{uuid}
  const location = createResponse.result.headers.get('Location')
  if (!location) {
    throw new LocationHeaderError('Upload session created but Location header missing')
  }

  const locationMatch = location.match(/\/pdp\/piece\/uploads\/([a-fA-F0-9-]+)/)
  if (!locationMatch) {
    throw new LocationHeaderError(`Invalid Location header format: ${location}`)
  }

  const uploadUuid = locationMatch[1]

  // Create CommP calculator stream only if PieceCID not provided
  let getPieceCID: () => PieceCID | null = () => options.pieceCid ?? null
  let pieceCidStream: TransformStream<Uint8Array, Uint8Array> | null = null

  if (options.pieceCid == null) {
    const result = Piece.createPieceCIDStream()
    pieceCidStream = result.stream
    getPieceCID = result.getPieceCID
  }

  // Convert to ReadableStream if needed (skip if already ReadableStream)
  const dataStream = asReadableStream(options.data)

  // Add size tracking and progress reporting
  let bytesUploaded = 0
  const trackingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesUploaded += chunk.length

      // Check size limit
      if (bytesUploaded > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
        throw new InvalidUploadSizeError(bytesUploaded)
      }

      // Report progress if callback provided
      if (options.onProgress) {
        options.onProgress(bytesUploaded)
      }

      controller.enqueue(chunk)
    },
  })

  // Chain streams: data → tracking → CommP calculation (if needed)
  const bodyStream = pieceCidStream
    ? dataStream.pipeThrough(trackingStream).pipeThrough(pieceCidStream)
    : dataStream.pipeThrough(trackingStream)

  // PUT /pdp/piece/uploads/{uuid} with streaming body
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
  }

  // Add Content-Length if size is known (recommended for server)
  if (options.size !== undefined) {
    headers['Content-Length'] = options.size.toString()
  }

  const uploadResponse = await request.put(new URL(`pdp/piece/uploads/${uploadUuid}`, options.endpoint), {
    body: bodyStream,
    headers,
    timeout: false, // No timeout for streaming upload
    signal: options.signal,
    duplex: 'half', // Required for streaming request bodies
  } as Parameters<typeof request.put>[1] & { duplex: 'half' })

  if (uploadResponse.error) {
    if (HttpError.is(uploadResponse.error)) {
      throw new UploadPieceError(`Failed to upload piece: ${await uploadResponse.error.response.text()}`)
    }
    throw uploadResponse.error
  }

  if (uploadResponse.result.status !== 204) {
    throw new UploadPieceError(`Expected 204 No Content, got ${uploadResponse.result.status}`)
  }

  // Get PieceCID (either provided or calculated) and finalize
  const pieceCid = getPieceCID()
  if (pieceCid === null) {
    throw new Error('Failed to calculate PieceCID during upload')
  }

  const finalizeBody = JSON.stringify({
    pieceCid: pieceCid.toString(),
  })

  // POST /pdp/piece/uploads/{uuid} with PieceCID
  const finalizeResponse = await request.post(new URL(`pdp/piece/uploads/${uploadUuid}`, options.endpoint), {
    body: finalizeBody,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (finalizeResponse.error) {
    if (HttpError.is(finalizeResponse.error)) {
      throw new PostPieceError(`Failed to finalize upload: ${await finalizeResponse.error.response.text()}`)
    }
    throw finalizeResponse.error
  }

  if (finalizeResponse.result.status !== 200) {
    throw new PostPieceError(`Expected 200 OK for finalization, got ${finalizeResponse.result.status}`)
  }

  return {
    pieceCid,
    size: bytesUploaded,
  }
}

export namespace findPiece {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The piece CID to find. */
    pieceCid: PieceCID
  }
  export type ReturnType = PieceCID
  export type ErrorType = FindPieceError | TimeoutError | NetworkError | AbortError
}
/**
 * Find a piece on the PDP API.
 *
 * GET /pdp/piece?pieceCid={pieceCid}
 *
 * @param options - {@link findPiece.OptionsType}
 * @returns Piece CID {@link findPiece.ReturnType}
 * @throws Errors {@link findPiece.ErrorType}
 */
export async function findPiece(options: findPiece.OptionsType): Promise<findPiece.ReturnType> {
  const { pieceCid, endpoint } = options
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })

  const response = await request.json.get<{ pieceCid: string }>(new URL(`pdp/piece?${params.toString()}`, endpoint), {
    retry: {
      statusCodes: [202, 404],
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

export namespace addPieces {
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The pieces to add. */
    pieces: PieceCID[]
    /** The extra data for the add pieces. {@link TypedData.signAddPieces} */
    extraData: Hex
  }
  export type ReturnType = {
    /** The transaction hash. */
    txHash: Hex
    /** The status URL. */
    statusUrl: string
  }
  export type ErrorType = AddPiecesError | LocationHeaderError | TimeoutError | NetworkError | AbortError
  export type RequestBody = {
    pieces: {
      pieceCid: ToString<PieceCID>
      subPieces: { subPieceCid: ToString<PieceCID> }[]
    }[]
    extraData: Hex
  }
}

/**
 * Add pieces to a data set on the PDP API.
 *
 * POST /pdp/data-sets/{dataSetId}/pieces
 *
 * @param options - {@link addPieces.OptionsType}
 * @returns Hash and status URL {@link addPieces.ReturnType}
 * @throws Errors {@link addPieces.ErrorType}
 */
export async function addPieces(options: addPieces.OptionsType): Promise<addPieces.ReturnType> {
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

export namespace waitForAddPiecesStatus {
  export type OptionsType = {
    statusUrl: string
  }
  export type ReturnType = AddPiecesSuccess
  export type ErrorType = WaitForAddPiecesStatusError | TimeoutError | NetworkError | AbortError
}

/**
 * Wait for the add pieces status.
 *
 * GET /pdp/data-sets/{dataSetId}/pieces/added/{txHash}
 *
 * TODO: add onEvent for txConfirmed
 *
 * @param options - {@link waitForAddPiecesStatus.OptionsType}
 * @returns Status {@link waitForAddPiecesStatus.ReturnType}
 * @throws Errors {@link waitForAddPiecesStatus.ErrorType}
 */
export async function waitForAddPiecesStatus(
  options: waitForAddPiecesStatus.OptionsType
): Promise<waitForAddPiecesStatus.ReturnType> {
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
    timeout: TIMEOUT,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new WaitForAddPiecesStatusError(await response.error.response.text())
    }
    throw response.error
  }
  return response.result as AddPiecesSuccess
}

export namespace deletePiece {
  export type OptionsType = {
    endpoint: string
    dataSetId: bigint
    pieceId: bigint
    extraData: Hex
  }
  export type ReturnType = {
    txHash: Hex
  }
  export type ErrorType = DeletePieceError | TimeoutError | NetworkError | AbortError
}

/**
 * Delete a piece from a data set on the PDP API.
 *
 * DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}
 *
 * @param options - {@link deletePiece.OptionsType}
 * @returns Hash of the delete operation {@link deletePiece.ReturnType}
 * @throws Errors {@link deletePiece.ErrorType}
 */
export async function deletePiece(options: deletePiece.OptionsType): Promise<deletePiece.ReturnType> {
  const { endpoint, dataSetId, pieceId, extraData } = options
  const response = await request.json.delete<deletePiece.ReturnType>(
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

/**
 * Ping the PDP API.
 *
 * GET /pdp/ping
 *
 * @param endpoint - The endpoint of the PDP API.
 * @returns void
 * @throws Errors {@link Error}
 */
export async function ping(endpoint: string) {
  const response = await request.get(new URL(`pdp/ping`, endpoint))
  if (response.error) {
    throw new Error('Ping failed')
  }
  return response.result
}

export namespace downloadPiece {
  export type OptionsType = {
    endpoint: string
    pieceCid: PieceCID
  }
  export type ReturnType = Uint8Array
  export type ErrorType = DownloadPieceError | TimeoutError | NetworkError | AbortError
}

/**
 * Download a piece and verify from the PDP API.
 *
 * GET /piece/{pieceCid}
 *
 * @param options - {@link downloadPiece.OptionsType}
 * @returns Data {@link downloadPiece.ReturnType}
 * @throws Errors {@link downloadPiece.ErrorType}
 */
export async function downloadPiece(options: downloadPiece.OptionsType): Promise<downloadPiece.ReturnType> {
  const url = createPieceUrlPDP(options.pieceCid.toString(), options.endpoint)
  const response = await request.get(url)
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DownloadPieceError(await response.error.response.text())
    }
    throw response.error
  }
  return await Piece.downloadAndValidate(response.result, options.pieceCid)
}
