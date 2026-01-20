/**
 * MSW HTTP handlers for SP Pull endpoints
 *
 * These handlers can be used to mock SP-to-SP pull HTTP responses in tests
 */

import { HttpResponse, http } from 'msw'
import type { PullPieceInput, PullResponse, PullStatus } from '../pull.ts'

export interface PullMockOptions {
  baseUrl?: string
  debug?: boolean
}

export interface PullRequestCapture {
  extraData: string
  recordKeeper: string
  dataSetId?: number
  pieces: PullPieceInput[]
}

/**
 * Creates a handler for the fetch pieces endpoint that returns a fixed response
 */
export function fetchPiecesHandler(response: PullResponse, options: PullMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/pull`, async () => {
    if (options.debug) {
      console.debug('SP Pull Mock: returning response', response)
    }
    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler that captures the request body and returns a response
 */
export function fetchPiecesWithCaptureHandler(
  response: PullResponse,
  captureCallback: (request: PullRequestCapture) => void,
  options: PullMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/pull`, async ({ request }) => {
    const body = (await request.json()) as PullRequestCapture

    captureCallback(body)

    if (options.debug) {
      console.debug('SP Pull Mock: captured request', body)
    }

    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler that returns an error response
 */
export function fetchPiecesErrorHandler(errorMessage: string, statusCode = 500, options: PullMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/pull`, async () => {
    if (options.debug) {
      console.debug('SP Pull Mock: returning error', errorMessage)
    }
    return HttpResponse.text(errorMessage, { status: statusCode })
  })
}

/**
 * Creates a handler that simulates polling, returns pending status N times,
 * then returns the final response
 */
export function fetchPiecesPollingHandler(
  pendingCount: number,
  finalResponse: PullResponse,
  options: PullMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  let callCount = 0

  return http.post(`${baseUrl}/pdp/piece/pull`, async () => {
    callCount++

    if (options.debug) {
      console.debug(`SP Fetch Mock: poll attempt ${callCount}/${pendingCount + 1}`)
    }

    if (callCount <= pendingCount) {
      // Return pending status
      const pendingResponse: PullResponse = {
        status: 'pending',
        pieces: finalResponse.pieces.map((p) => ({
          pieceCid: p.pieceCid,
          status: 'pending' as PullStatus,
        })),
      }
      return HttpResponse.json(pendingResponse, { status: 200 })
    }

    // Return final response
    return HttpResponse.json(finalResponse, { status: 200 })
  })
}

/**
 * Creates a handler that simulates a progression through statuses
 */
export function fetchPiecesProgressionHandler(
  statusProgression: PullStatus[],
  pieces: Array<{ pieceCid: string }>,
  options: PullMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  let callCount = 0

  return http.post(`${baseUrl}/pdp/piece/pull`, async () => {
    const statusIndex = Math.min(callCount, statusProgression.length - 1)
    const currentStatus = statusProgression[statusIndex]
    callCount++

    if (options.debug) {
      console.debug(`SP Fetch Mock: returning status ${currentStatus} (call ${callCount})`)
    }

    const response: PullResponse = {
      status: currentStatus,
      pieces: pieces.map((p) => ({
        pieceCid: p.pieceCid,
        status: currentStatus,
      })),
    }

    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Helper to create a complete PullResponse
 */
export function createPullResponse(
  status: PullStatus,
  pieces: Array<{ pieceCid: string; status?: PullStatus }>
): PullResponse {
  return {
    status,
    pieces: pieces.map((p) => ({
      pieceCid: p.pieceCid,
      status: p.status ?? status,
    })),
  }
}
