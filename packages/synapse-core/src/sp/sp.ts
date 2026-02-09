import { type AbortError, HttpError, type NetworkError, request, TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Address, type Hex, isHex } from 'viem'
import {
  AddPiecesError,
  CreateDataSetError,
  DeletePieceError,
  DownloadPieceError,
  FindPieceError,
  InvalidUploadSizeError,
  LocationHeaderError,
  PostPieceError,
  UploadPieceError,
} from '../errors/pdp.ts'
import type { PieceCID } from '../piece.ts'
import * as Piece from '../piece.ts'
import type * as TypedData from '../typed-data/index.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from '../utils/constants.ts'
import { createPieceUrlPDP } from '../utils/piece-url.ts'

export namespace createDataSet {
  /**
   * The options for the create data set on PDP API.
   */
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set. */
    extraData: Hex
  }

  export type OutputType = {
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
 * @returns Transaction hash and status URL. {@link createDataSet.OutputType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSet(options: createDataSet.OptionsType): Promise<createDataSet.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets`, options.serviceURL), {
    body: JSON.stringify({
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
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
    statusUrl: new URL(location, options.serviceURL).toString(),
  }
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set and add pieces. */
    extraData: Hex
    /** The pieces to add. */
    pieces: PieceCID[]
  }
  export type OutputType = {
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
 * @returns Hash and status URL {@link createDataSetAndAddPieces.OutputType}
 * @throws Errors {@link createDataSetAndAddPieces.ErrorType}
 */
export async function createDataSetAndAddPieces(
  options: createDataSetAndAddPieces.OptionsType
): Promise<createDataSetAndAddPieces.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets/create-and-add`, options.serviceURL), {
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
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
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
    statusUrl: new URL(location, options.serviceURL).toString(),
  }
}

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

export namespace uploadPieceStreaming {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The data to upload. */
    data: Blob
    /** The size of the data. If defined, it will be used to set the Content-Length header. */
    size?: number
    /** The progress callback. */
    onProgress?: (bytesUploaded: number) => void
    /** The piece CID to upload. */
    pieceCid?: PieceCID
    /** The signal to abort the request. */
    signal?: AbortSignal
  }
  export type OutputType = {
    pieceCid: PieceCID
    size: number
  }

  export type ErrorType = InvalidUploadSizeError | PostPieceError | LocationHeaderError
}

/**
 * Upload piece data using the 3-step CommP-last streaming protocol.
 *
 * Protocol:
 * 1. POST /pdp/piece/uploads → get upload session UUID
 * 2. PUT /pdp/piece/uploads/{uuid} → stream data while calculating CommP
 * 3. POST /pdp/piece/uploads/{uuid} → finalize with calculated CommP
 *
 * @param options - {@link uploadPieceStreaming.OptionsType}
 * @returns PieceCID and size of uploaded data {@link uploadPieceStreaming.OutputType}
 * @throws Errors {@link uploadPieceStreaming.ErrorType}
 */
export async function uploadPieceStreaming(
  options: uploadPieceStreaming.OptionsType
): Promise<uploadPieceStreaming.OutputType> {
  if (options.data.size < SIZE_CONSTANTS.MIN_UPLOAD_SIZE || options.data.size > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
    throw new InvalidUploadSizeError(options.data.size)
  }
  // Create upload session (POST /pdp/piece/uploads)
  const createResponse = await request.post(new URL('pdp/piece/uploads', options.serviceURL), {
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
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

  const dataStream = options.data.stream()

  // Add size tracking and progress reporting
  let bytesUploaded = 0
  const trackingStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      bytesUploaded += chunk.length

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
    'Content-Length': options.data.size.toString(),
  }

  const uploadResponse = await request.put(new URL(`pdp/piece/uploads/${uploadUuid}`, options.serviceURL), {
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
  const finalizeResponse = await request.post(new URL(`pdp/piece/uploads/${uploadUuid}`, options.serviceURL), {
    body: finalizeBody,
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
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
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The piece CID to find. */
    pieceCid: PieceCID
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** Whether to retry the request. Defaults to false. */
    retry?: boolean
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The poll interval in milliseconds. Defaults to 1 second. */
    pollInterval?: number
  }
  export type OutputType = PieceCID
  export type ErrorType = FindPieceError | TimeoutError | NetworkError | AbortError
}
/**
 * Find a piece on the PDP API.
 *
 * GET /pdp/piece?pieceCid={pieceCid}
 *
 * @param options - {@link findPiece.OptionsType}
 * @returns Piece CID {@link findPiece.OutputType}
 * @throws Errors {@link findPiece.ErrorType}
 */
export async function findPiece(options: findPiece.OptionsType): Promise<findPiece.OutputType> {
  const { pieceCid, serviceURL } = options
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })
  const retry = options.retry ?? false
  const response = await request.json.get<{ pieceCid: string }>(new URL(`pdp/piece?${params.toString()}`, serviceURL), {
    signal: options.signal,
    retry: retry
      ? {
          statusCodes: [202, 404],
          retries: RETRY_CONSTANTS.RETRIES,
          factor: RETRY_CONSTANTS.FACTOR,
          minTimeout: options.pollInterval ?? 1000,
        }
      : undefined,
    timeout: options.timeout ?? RETRY_CONSTANTS.MAX_RETRY_TIME,
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
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The pieces to add. */
    pieces: PieceCID[]
    /** The extra data for the add pieces. {@link TypedData.signAddPieces} */
    extraData: Hex
  }
  export type OutputType = {
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
 * @returns Hash and status URL {@link addPieces.OutputType}
 * @throws Errors {@link addPieces.ErrorType}
 */
export async function addPieces(options: addPieces.OptionsType): Promise<addPieces.OutputType> {
  const { serviceURL, dataSetId, pieces, extraData } = options
  const response = await request.post(new URL(`pdp/data-sets/${dataSetId}/pieces`, serviceURL), {
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
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
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
    statusUrl: new URL(location, serviceURL).toString(),
  }
}

export namespace deletePiece {
  export type OptionsType = {
    serviceURL: string
    dataSetId: bigint
    pieceId: bigint
    extraData: Hex
  }
  export type OutputType = {
    hash: Hex
  }
  export type ErrorType = DeletePieceError | TimeoutError | NetworkError | AbortError
}

/**
 * Delete a piece from a data set on the PDP API.
 *
 * DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}
 *
 * @param options - {@link deletePiece.OptionsType}
 * @returns Hash of the delete operation {@link deletePiece.OutputType}
 * @throws Errors {@link deletePiece.ErrorType}
 */
export async function deletePiece(options: deletePiece.OptionsType): Promise<deletePiece.OutputType> {
  const { serviceURL, dataSetId, pieceId, extraData } = options
  const response = await request.json.delete<{ txHash: Hex }>(
    new URL(`pdp/data-sets/${dataSetId}/pieces/${pieceId}`, serviceURL),
    {
      body: { extraData },
      timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
    }
  )

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DeletePieceError(await response.error.response.text())
    }
    throw response.error
  }

  return { hash: response.result.txHash }
}

/**
 * Ping the PDP API.
 *
 * GET /pdp/ping
 *
 * @param serviceURL - The service URL of the PDP API.
 * @returns void
 * @throws Errors {@link Error}
 */
export async function ping(serviceURL: string) {
  const response = await request.get(new URL(`pdp/ping`, serviceURL))
  if (response.error) {
    throw new Error('Ping failed')
  }
  return response.result
}

export namespace downloadPiece {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The piece CID to download. */
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
  const url = createPieceUrlPDP({ cid: options.pieceCid.toString(), serviceURL: options.serviceURL })
  const response = await request.get(url)
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DownloadPieceError(await response.error.response.text())
    }
    throw response.error
  }
  return await Piece.downloadAndValidate(response.result, options.pieceCid)
}
