import { HttpError, type Errors as HttpErrors, request } from 'iso-web/http'
import { DownloadPieceError } from '../errors/pdp.ts'
import { InvalidPieceCIDError } from '../errors/piece.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { transformStream } from './calculate.ts'
import { tryFrom } from './parse.ts'
import type { PieceCID } from './piece-cid.ts'

export namespace download {
  export type OptionsType = {
    url: string
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to 250ms. */
    retryDelay?: number
    /** The signal to abort the request. */
    signal?: AbortSignal
  }
  export type ReturnType = Uint8Array
  export type ErrorType = DownloadPieceError | HttpErrors
}

/**
 * Download a piece from a URL.
 *
 * @param options - {@link download.OptionsType}
 * @returns Data {@link download.ReturnType}
 * @throws Errors {@link download.ErrorType}
 */
export async function download(options: download.OptionsType): Promise<download.ReturnType> {
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
  return new Uint8Array(await response.result.arrayBuffer())
}

export namespace downloadAndValidate {
  export type OptionsType = {
    url: string
    expectedPieceCid: string | PieceCID
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to 250ms. */
    retryDelay?: number
    /** The signal to abort the request. */
    signal?: AbortSignal
  }
  export type ReturnType = Uint8Array
  export type ErrorType = DownloadPieceError | HttpErrors | InvalidPieceCIDError
}

/**
 * Download data from a URL, validate its PieceCID, and return as Uint8Array
 *
 * This function:
 * 1. Downloads data from the URL
 * 2. Calculates PieceCID during streaming
 * 3. Collects all chunks into a Uint8Array
 * 4. Validates the calculated PieceCID matches the expected value
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
  const { url, expectedPieceCid } = options

  // Parse and validate the expected PieceCID
  const parsedPieceCid = tryFrom(expectedPieceCid)
  if (parsedPieceCid == null) {
    throw new InvalidPieceCIDError(expectedPieceCid)
  }

  const rsp = await request.get(url, {
    timeout: false,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
    signal: options.signal,
  })

  if (rsp.error) {
    if (HttpError.is(rsp.error)) {
      throw new DownloadPieceError(await rsp.error.response.text())
    }
    throw rsp.error
  }

  if (rsp.result.body == null) {
    throw new DownloadPieceError('Response body is null')
  }

  const { transform, result: pieceCidPromise } = transformStream()

  // Collect chunks as they pass through the PieceCID stream.
  const chunks: Uint8Array[] = []
  const collectStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      chunks.push(chunk)
      controller.enqueue(chunk)
    },
  })

  const pipelineStream = rsp.result.body.pipeThrough(transform).pipeThrough(collectStream)

  const reader = pipelineStream.getReader()
  try {
    while (true) {
      const { done } = await reader.read()
      if (done) break
    }
  } finally {
    reader.releaseLock()
  }

  if (chunks.length === 0) {
    throw new DownloadPieceError('Response body is empty')
  }

  const calculatedPieceCid = await pieceCidPromise

  if (!calculatedPieceCid.equals(parsedPieceCid)) {
    throw new DownloadPieceError(
      `PieceCID verification failed. Expected: ${String(parsedPieceCid)}, Got: ${String(calculatedPieceCid)}`
    )
  }

  // Combine all chunks into a single Uint8Array
  const totalLength = chunks.reduce((acc, chunk) => acc + chunk.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}
