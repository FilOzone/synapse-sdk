/**
 * MSW HTTP handlers for PDP Server endpoints
 *
 * These handlers can be used to mock PDP Server HTTP responses in tests
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { HttpResponse, http } from 'msw'
import type { Hex } from 'viem'
import type { PDPAddPiecesInput } from '../../../pdp/server.ts'

export interface PDPMockOptions {
  baseUrl?: string
  debug?: boolean
}

export interface MetadataCapture {
  keys: string[]
  values: string[]
}

export interface PieceMetadataCapture {
  keys: string[][]
  values: string[][]
}

export function createAndAddPiecesHandler(txHash: Hex, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.post(`${baseUrl}/pdp/data-sets/create-and-add`, () => {
    return new HttpResponse(null, {
      status: 201,
      headers: { Location: `/pdp/data-sets/created/${txHash}` },
    })
  })
}

/**
 * Creates a handler for data set creation status check
 */
export function dataSetCreationStatusHandler(
  txHash: Hex,
  response: {
    createMessageHash: string
    dataSetCreated: boolean
    service: string
    txStatus: string
    ok: boolean | null
    dataSetId?: number
  },
  options: PDPMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.get(`${baseUrl}/pdp/data-sets/created/:txHash`, ({ params }) => {
    if (params.txHash !== txHash) {
      return new HttpResponse(null, { status: 404 })
    }

    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler for piece addition status check
 */
export function pieceAdditionStatusHandler(
  dataSetId: number,
  txHash: Hex,
  response: any,
  options: PDPMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.get(`${baseUrl}/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
    if (params.id !== dataSetId.toString() || params.txHash !== txHash) {
      return new HttpResponse(null, { status: 404 })
    }

    return HttpResponse.json(response, { status: 200 })
  })
}

/**
 * Creates a handler for finding pieces
 */
export function findPieceHandler(pieceCid: string, found: boolean, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.get(`${baseUrl}/pdp/piece`, ({ request }) => {
    const url = new URL(request.url)
    const queryCid = url.searchParams.get('pieceCid')

    if (queryCid !== pieceCid) {
      return HttpResponse.text(null, { status: 404 })
    }

    if (!found) {
      return HttpResponse.text(null, { status: 404 })
    }

    return HttpResponse.json({ pieceCid }, { status: 200 })
  })
}

export function findAnyPieceHandler(found: boolean, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.get(`${baseUrl}/pdp/piece`, ({ request }) => {
    const url = new URL(request.url)
    const queryCid = url.searchParams.get('pieceCid')
    if (found) {
      return HttpResponse.json({ pieceCid: queryCid })
    } else {
      return HttpResponse.text(null, { status: 404 })
    }
  })
}

/**
 * Creates a handler that supports only one pieceCid
 * Returns a UUID for 201, or a CID for 200
 */
export function postPieceHandler(pieceCid: string, uuid?: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.post<Record<string, never>, { pieceCid: string }>(`${baseUrl}/pdp/piece`, async ({ request }) => {
    const body = await request.json()
    assert.isDefined(body)
    assert.isNotNull(body)
    assert.exists(body.pieceCid)
    assert.equal(body.pieceCid, pieceCid)
    if (uuid == null) {
      // parked piece found
      return HttpResponse.json({
        pieceCid,
      })
    }
    // Piece does not exist, proceed to create a new upload request
    return HttpResponse.text('Created', {
      status: 201,
      headers: {
        Location: `/pdp/piece/upload/${uuid}`,
      },
    })
  })
}

export function uploadPieceHandler(uuid: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.put(`${baseUrl}/pdp/piece/upload/${uuid}`, async () => {
    return HttpResponse.text('No Content', {
      status: 204,
    })
  })
}

/**
 * Creates a handler for the streaming upload protocol (commp-last)
 * POST /pdp/piece/uploads - creates upload session, returns UUID
 * Note: This endpoint doesn't require a request body
 */
export function postPieceUploadsHandler(uuid: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.post(`${baseUrl}/pdp/piece/uploads`, async () => {
    // Create upload session, return UUID in Location header
    return HttpResponse.text('Created', {
      status: 201,
      headers: {
        Location: `/pdp/piece/uploads/${uuid}`,
      },
    })
  })
}

/**
 * Creates a handler for uploading piece data via streaming protocol
 * PUT /pdp/piece/uploads/:uuid - streams piece data
 */
export function uploadPieceStreamingHandler(uuid: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.put(`${baseUrl}/pdp/piece/uploads/${uuid}`, async () => {
    return HttpResponse.text('No Content', {
      status: 204,
    })
  })
}

/**
 * Creates a handler for finalizing a streaming upload
 * POST /pdp/piece/uploads/:uuid - finalize with PieceCID
 */
export function finalizePieceUploadHandler(uuid: string, expectedPieceCid?: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  return http.post<{ uuid: string }, { pieceCid: string }>(
    `${baseUrl}/pdp/piece/uploads/${uuid}`,
    async ({ request }) => {
      const body = await request.json()

      if (expectedPieceCid != null) {
        assert.equal(body.pieceCid, expectedPieceCid, 'PieceCID should match expected value')
      }

      return HttpResponse.json(
        { pieceCid: body.pieceCid },
        {
          status: 200,
        }
      )
    }
  )
}

/**
 * Creates handlers for the complete streaming upload flow (all piece CIDs accepted)
 * Returns array of handlers for: POST /pdp/piece/uploads, PUT /pdp/piece/uploads/:uuid, POST /pdp/piece/uploads/:uuid
 */
export function streamingUploadHandlers(options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'
  let uploadCounter = 0

  return [
    // Step 1: Create upload session
    http.post(`${baseUrl}/pdp/piece/uploads`, async () => {
      // Generate UUID format: 8-4-4-4-12 hex digits
      const uuid = `${(++uploadCounter).toString(16).padStart(8, '0')}-0000-0000-0000-000000000000`
      return HttpResponse.text('Created', {
        status: 201,
        headers: {
          Location: `/pdp/piece/uploads/${uuid}`,
        },
      })
    }),

    // Step 2: Upload data stream
    http.put(`${baseUrl}/pdp/piece/uploads/:uuid`, async () => {
      return HttpResponse.text('No Content', {
        status: 204,
      })
    }),

    // Step 3: Finalize with PieceCID
    http.post<{ uuid: string }, { pieceCid: string }>(`${baseUrl}/pdp/piece/uploads/:uuid`, async ({ request }) => {
      const body = await request.json()
      return HttpResponse.json(
        { pieceCid: body.pieceCid },
        {
          status: 200,
        }
      )
    }),
  ]
}

/**
 * Helper to decode metadata from extraData
 */
export function decodeMetadataFromCreateDataSetExtraData(extraData: string): MetadataCapture {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const decoded = abiCoder.decode(['address', 'uint256', 'string[]', 'string[]', 'bytes'], extraData)
  return {
    keys: decoded[2] as string[],
    values: decoded[3] as string[],
  }
}

/**
 * Helper to decode piece metadata from extraData
 * Format: (uint256 nonce, string[][] keys, string[][] values, bytes signature)
 */
export function decodePieceMetadataFromExtraData(extraData: string): PieceMetadataCapture {
  const abiCoder = ethers.AbiCoder.defaultAbiCoder()
  const decoded = abiCoder.decode(['uint256', 'string[][]', 'string[][]', 'bytes'], extraData)
  return {
    keys: decoded[1] as string[][],
    values: decoded[2] as string[][],
  }
}

/**
 * Creates a handler that captures metadata from createDataSet requests
 * @param txHash - Transaction hash to return in Location header
 * @param captureCallback - Callback to store captured metadata
 * @param options - Additional options
 */
export function createDataSetWithMetadataCapture(
  txHash: Hex,
  captureCallback: (metadata: MetadataCapture) => void,
  options: PDPMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/data-sets`, async ({ request }) => {
    const body = (await request.json()) as any

    if (!body.extraData) {
      return new HttpResponse(JSON.stringify({ error: 'Missing extraData' }), { status: 400 })
    }

    try {
      const metadata = decodeMetadataFromCreateDataSetExtraData(body.extraData)
      captureCallback(metadata)

      if (options.debug) {
        console.debug('PDP Mock: captured metadata', metadata)
      }
    } catch (error) {
      if (options.debug) {
        console.debug('PDP Mock: failed to decode extraData', error)
      }
    }

    return new HttpResponse(null, {
      status: 201,
      headers: { Location: `/pdp/data-sets/created/${txHash}` },
    })
  })
}

/**
 * Creates a handler that captures piece metadata from addPieces requests
 * @param dataSetId - Data set ID to match
 * @param txHash - Transaction hash to return in Location header
 * @param captureCallback - Callback to store captured metadata
 * @param options - Additional options
 */
export function addPiecesWithMetadataCapture(
  dataSetId: number,
  txHash: Hex,
  captureCallback: (metadata: PieceMetadataCapture) => void,
  options: PDPMockOptions = {}
) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post<{ id: string }, PDPAddPiecesInput>(
    `${baseUrl}/pdp/data-sets/:id/pieces`,
    async ({ params, request }) => {
      if (params.id !== dataSetId.toString()) {
        return new HttpResponse(null, { status: 404 })
      }

      const body = await request.json()

      if (!body.extraData) {
        return new HttpResponse(JSON.stringify({ error: 'Missing extraData' }), { status: 400 })
      }

      try {
        const metadata = decodePieceMetadataFromExtraData(body.extraData)
        captureCallback(metadata)

        if (options.debug) {
          console.debug('PDP Mock: captured piece metadata', metadata)
        }
      } catch (error) {
        if (options.debug) {
          console.debug('PDP Mock: failed to decode extraData', error)
        }
      }

      return new HttpResponse(null, {
        status: 201,
        headers: { Location: `/pdp/data-sets/${dataSetId}/pieces/added/${txHash}` },
      })
    }
  )
}
