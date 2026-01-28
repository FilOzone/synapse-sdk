/**
 * SP-to-SP Piece Pull Operations
 *
 * Provides functionality to pull pieces from external storage providers.
 * Uses Curio's POST /pdp/piece/pull endpoint which is idempotent -
 * repeated calls with the same extraData return the current status
 * rather than creating duplicate requests.
 *
 * @example
 * ```ts
 * import * as Pull from '@filoz/synapse-core/pull'
 * ```
 *
 * @module pull
 */

import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { Address, Hex } from 'viem'
import { PullError } from './errors/pull.ts'
import { RETRY_CONSTANTS } from './utils/constants.ts'

let TIMEOUT = RETRY_CONSTANTS.MAX_RETRY_TIME
export const RETRIES = RETRY_CONSTANTS.RETRIES
export const FACTOR = RETRY_CONSTANTS.FACTOR
export const MIN_TIMEOUT = RETRY_CONSTANTS.DELAY_TIME

// For testing purposes
export function setTimeout(timeout: number) {
  TIMEOUT = timeout
}
export function resetTimeout() {
  TIMEOUT = RETRY_CONSTANTS.MAX_RETRY_TIME
}

export { AbortError, NetworkError, TimeoutError } from 'iso-web/http'

/**
 * Status of a pull operation or individual piece.
 *
 * Status progression:
 * - `pending`: Piece is queued but download hasn't started
 * - `inProgress`: Download task is actively running (first attempt)
 * - `retrying`: Download task is running after one or more failures
 * - `complete`: Piece successfully downloaded and verified
 * - `failed`: Piece permanently failed after exhausting retries
 *
 * Overall response status reflects the worst-case across all pieces:
 * failed > retrying > inProgress > pending > complete
 */
export type PullStatus = 'pending' | 'inProgress' | 'retrying' | 'complete' | 'failed'

/**
 * Input piece for a pull request.
 */
export type PullPieceInput = {
  /** PieceCIDv2 format (encodes both CommP and raw size) */
  pieceCid: string
  /** HTTPS URL to pull the piece from (must end in /piece/{pieceCid}) */
  sourceUrl: string
}

/**
 * Status of a single piece in a pull response.
 */
export type PullPieceStatus = {
  /** PieceCIDv2 of the piece */
  pieceCid: string
  /** Current status of this piece */
  status: PullStatus
}

/**
 * Response from a pull request.
 */
export type PullResponse = {
  /** Overall status (worst-case across all pieces) */
  status: PullStatus
  /** Per-piece status */
  pieces: PullPieceStatus[]
}

// biome-ignore lint/style/noNamespace: namespaced types
export namespace fetchPieces {
  /**
   * Options for pulling pieces from external SPs.
   */
  export type OptionsType = {
    /** The endpoint of the PDP API. */
    endpoint: string
    /** The record keeper contract address (e.g., FWSS). */
    recordKeeper: Address
    /** EIP-712 signed extraData for authorization. */
    extraData: Hex
    /** Optional target dataset ID (omit or 0n to create new). */
    dataSetId?: bigint
    /** Pieces to pull with their source URLs. */
    pieces: PullPieceInput[]
    /** Optional AbortSignal to cancel the request. */
    signal?: AbortSignal
  }

  export type ReturnType = PullResponse

  export type ErrorType = PullError | TimeoutError | NetworkError | AbortError

  export type RequestBody = {
    extraData: Hex
    recordKeeper: Address
    pieces: PullPieceInput[]
    dataSetId?: number
  }
}

/**
 * Build the JSON request body for a pull request.
 */
function buildRequestBody(options: fetchPieces.OptionsType): string {
  const body: fetchPieces.RequestBody = {
    extraData: options.extraData,
    recordKeeper: options.recordKeeper,
    pieces: options.pieces,
  }

  // Only include dataSetId if specified and non-zero
  if (options.dataSetId != null && options.dataSetId > 0n) {
    body.dataSetId = Number(options.dataSetId)
  }

  return JSON.stringify(body)
}

/**
 * Initiate a piece pull request or get status of an existing one.
 *
 * POST /pdp/piece/pull
 *
 * This endpoint is idempotent - calling with the same extraData returns
 * the status of the existing pull rather than creating duplicates.
 * This allows safe retries and status polling using the same request.
 *
 * @param options - {@link fetchPieces.OptionsType}
 * @returns The current status of the pull operation. {@link fetchPieces.ReturnType}
 * @throws Errors {@link fetchPieces.ErrorType}
 */
export async function fetchPieces(options: fetchPieces.OptionsType): Promise<fetchPieces.ReturnType> {
  const response = await request.post(new URL('pdp/piece/pull', options.endpoint), {
    body: buildRequestBody(options),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PullError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as fetchPieces.ReturnType
}

// biome-ignore lint/style/noNamespace: namespaced types
export namespace waitForFetchStatus {
  /**
   * Options for polling pull status.
   */
  export type OptionsType = fetchPieces.OptionsType & {
    /** Callback invoked on each poll with current status. */
    onStatus?: (response: PullResponse) => void
    /** Minimum time between poll attempts in milliseconds (default: 4000). */
    minTimeout?: number
  }

  export type ReturnType = PullResponse

  export type ErrorType = PullError | TimeoutError | NetworkError | AbortError
}

/**
 * Wait for pull completion.
 *
 * Repeatedly calls the pull endpoint until all pieces are complete or any piece fails.
 * Since the endpoint is idempotent, this effectively polls for status updates.
 *
 * @param options - {@link waitForFetchStatus.OptionsType}
 * @returns The final status when complete or failed. {@link waitForFetchStatus.ReturnType}
 * @throws Errors {@link waitForFetchStatus.ErrorType}
 */
export async function waitForFetchStatus(
  options: waitForFetchStatus.OptionsType
): Promise<waitForFetchStatus.ReturnType> {
  const url = new URL('pdp/piece/pull', options.endpoint)
  const body = buildRequestBody(options)
  const headers = { 'Content-Type': 'application/json' }

  // Custom fetch that creates a fresh Request each time to avoid body consumption issues
  // (iso-web creates Request once and reuses it, but POST bodies can only be read once)
  const fetchWithFreshRequest: typeof globalThis.fetch = (input, init) => {
    // iso-web passes the Request object as input, extract signal from it
    const signal = input instanceof Request ? input.signal : init?.signal
    return globalThis.fetch(url, { method: 'POST', body, headers, signal })
  }

  const response = await request.post(url, {
    body,
    headers,
    fetch: fetchWithFreshRequest,
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as PullResponse

        // Invoke status callback if provided
        if (options.onStatus) {
          options.onStatus(data)
        }

        // Stop polling when complete or failed
        if (data.status === 'complete' || data.status === 'failed') {
          return response
        }
        throw new Error('Pull not complete')
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Pull not complete',
      retries: RETRIES,
      factor: FACTOR,
      minTimeout: options.minTimeout ?? MIN_TIMEOUT,
    },
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PullError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as waitForFetchStatus.ReturnType
}
