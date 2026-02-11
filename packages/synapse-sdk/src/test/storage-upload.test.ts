/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { type Chain, calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { type Account, type Client, createWalletClient, type Hex, type Transport, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Synapse } from '../synapse.ts'
import type { PieceCID, PieceRecord } from '../types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'

// mock server for testing
const server = setup()

describe('Storage Upload', () => {
  let client: Client<Transport, Chain, Account>
  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    server.resetHandlers()
  })

  it('should support parallel uploads', async () => {
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    let uploadCompleteCount = 0
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(),
      Mocks.pdp.findAnyPieceHandler(true),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        const response = {
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
    const synapse = new Synapse({ client })
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
        onUploadComplete: () => uploadCompleteCount++,
      }),
      context.upload(secondData, {
        onUploadComplete: () => uploadCompleteCount++,
      }),
      context.upload(thirdData, {
        onUploadComplete: () => uploadCompleteCount++,
      }),
    ]

    const results = await Promise.all(uploads)
    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    const resultSizes = results.map((r) => r.size)
    const resultPieceIds = results.map((r) => r.pieceId)

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(resultPieceIds, [0n, 1n, 2n], 'The set of assigned piece IDs should be {0, 1, 2}')
    assert.strictEqual(uploadCompleteCount, 3, 'uploadComplete should be called 3 times')
  })

  it('should respect batch size configuration', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(),
      Mocks.pdp.findAnyPieceHandler(true),
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
            },
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
        })
      })
    )
    const synapse = new Synapse({ client })
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
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
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
            },
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
            },
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
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
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
    assert.deepEqual(resultPieceIds, [0n, 1n, 2n], 'The set of assigned piece IDs should be {0, 1, 2}')
    assert.strictEqual(addPiecesCalls, 3, 'addPieces should be called 2 times')
  })

  it('should debounce uploads for better batching', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
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
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
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
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
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
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = 127
    const upload = await context.upload(new Uint8Array(expectedSize))
    assert.strictEqual(addPiecesCalls, 1, 'addPieces should be called 1 time')
    assert.strictEqual(upload.pieceId, 0n, 'pieceId should be 0')
    assert.strictEqual(upload.size, expectedSize, 'size should be 127')
  })

  it('should accept data up to 200 MiB', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
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
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    const upload = await context.upload(new Uint8Array(expectedSize).fill(1))

    assert.strictEqual(addPiecesCalls, 1, 'addPieces should be called 1 time')
    assert.strictEqual(upload.pieceId, 0n, 'pieceId should be 0')
    assert.strictEqual(upload.size, expectedSize, 'size should be 200 MiB')
  })

  it('should handle new server with transaction tracking', async () => {
    let piecesAddedArgs: { transaction?: Hex; pieces?: Array<{ pieceCid: PieceCID }> } | null = null
    let piecesConfirmedArgs: { dataSetId?: bigint; pieces?: PieceRecord[] } | null = null
    let uploadCompleteCallbackFired = false
    let resolvedDataSetId: number | undefined
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
      http.post<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces`, async ({ params }) => {
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
          },
        })
      }),
      http.get<{ id: string }>(`https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`, ({ params }) => {
        resolvedDataSetId = parseInt(params.id, 10)
        return HttpResponse.json(
          {
            addMessageOk: true,
            confirmedPieceIds: [0],
            dataSetId: resolvedDataSetId,
            pieceCount: 1,
            piecesAdded: true,
            txHash,
            txStatus: 'confirmed',
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    const uploadResult = await context.upload(new Uint8Array(expectedSize).fill(1), {
      onPiecesAdded(transaction: Hex | undefined, pieces: Array<{ pieceCid: PieceCID }> | undefined) {
        piecesAddedArgs = { transaction, pieces }
      },
      onPiecesConfirmed(dataSetId: bigint, pieces: PieceRecord[]) {
        piecesConfirmedArgs = { dataSetId, pieces }
      },
      onUploadComplete() {
        uploadCompleteCallbackFired = true
      },
    })

    assert.isTrue(uploadCompleteCallbackFired, 'uploadCompleteCallback should have been called')
    assert.isNotNull(piecesAddedArgs, 'onPiecesAdded args should be captured')
    assert.isNotNull(piecesConfirmedArgs, 'onPiecesConfirmed args should be captured')
    if (piecesAddedArgs == null || piecesConfirmedArgs == null) {
      throw new Error('Callbacks should have been called')
    }
    const addedArgs: { transaction?: Hex; pieces?: Array<{ pieceCid: PieceCID }> } = piecesAddedArgs
    const confirmedArgs: { dataSetId?: bigint; pieces?: PieceRecord[] } = piecesConfirmedArgs
    assert.strictEqual(addedArgs.transaction, txHash, 'onPiecesAdded should receive transaction hash')
    assert.strictEqual(
      addedArgs.pieces?.[0].pieceCid.toString(),
      uploadResult.pieceCid.toString(),
      'onPiecesAdded should provide matching pieceCid'
    )
    assert.isDefined(resolvedDataSetId, 'resolvedDataSetId should be defined')
    assert.strictEqual(
      confirmedArgs.dataSetId,
      BigInt(resolvedDataSetId),
      'onPiecesConfirmed should provide the dataset id'
    )
    assert.strictEqual(confirmedArgs.pieces?.[0].pieceId, 0n, 'onPiecesConfirmed should include piece IDs')
  })

  it('should handle ArrayBuffer input', async () => {
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef123456'
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
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
          },
          { status: 200 }
        )
      })
    )
    const synapse = new Synapse({ client })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const buffer = new Uint8Array(1024)
    const upload = await context.upload(buffer)
    assert.strictEqual(upload.pieceId, 0n, 'pieceId should be 0')
    assert.strictEqual(upload.size, 1024, 'size should be 1024')
  })
})
