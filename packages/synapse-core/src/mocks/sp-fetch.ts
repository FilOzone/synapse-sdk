/**
 * MSW HTTP handlers for SP Fetch endpoints
 *
 * These handlers can be used to mock SP-to-SP fetch HTTP responses in tests
 */

import { HttpResponse, http } from 'msw'
import type { SPFetchPieceInput, SPFetchResponse, SPFetchStatus } from '../sp-fetch.ts'

export interface SPFetchMockOptions {
  baseUrl?: string
  debug?: boolean
}

export interface SPFetchRequestCapture {
  extraData: string
  recordKeeper: string
  dataSetId?: number
  pieces: SPFetchPieceInput[]
}

/**
 * Creates a handler for the fetch pieces endpoint that returns a fixed response
 */
export function fetchPiecesHandler(response: SPFetchResponse, options: SPFetchMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/fetch`, async () => {
    if (options.debug) {
      console.debug('SP Fetch Mock: returning response', response)
    }
    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler that captures the request body and returns a response
 */
export function fetchPiecesWithCaptureHandler(
  response: SPFetchResponse,
  captureCallback: (request: SPFetchRequestCapture) => void,
  options: SPFetchMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/fetch`, async ({ request }) => {
    const body = (await request.json()) as SPFetchRequestCapture

    captureCallback(body)

    if (options.debug) {
      console.debug('SP Fetch Mock: captured request', body)
    }

    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler that returns an error response
 */
export function fetchPiecesErrorHandler(errorMessage: string, statusCode = 500, options: SPFetchMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/piece/fetch`, async () => {
    if (options.debug) {
      console.debug('SP Fetch Mock: returning error', errorMessage)
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
  finalResponse: SPFetchResponse,
  options: SPFetchMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  let callCount = 0

  return http.post(`${baseUrl}/pdp/piece/fetch`, async () => {
    callCount++

    if (options.debug) {
      console.debug(`SP Fetch Mock: poll attempt ${callCount}/${pendingCount + 1}`)
    }

    if (callCount <= pendingCount) {
      // Return pending status
      const pendingResponse: SPFetchResponse = {
        status: 'pending',
        pieces: finalResponse.pieces.map((p) => ({
          pieceCid: p.pieceCid,
          status: 'pending' as SPFetchStatus,
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
  statusProgression: SPFetchStatus[],
  pieces: Array<{ pieceCid: string }>,
  options: SPFetchMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  let callCount = 0

  return http.post(`${baseUrl}/pdp/piece/fetch`, async () => {
    const statusIndex = Math.min(callCount, statusProgression.length - 1)
    const currentStatus = statusProgression[statusIndex]
    callCount++

    if (options.debug) {
      console.debug(`SP Fetch Mock: returning status ${currentStatus} (call ${callCount})`)
    }

    const response: SPFetchResponse = {
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
 * Helper to create a complete SPFetchResponse
 */
export function createFetchResponse(
  status: SPFetchStatus,
  pieces: Array<{ pieceCid: string; status?: SPFetchStatus }>
): SPFetchResponse {
  return {
    status,
    pieces: pieces.map((p) => ({
      pieceCid: p.pieceCid,
      status: p.status ?? status,
    })),
  }
}
