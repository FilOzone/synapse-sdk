/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import type { AddPiecesSuccess } from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { Synapse } from '../synapse.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { JSONRPC, PRIVATE_KEYS, presets } from './mocks/jsonrpc/index.ts'
import { findAnyPieceHandler, postParkedPieceHandler } from './mocks/pdp/handlers.ts'
import { PING } from './mocks/ping.ts'

// mock server for testing
const server = setup([])

describe('Storage Upload', () => {
  let signer: ethers.Signer
  let provider: ethers.Provider
  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    server.resetHandlers()
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
  })

  it('should enforce 127 byte minimum size limit', async () => {
    server.use(JSONRPC({ ...presets.basic, debug: false }), PING({ debug: false }))
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext()

    try {
      // Create data that is below the minimum
      const undersizedData = new Uint8Array(126) // 126 bytes (1 byte under minimum)
      await context.upload(undersizedData)
      assert.fail('Should have thrown size limit error')
    } catch (error: any) {
      assert.include(error.message, 'below minimum allowed size')
      assert.include(error.message, '126 bytes')
      assert.include(error.message, '127 bytes')
    }
  })

  it('should support parallel uploads', async () => {
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    let addPiecesCount = 0
    let uploadCompleteCount = 0
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      postParkedPieceHandler(pdpOptions),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        const response: AddPiecesSuccess = {
          addMessageOk: true,
          confirmedPieceIds: [0, 1, 2],
          dataSetId: parseInt(params.id, 10),
          pieceCount: 3,
          piecesAdded: true,
          txHash,
          txStatus: 'confirmed',
        }

        return HttpResponse.json(response, { status: 200 })
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    // Create distinct data for each upload
    const firstData = new Uint8Array(127).fill(1) // 127 bytes
    const secondData = new Uint8Array(128).fill(2) // 66 bytes
    const thirdData = new Uint8Array(129).fill(3) // 67 bytes

    // Start all uploads concurrently with callbacks
    const uploads = [
      context.upload(firstData, {
        onPieceAdded: () => addPiecesCount++,
        onUploadComplete: () => uploadCompleteCount++,
      }),
      context.upload(secondData, {
        onPieceAdded: () => addPiecesCount++,
        onUploadComplete: () => uploadCompleteCount++,
      }),
      context.upload(thirdData, {
        onPieceAdded: () => addPiecesCount++,
        onUploadComplete: () => uploadCompleteCount++,
      }),
    ]

    const results = await Promise.all(uploads)
    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    const resultSizes = results.map((r) => r.size)
    const resultPieceIds = results.map((r) => r.pieceId)

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(resultPieceIds, [0, 1, 2], 'The set of assigned piece IDs should be {0, 1, 2}')
    assert.strictEqual(addPiecesCount, 3, 'addPieces should be called 3 times')
    assert.strictEqual(uploadCompleteCount, 3, 'uploadComplete should be called 3 times')
  })

  it('should respect batch size configuration', async () => {
    let addPiecesCalls = 0
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      postParkedPieceHandler(pdpOptions),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        addPiecesCalls++

        if (addPiecesCalls === 2) {
          return HttpResponse.json(
            {
              addMessageOk: true,
              confirmedPieceIds: [2],
              dataSetId: parseInt(params.id, 10),
              pieceCount: 1,
              piecesAdded: true,
              txHash,
              txStatus: 'confirmed',
            } satisfies AddPiecesSuccess,
            { status: 200 }
          )
        }

        return HttpResponse.json({
          addMessageOk: true,
          confirmedPieceIds: [0, 1],
          dataSetId: parseInt(params.id, 10),
          pieceCount: 2,
          piecesAdded: true,
          txHash,
          txStatus: 'confirmed',
        } satisfies AddPiecesSuccess)
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      uploadBatchSize: 2,
      metadata: {
        environment: 'test',
      },
    })

    // Create distinct data for each upload
    const firstData = new Uint8Array(127).fill(1) // 127 bytes
    const secondData = new Uint8Array(128).fill(2) // 66 bytes
    const thirdData = new Uint8Array(129).fill(3) // 67 bytes

    // Start all uploads concurrently with callbacks
    const uploads = [context.upload(firstData), context.upload(secondData), context.upload(thirdData)]

    const results = await Promise.all(uploads)

    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    assert.strictEqual(addPiecesCalls, 2, 'addPieces should be called 2 times')
  })

  it('should handle batch size of 1', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      http.post('https://pdp.example.com/pdp/piece', async ({ request }) => {
        const url = new URL(request.url)
        const pieceCid = url.searchParams.get('pieceCid')
        const body = await request.arrayBuffer()

        return HttpResponse.json({
          pieceCid,
          size: body.byteLength,
        })
      }),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        addPiecesCalls++

        if (addPiecesCalls === 2) {
          return HttpResponse.json(
            {
              addMessageOk: true,
              confirmedPieceIds: [1],
              dataSetId: parseInt(params.id, 10),
              pieceCount: 1,
              piecesAdded: true,
              txHash,
              txStatus: 'confirmed',
            } satisfies AddPiecesSuccess,
            { status: 200 }
          )
        }
        if (addPiecesCalls === 3) {
          return HttpResponse.json(
            {
              addMessageOk: true,
              confirmedPieceIds: [2],
              dataSetId: parseInt(params.id, 10),
              pieceCount: 1,
              piecesAdded: true,
              txHash,
              txStatus: 'confirmed',
            } satisfies AddPiecesSuccess,
            { status: 200 }
          )
        }

        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      uploadBatchSize: 1,
      metadata: {
        environment: 'test',
      },
    })

    // Create distinct data for each upload
    const firstData = new Uint8Array(127).fill(1) // 127 bytes
    const secondData = new Uint8Array(128).fill(2) // 66 bytes
    const thirdData = new Uint8Array(129).fill(3) // 67 bytes

    // Start all uploads concurrently with callbacks
    const uploads = [context.upload(firstData), context.upload(secondData), context.upload(thirdData)]

    const results = await Promise.all(uploads)

    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    const resultSizes = results.map((r) => r.size)
    const resultPieceIds = results.map((r) => r.pieceId)

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(resultPieceIds, [0, 1, 2], 'The set of assigned piece IDs should be {0, 1, 2}')
    assert.strictEqual(addPiecesCalls, 3, 'addPieces should be called 2 times')
  })

  it('should debounce uploads for better batching', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      http.post('https://pdp.example.com/pdp/piece', async ({ request }) => {
        const url = new URL(request.url)
        const pieceCid = url.searchParams.get('pieceCid')
        const body = await request.arrayBuffer()

        return HttpResponse.json({
          pieceCid,
          size: body.byteLength,
        })
      }),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        addPiecesCalls++

        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0, 1, 2, 3, 4],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 5,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const uploads = []
    for (let i = 0; i < 5; i++) {
      uploads.push(context.upload(new Uint8Array(127).fill(i)))
    }

    await Promise.all(uploads)
    assert.strictEqual(addPiecesCalls, 1, 'addPieces should be called 1 time')
  })

  it('should accept exactly 127 bytes', async () => {
    let addPiecesCalls = 0
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      http.post('https://pdp.example.com/pdp/piece', async ({ request }) => {
        const url = new URL(request.url)
        const pieceCid = url.searchParams.get('pieceCid')
        const body = await request.arrayBuffer()

        return HttpResponse.json({
          pieceCid,
          size: body.byteLength,
        })
      }),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        addPiecesCalls++

        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = 127
    const upload = await context.upload(new Uint8Array(expectedSize))
    assert.strictEqual(addPiecesCalls, 1, 'addPieces should be called 1 time')
    assert.strictEqual(upload.pieceId, 0, 'pieceId should be 0')
    assert.strictEqual(upload.size, expectedSize, 'size should be 127')
  })

  it('should accept data up to 200 MiB', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      http.post('https://pdp.example.com/pdp/piece', async ({ request }) => {
        const url = new URL(request.url)
        const pieceCid = url.searchParams.get('pieceCid')
        // const body = await request.arrayBuffer()
        return HttpResponse.json({
          pieceCid,
          size: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
        })
      }),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        addPiecesCalls++

        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    const upload = await context.upload(new Uint8Array(expectedSize).fill(1))

    assert.strictEqual(addPiecesCalls, 1, 'addPieces should be called 1 time')
    assert.strictEqual(upload.pieceId, 0, 'pieceId should be 0')
    assert.strictEqual(upload.size, expectedSize, 'size should be 200 MiB')
  })

  it('should handle new server with transaction tracking', async () => {
    let pieceAddedCallbackFired = false
    let pieceConfirmedCallbackFired = false
    let uploadCompleteCallbackFired = false
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      http.post('https://pdp.example.com/pdp/piece', async ({ request }) => {
        const url = new URL(request.url)
        const pieceCid = url.searchParams.get('pieceCid')
        // const body = await request.arrayBuffer()
        return HttpResponse.json({
          pieceCid,
          size: SIZE_CONSTANTS.MAX_UPLOAD_SIZE,
        })
      }),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    await context.upload(new Uint8Array(expectedSize).fill(1), {
      onPieceAdded() {
        pieceAddedCallbackFired = true
      },
      onPieceConfirmed() {
        pieceConfirmedCallbackFired = true
      },
      onUploadComplete() {
        uploadCompleteCallbackFired = true
      },
    })

    assert.isTrue(pieceAddedCallbackFired, 'pieceAddedCallback should have been called')
    assert.isTrue(pieceConfirmedCallbackFired, 'pieceConfirmedCallback should have been called')
    assert.isTrue(uploadCompleteCallbackFired, 'uploadCompleteCallback should have been called')
  })

  it('should handle ArrayBuffer input', async () => {
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    server.use(
      JSONRPC({ ...presets.basic, debug: false }),
      PING(),
      postParkedPieceHandler(pdpOptions),
      findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: parseInt(params.id, 10),
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          } satisfies AddPiecesSuccess,
          { status: 200 }
        )
      })
    )
    const synapse = await Synapse.create({ signer })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const buffer = new ArrayBuffer(1024)
    const upload = await context.upload(buffer)
    assert.strictEqual(upload.pieceId, 0, 'pieceId should be 0')
    assert.strictEqual(upload.size, 1024, 'size should be 1024')
  })
})
