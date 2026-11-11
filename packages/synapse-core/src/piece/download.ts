import { HttpError, type RequestErrors, request } from 'iso-web/http'
import { DownloadPieceError } from '../errors/pdp.ts'
import { InvalidPieceCIDError } from '../errors/piece.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { readAllBytes } from '../utils/streams.ts'
import { hasher } from './calculate.ts'
import { tryFrom } from './parse.ts'
import type { PieceCID } from './piece-cid.ts'

type RequestOptions = {
  url: string
  /** The number of retries. Defaults to 2. */
  retryCount?: number
  /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
  retryDelay?: number
  /** The signal to abort the request. */
  signal?: AbortSignal
}

/**
 * GET `options.url` and return the successful response, mapping HTTP errors to {@link DownloadPieceError}.
 */
async function fetchPiece(options: RequestOptions): Promise<Response> {
  const response = await request.get(options.url, {
    timeout: false,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
    signal: options.signal,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DownloadPieceError(await response.error.response.text())
    }
    throw response.error
  }
  return response.result
}

export namespace download {
  export type OptionsType = RequestOptions
  export type ReturnType = Uint8Array
  export type ErrorType = DownloadPieceError | RequestErrors
}

/**
 * Download a piece from a URL.
 *
 * @param options - {@link download.OptionsType}
 * @returns Data {@link download.ReturnType}
 * @throws Errors {@link download.ErrorType}
 */
export async function download(options: download.OptionsType): Promise<download.ReturnType> {
  const response = await fetchPiece(options)
  return new Uint8Array(await response.arrayBuffer())
}

export namespace downloadStream {
  export type OptionsType = RequestOptions &
    (
      | {
          /** The PieceCID the downloaded bytes must hash to. */
          expectedPieceCid: string | PieceCID
          /** Whether to validate the PieceCID of the streamed bytes. Defaults to `true`. */
          validate?: true
        }
      | {
          /** Not checked when `validate` is `false`. */
          expectedPieceCid?: string | PieceCID
          /** Skip PieceCID validation and return the response body as is. */
          validate: false
        }
    )
  export type ReturnType = ReadableStream<Uint8Array>
  export type ErrorType = DownloadPieceError | RequestErrors | InvalidPieceCIDError
}

/**
 * Download a piece from a URL as a stream, validating its PieceCID as the bytes flow through.
 *
 * Memory use stays bounded regardless of the piece size, so this is the function to use for
 * large pieces. The returned promise rejects for request errors (network, HTTP status, null body).
 * Validation errors surface on the stream itself: every chunk is passed through as it arrives and,
 * once the body ends, the stream errors with a {@link DownloadPieceError} instead of closing if the
 * calculated PieceCID does not match `expectedPieceCid` or the body is empty.
 *
 * Because the error only arrives after the last chunk, consumers that persist data (e.g. to a file)
 * must treat the bytes as untrusted until the stream closes cleanly, and discard them on error.
 *
 * Pass `validate: false` to skip validation, in which case `expectedPieceCid` is not needed.
 *
 * @param options - {@link downloadStream.OptionsType}
 * @returns A stream of the piece bytes {@link downloadStream.ReturnType}
 * @throws Errors {@link downloadStream.ErrorType}
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 * const stream = await Piece.downloadStream({
 *   url: 'https://example.com/piece',
 *   expectedPieceCid: 'bafkzcib...',
 * })
 * for await (const chunk of stream) {
 *   console.log(chunk.length)
 * }
 * ```
 */
export async function downloadStream(options: downloadStream.OptionsType): Promise<downloadStream.ReturnType> {
  if (options.validate === false) {
    return responseBody(await fetchPiece(options))
  }

  const { expectedPieceCid } = options
  const parsedPieceCid = tryFrom(expectedPieceCid)
  if (parsedPieceCid == null) {
    throw new InvalidPieceCIDError(expectedPieceCid)
  }

  const body = responseBody(await fetchPiece(options))

  // `hasher()` releases its WASM memory on garbage collection, so a cancelled stream doesn't leak.
  const h = hasher()
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        h.write(chunk)
        controller.enqueue(chunk)
      },
      flush(controller) {
        if (h.count() === 0n) {
          controller.error(new DownloadPieceError('Response body is empty'))
          return
        }
        const calculatedPieceCid = h.finalize()
        if (!calculatedPieceCid.equals(parsedPieceCid)) {
          controller.error(
            new DownloadPieceError(
              `PieceCID verification failed. Expected: ${String(parsedPieceCid)}, Got: ${String(calculatedPieceCid)}`
            )
          )
        }
      },
    })
  )
}

function responseBody(response: Response): ReadableStream<Uint8Array> {
  if (response.body == null) {
    throw new DownloadPieceError('Response body is null')
  }
  return response.body
}

export namespace downloadAndValidate {
  export type OptionsType = RequestOptions & {
    /** The PieceCID the downloaded bytes must hash to. */
    expectedPieceCid: string | PieceCID
  }
  export type ReturnType = Uint8Array
  export type ErrorType = DownloadPieceError | RequestErrors | InvalidPieceCIDError
}

/**
 * Download data from a URL, validate its PieceCID, and return as Uint8Array
 *
 * Reads {@link downloadStream} into memory, so the whole piece must fit in memory. Use
 * {@link downloadStream} for large pieces.
 *
 * @param options - {@link downloadAndValidate.OptionsType}
 * @returns Data {@link downloadAndValidate.ReturnType}
 * @throws Errors {@link downloadAndValidate.ErrorType}
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 * const data = await Piece.downloadAndValidate({
 *   url: 'https://example.com/piece',
 *   expectedPieceCid: 'bafkzcib...',
 * })
 * console.log(data)
 * ```
 */
export async function downloadAndValidate(options: downloadAndValidate.OptionsType): Promise<Uint8Array> {
  return readAllBytes(await downloadStream({ ...options, validate: true }))
}
