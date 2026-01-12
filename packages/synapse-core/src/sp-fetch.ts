/**
 * SP-to-SP Piece Fetch Operations
 *
 * Provides functionality to fetch pieces from external storage providers.
 * Uses Curio's POST /pdp/piece/fetch endpoint which is idempotent -
 * repeated calls with the same extraData return the current status
 * rather than creating duplicate requests.
 *
 * @example
 * ```ts
 * import * as spFetch from '@filoz/synapse-core/sp-fetch'
 * ```
 *
 * @module sp-fetch
 */

import { HttpError, request } from 'iso-web/http'
import type { Address, Hex } from 'viem'
import { SPFetchError } from './errors/sp-fetch.ts'

let TIMEOUT = 1000 * 60 * 5 // 5 minutes
const DEFAULT_MIN_TIMEOUT = 4000 // interval between retries in milliseconds
export const RETRIES = Infinity
export const FACTOR = 1

// For testing purposes
export function setTimeout(timeout: number) {
  TIMEOUT = timeout
}

/**
 * Status of a fetch operation or individual piece.
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
export type SPFetchStatus = 'pending' | 'inProgress' | 'retrying' | 'complete' | 'failed'

/**
 * Input piece for a fetch request.
 */
export type SPFetchPieceInput = {
  /** PieceCIDv2 format (encodes both CommP and raw size) */
  pieceCid: string
  /** HTTPS URL to fetch the piece from (must end in /piece/{pieceCid}) */
  sourceUrl: string
}

/**
 * Status of a single piece in a fetch response.
 */
export type SPFetchPieceStatus = {
  /** PieceCIDv2 of the piece */
  pieceCid: string
  /** Current status of this piece */
  status: SPFetchStatus
}

/**
 * Response from a fetch request.
 */
export type SPFetchResponse = {
  /** Overall status (worst-case across all pieces) */
  status: SPFetchStatus
  /** Per-piece status */
  pieces: SPFetchPieceStatus[]
}

/**
 * Options for fetching pieces from external SPs.
 */
export type SPFetchPiecesOptions = {
  /** The endpoint of the PDP API */
  endpoint: string
  /** The record keeper contract address (e.g., FWSS) */
  recordKeeper: Address
  /** EIP-712 signed extraData for authorization */
  extraData: Hex
  /** Optional target dataset ID (omit or 0n to create new) */
  dataSetId?: bigint
  /** Pieces to fetch with their source URLs */
  pieces: SPFetchPieceInput[]
  /** Optional AbortSignal to cancel the request */
  signal?: AbortSignal
}

/**
 * Options for polling fetch status.
 */
export type SPFetchPollOptions = SPFetchPiecesOptions & {
  /** Callback invoked on each poll with current status */
  onStatus?: (response: SPFetchResponse) => void
  /** Minimum time between poll attempts in milliseconds (default: 4000) */
  minTimeout?: number
}

/**
 * Build the JSON request body for a fetch request.
 */
function buildRequestBody(options: SPFetchPiecesOptions): string {
  const body: {
    extraData: Hex
    recordKeeper: Address
    pieces: SPFetchPieceInput[]
    dataSetId?: number
  } = {
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
 * Initiate a piece fetch request or get status of an existing one.
 *
 * POST /pdp/piece/fetch
 *
 * This endpoint is idempotent, calling with the same extraData returns
 * the status of the existing fetch rather than creating duplicates.
 * This allows safe retries and status polling using the same request.
 *
 * @param options - The fetch request options
 * @param options.endpoint - The endpoint of the PDP API
 * @param options.recordKeeper - The record keeper contract address (e.g., FWSS)
 * @param options.extraData - EIP-712 signed extraData for authorization
 * @param options.dataSetId - Optional target dataset ID (omit or 0n to create new)
 * @param options.pieces - Pieces to fetch with their source URLs
 * @param options.signal - Optional AbortSignal to cancel the request
 * @returns The current status of the fetch operation
 */
export async function fetchPieces(options: SPFetchPiecesOptions): Promise<SPFetchResponse> {
  const response = await request.post(new URL('pdp/piece/fetch', options.endpoint), {
    body: buildRequestBody(options),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new SPFetchError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as SPFetchResponse
}

/**
 * Poll for fetch completion.
 *
 * Repeatedly calls the fetch endpoint until all pieces are complete or any piece fails.
 * Since the endpoint is idempotent, this effectively polls for status updates.
 *
 * @param options - The poll options
 * @param options.endpoint - The endpoint of the PDP API
 * @param options.recordKeeper - The record keeper contract address (e.g., FWSS)
 * @param options.extraData - EIP-712 signed extraData for authorization
 * @param options.dataSetId - Optional target dataset ID (omit or 0n to create new)
 * @param options.pieces - Pieces to fetch with their source URLs
 * @param options.signal - Optional AbortSignal to cancel polling
 * @param options.onStatus - Optional callback invoked on each poll with current status
 * @returns The final status when complete or failed
 */
export async function pollStatus(options: SPFetchPollOptions): Promise<SPFetchResponse> {
  const url = new URL('pdp/piece/fetch', options.endpoint)
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
        const data = (await response.clone().json()) as SPFetchResponse

        // Invoke status callback if provided
        if (options.onStatus) {
          options.onStatus(data)
        }

        // Stop polling when complete or failed
        if (data.status === 'complete' || data.status === 'failed') {
          return response
        }
        throw new Error('Fetch not complete')
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Fetch not complete',
      retries: RETRIES,
      factor: FACTOR,
      minTimeout: options.minTimeout ?? DEFAULT_MIN_TIMEOUT,
    },
    timeout: TIMEOUT,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new SPFetchError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as SPFetchResponse
}
