/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { type Chain, calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import type { AddPiecesSuccess } from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { type Account, type Client, createWalletClient, type Transport, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Synapse } from '../synapse.ts'
import type { PieceCID } from '../types.ts'
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
    server.resetHandlers()
  })

  it('should enforce 127 byte minimum size limit', async () => {
    server.use(Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false }), Mocks.PING({ debug: false }))
    client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    const synapse = new Synapse({ client })
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
    let confirmedCount = 0
    let storedCount = 0
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
      http.get<{ id: string }>(
        `https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash`,
        (() => {
          let pieceIdCounter = 0
          return ({ params }) => {
            // Each upload commits separately, so return incrementing piece IDs
            const pieceId = pieceIdCounter++
            const response: AddPiecesSuccess = {
              addMessageOk: true,
              confirmedPieceIds: [pieceId],
              dataSetId: parseInt(params.id, 10),
              pieceCount: 1,
              piecesAdded: true,
              txHash,
              txStatus: 'confirmed',
            }

            return HttpResponse.json(response, { status: 200 })
          }
        })()
      )
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
    const secondData = new Uint8Array(128).fill(2) // 128 bytes
    const thirdData = new Uint8Array(129).fill(3) // 129 bytes

    // Start all uploads concurrently with callbacks
    const uploads = [
      context.upload(firstData, {
        onPieceConfirmed: () => confirmedCount++,
        onStored: () => storedCount++,
      }),
      context.upload(secondData, {
        onPieceConfirmed: () => confirmedCount++,
        onStored: () => storedCount++,
      }),
      context.upload(thirdData, {
        onPieceConfirmed: () => confirmedCount++,
        onStored: () => storedCount++,
      }),
    ]

    const results = await Promise.all(uploads)
    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    const resultSizes = results.map((r) => r.size)
    // Piece IDs may be assigned in any order due to concurrent commits
    const resultPieceIds = results.map((r) => r.copies[0].pieceId).sort()

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(resultPieceIds, [0n, 1n, 2n], 'The set of assigned piece IDs should be {0, 1, 2}')
    assert.strictEqual(confirmedCount, 3, 'onPieceConfirmed should be called 3 times')
    assert.strictEqual(storedCount, 3, 'onStored should be called 3 times')
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
          } satisfies AddPiecesSuccess,
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
    assert.strictEqual(upload.copies[0].pieceId, 0n, 'pieceId should be 0')
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
          } satisfies AddPiecesSuccess,
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
    assert.strictEqual(upload.copies[0].pieceId, 0n, 'pieceId should be 0')
    assert.strictEqual(upload.size, expectedSize, 'size should be 200 MiB')
  })

  it('should fire onStored, onPieceAdded and onPieceConfirmed callbacks', async () => {
    let storedArgs: { providerId?: bigint; pieceCid?: PieceCID } | null = null
    let addedArgs: { providerId?: bigint; pieceCid?: PieceCID } | null = null
    let confirmedArgs: { providerId?: bigint; pieceCid?: PieceCID; pieceId?: bigint } | null = null
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
    const synapse = new Synapse({ client })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    const uploadResult = await context.upload(new Uint8Array(expectedSize).fill(1), {
      onStored(providerId: bigint, pieceCid: PieceCID) {
        storedArgs = { providerId, pieceCid }
      },
      onPieceAdded(providerId: bigint, pieceCid: PieceCID) {
        addedArgs = { providerId, pieceCid }
      },
      onPieceConfirmed(providerId: bigint, pieceCid: PieceCID, pieceId: bigint) {
        confirmedArgs = { providerId, pieceCid, pieceId }
      },
    })

    assert.isNotNull(storedArgs, 'onStored should have been called')
    assert.isNotNull(addedArgs, 'onPieceAdded should have been called')
    assert.isNotNull(confirmedArgs, 'onPieceConfirmed should have been called')
    if (storedArgs == null || addedArgs == null || confirmedArgs == null) {
      throw new Error('Callbacks should have been called')
    }
    const stored: { providerId?: bigint; pieceCid?: PieceCID } = storedArgs
    const added: { providerId?: bigint; pieceCid?: PieceCID } = addedArgs
    const confirmed: { providerId?: bigint; pieceCid?: PieceCID; pieceId?: bigint } = confirmedArgs
    assert.strictEqual(
      stored.pieceCid?.toString(),
      uploadResult.pieceCid.toString(),
      'onStored should receive the pieceCid'
    )
    assert.strictEqual(
      added.pieceCid?.toString(),
      uploadResult.pieceCid.toString(),
      'onPieceAdded should receive the pieceCid'
    )
    assert.strictEqual(
      confirmed.pieceCid?.toString(),
      uploadResult.pieceCid.toString(),
      'onPieceConfirmed should receive the pieceCid'
    )
    assert.strictEqual(confirmed.pieceId, 0n, 'onPieceConfirmed should receive the pieceId')
    assert.strictEqual(
      stored.providerId,
      added.providerId,
      'providerId should be consistent across onStored and onPieceAdded'
    )
    assert.strictEqual(
      added.providerId,
      confirmed.providerId,
      'providerId should be consistent across onPieceAdded and onPieceConfirmed'
    )
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
          } satisfies AddPiecesSuccess,
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
    assert.strictEqual(upload.copies[0].pieceId, 0n, 'pieceId should be 0')
    assert.strictEqual(upload.size, 1024, 'size should be 1024')
  })
})
