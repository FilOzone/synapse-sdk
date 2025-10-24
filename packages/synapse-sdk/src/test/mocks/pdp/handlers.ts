/**
 * MSW HTTP handlers for PDP Server endpoints
 *
 * These handlers can be used to mock PDP Server HTTP responses in tests
 */

import { ethers } from 'ethers'
import { HttpResponse, http } from 'msw'
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

/**
 * Creates a handler for successful data set creation
 */
export function createDataSetHandler(txHash: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post(`${baseUrl}/pdp/data-sets`, async ({ request }) => {
    if (options.debug) {
      const body = await request.json()
      console.debug('PDP Mock: createDataSet request', body)
    }

    // Validate that request contains required fields
    const body = (await request.json()) as any
    if (!body.extraData) {
      return new HttpResponse(JSON.stringify({ error: 'Missing extraData' }), { status: 400 })
    }

    // Parse extraData to verify metadata encoding
    try {
      const abiCoder = ethers.AbiCoder.defaultAbiCoder()
      const decoded = abiCoder.decode(['address', 'string[]', 'string[]', 'bytes'], body.extraData)

      if (options.debug) {
        console.debug('PDP Mock: decoded metadata keys', decoded[1])
        console.debug('PDP Mock: decoded metadata values', decoded[2])
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
 * Creates a handler for successful piece addition
 */
export function addPiecesHandler(dataSetId: number, txHash: string, options: PDPMockOptions = {}) {
  const baseUrl = options.baseUrl ?? 'http://pdp.local'

  return http.post<{ id: string }, PDPAddPiecesInput>(
    `${baseUrl}/pdp/data-sets/:id/pieces`,
    async ({ params, request }) => {
      if (params.id !== dataSetId.toString()) {
        return new HttpResponse(null, { status: 404 })
      }

      const body = await request.json()

      if (options.debug) {
        console.debug('PDP Mock: addPieces request', body)
      }

      // Validate that request contains required fields
      if (!body.extraData) {
        return new HttpResponse(JSON.stringify({ error: 'Missing extraData' }), { status: 400 })
      }

      // Parse extraData to verify metadata encoding
      try {
        const abiCoder = ethers.AbiCoder.defaultAbiCoder()
        const decoded = abiCoder.decode(['bytes', 'string[][]', 'string[][]'], body.extraData)

        if (options.debug) {
          console.debug('PDP Mock: decoded piece metadata', decoded[1])
          console.debug('PDP Mock: decoded piece metadata values', decoded[2])
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

/**
 * Creates a handler for data set creation status check
 */
export function dataSetCreationStatusHandler(
  txHash: string,
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
  txHash: string,
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

  return http.get(`${baseUrl}/pdp/piece/`, ({ request }) => {
    const url = new URL(request.url)
    const queryCid = url.searchParams.get('pieceCid')

    if (queryCid !== pieceCid) {
      return HttpResponse.json({ pieceCid: null }, { status: 200 })
    }

    if (!found) {
      return HttpResponse.json({ pieceCid: null }, { status: 200 })
    }

    return HttpResponse.json({ pieceCid }, { status: 200 })
  })
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
  txHash: string,
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
  txHash: string,
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
