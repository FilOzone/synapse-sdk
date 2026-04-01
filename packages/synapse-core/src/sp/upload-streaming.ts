import { HttpError, request } from 'iso-web/http'
import { InvalidUploadSizeError, LocationHeaderError, PostPieceError, UploadPieceError } from '../errors/pdp.ts'
import type { PieceCID } from '../piece/piece.ts'
import * as Piece from '../piece/piece.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from '../utils/constants.ts'
import { isUint8Array, supportsStreamingFetchBody } from '../utils/streams.ts'

export type UploadPieceStreamingData = Uint8Array | ReadableStream | import('node:stream/web').ReadableStream

export namespace uploadPieceStreaming {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The data to upload. */
    data: UploadPieceStreamingData
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

  const dataStream = isUint8Array(options.data)
    ? new Blob([options.data as Uint8Array<ArrayBuffer>]).stream()
    : (options.data as ReadableStream) // ReadableStream types dont match between browsers and Node.js

  let size = isUint8Array(options.data) ? options.data.length : options.size

  // Add size tracking and progress reporting
  let bytesUploaded = 0
  const trackingStream = new TransformStream<unknown, Uint8Array>({
    transform(chunk, controller) {
      let bytes: Uint8Array | undefined

      if (isUint8Array(chunk)) {
        bytes = chunk
      } else if (ArrayBuffer.isView(chunk)) {
        bytes = new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
      } else {
        controller.error('Invalid chunk type only Uint8Array and TypedArray are supported')
        return
      }

      bytesUploaded += bytes.length

      if (bytesUploaded > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
        controller.error(new InvalidUploadSizeError(bytesUploaded))
        return
      }

      // Report progress if callback provided
      if (options.onProgress) {
        options.onProgress(bytesUploaded)
      }

      controller.enqueue(bytes)
    },
    flush(controller) {
      if (bytesUploaded < SIZE_CONSTANTS.MIN_UPLOAD_SIZE) {
        controller.error(new InvalidUploadSizeError(bytesUploaded))
        return
      }
    },
  })

  // Chain streams: data → tracking → CommP calculation (if needed)
  const bodyStream = pieceCidStream
    ? dataStream.pipeThrough(trackingStream).pipeThrough(pieceCidStream)
    : dataStream.pipeThrough(trackingStream)

  // Determine fetch body: stream it directly when the environment supports
  // ReadableStream as a request body (Chrome, Node.js), otherwise drain the
  // pipeline into a Blob first (Firefox, Safari). Draining still runs the
  // full TransformStream chain so CommP calculation and progress tracking
  // both execute regardless of path.
  let fetchBody: ReadableStream | Blob
  let fetchOptions: Record<string, string> = {}

  if (supportsStreamingFetchBody()) {
    fetchBody = bodyStream
    fetchOptions = { duplex: 'half' }
  } else {
    const chunks: Uint8Array[] = []
    let totalSize = 0
    const reader = bodyStream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalSize += value.length
    }
    fetchBody = new Blob(chunks as BlobPart[])
    // Override Content-Length with the actual accumulated size since we now
    // know it precisely, even for ReadableStream inputs without a pre-set size
    if (size == null) {
      size = totalSize
    }
  }

  // PUT /pdp/piece/uploads/{uuid}
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    ...(size == null ? {} : { 'Content-Length': size.toString() }),
  }

  const uploadResponse = await request.put(new URL(`pdp/piece/uploads/${uploadUuid}`, options.serviceURL), {
    body: fetchBody,
    headers,
    timeout: false, // No timeout for streaming upload
    signal: options.signal,
    ...fetchOptions,
  } as Parameters<typeof request.put>[1] & { duplex?: 'half' })

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
