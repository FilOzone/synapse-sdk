import { type AbortError, HttpError, type NetworkError, request, TimeoutError } from 'iso-web/http'
import { FindPieceError } from '../errors/pdp.ts'
import * as Piece from '../piece/index.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { abortable, throwIfAborted } from '../utils/abort.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { serviceURLJoin } from '../utils/service-url.ts'

/** Default timeout for a single lookup, without polling. */
const LOOKUP_TIMEOUT = 30_000

export namespace findPiece {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The piece CID to find. */
    pieceCid: PieceCID
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The timeout in milliseconds. Defaults to 5 minutes when poll is true, 30 seconds otherwise. */
    timeout?: number
    /** The number of retries. Defaults to polling until timeout when poll is true. */
    retryCount?: number
    /** The delay between retries in milliseconds. Defaults to pollInterval when poll is true. */
    retryDelay?: number
    /**
     * Whether to wait for the piece to appear. When true, 404 and 202 responses are retried until
     * the timeout. When false, the first 404 or 202 throws a {@link FindPieceError} with `notFound` set.
     * Defaults to false.
     */
    poll?: boolean
    /** The poll interval in milliseconds. Defaults to 1 second. */
    pollInterval?: number
  }
  export type OutputType = PieceCID
  export type ErrorType = FindPieceError | NetworkError | AbortError
}

/**
 * Find a piece on the PDP API.
 *
 * GET /pdp/piece?pieceCid={pieceCid}
 *
 * Transient failures (5xx, 429, network errors) are retried. HTTP errors and timeouts are thrown as
 * {@link FindPieceError} with the original error as `cause`; `notFound` tells a missing piece apart
 * from other failures.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * import * as Piece from '@filoz/synapse-core/piece'
 *
 * // wait for an uploaded piece to be parked
 * const pieceCid = await SP.findPiece({
 *   serviceURL: 'https://pdp.example.com',
 *   pieceCid: Piece.from('bafkzcib...'),
 *   poll: true,
 * })
 * ```
 *
 * @param options - {@link findPiece.OptionsType}
 * @returns Piece CID {@link findPiece.OutputType}
 * @throws Errors {@link findPiece.ErrorType}
 */
export async function findPiece(options: findPiece.OptionsType): Promise<findPiece.OutputType> {
  const { pieceCid, serviceURL, poll = false } = options
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })
  const retryCount = options.retryCount ?? (poll ? RETRY_CONSTANTS.POLL_LIMIT : undefined)
  const retryDelay = options.retryDelay ?? (poll ? (options.pollInterval ?? 1000) : RETRY_CONSTANTS.RETRY_DELAY)
  const response = await request.get(serviceURLJoin(`pdp/piece?${params.toString()}`, serviceURL), {
    signal: options.signal,
    timeout: options.timeout ?? (poll ? RETRY_CONSTANTS.TIMEOUT : LOOKUP_TIMEOUT),
    retry: {
      retries: retryCount,
      factor: poll ? 1 : undefined,
      minTimeout: retryDelay,
      // keep the default retries for transient failures, and wait out 404s only when polling
      shouldRetry: (ctx) => ctx.defaultShouldRetry || (poll && HttpError.is(ctx.error) && ctx.error.code === 404),
    },
    poll: poll
      ? {
          limit: RETRY_CONSTANTS.POLL_LIMIT,
          interval: options.pollInterval ?? 1000,
          statusCodes: [202], // 202 is processing
        }
      : false,
  })

  if (response.error) {
    const error = response.error
    if (HttpError.is(error)) {
      throw new FindPieceError(await error.response.text(), { cause: error, notFound: error.code === 404 })
    }
    if (TimeoutError.is(error)) {
      throw new FindPieceError('Timeout waiting for piece to be found', { cause: error })
    }
    throw error
  }

  const result = response.result
  if (result.status === 202) {
    result.body?.cancel().catch(() => undefined)
    throw new FindPieceError('Piece is still being processed', { notFound: true })
  }
  let data: { pieceCid?: unknown }
  try {
    data = await abortable(result.json(), options.signal)
  } catch (error) {
    // an abort while the body is read must surface as AbortError, not as a bad response
    throwIfAborted(options.signal)
    throw new FindPieceError('Response body is not valid JSON', { cause: error as Error })
  }
  if (typeof data?.pieceCid !== 'string') {
    throw new FindPieceError('Response is missing pieceCid')
  }
  return Piece.from(data.pieceCid)
}
