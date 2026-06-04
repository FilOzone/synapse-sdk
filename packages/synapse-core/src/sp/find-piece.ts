import { type AbortError, HttpError, type NetworkError, request, TimeoutError } from 'iso-web/http'
import { FindPieceError } from '../errors/pdp.ts'
import * as Piece from '../piece/index.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'

export namespace findPiece {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The piece CID to find. */
    pieceCid: PieceCID
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
    /** Whether to poll the request. Defaults to false. */
    poll?: boolean
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
  const response = await request.json.get<{ pieceCid: string }>(new URL(`pdp/piece?${params.toString()}`, serviceURL), {
    signal: options.signal,
    timeout: options.timeout ?? RETRY_CONSTANTS.TIMEOUT,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
      shouldRetry: (ctx) => HttpError.is(ctx.error) && ctx.error.code === 404,
    },
    poll: options.poll
      ? {
          limit: RETRY_CONSTANTS.POLL_LIMIT,
          interval: options.pollInterval ?? 1000,
          statusCodes: [202], // 202 is processing
        }
      : false,
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
  return Piece.from(data.pieceCid)
}
