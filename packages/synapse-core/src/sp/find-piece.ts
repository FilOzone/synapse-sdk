import { type AbortError, HttpError, type NetworkError, request, TimeoutError } from 'iso-web/http'
import { FindPieceError } from '../errors/pdp.ts'
import type { PieceCID } from '../piece/piece.ts'
import * as Piece from '../piece/piece.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'

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
