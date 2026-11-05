/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import type { AccountClient } from '@filoz/synapse-core'
import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import type { addPiecesApiRequest } from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, type Hex, numberToHex, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { Synapse } from '../synapse.ts'
import type { PieceCID } from '../types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'

// mock server for testing
const server = setup()

/**
 * Accept add-pieces requests and land each one on chain in `landed`: its transaction adds the request's
 * pieces with the next piece IDs, starting at 0. Serve `landed` with `Mocks.landedTransactions`.
 */
function addPiecesOnChain(landed: Record<Hex, Mocks.LandedTransaction>, onRequest?: () => void) {
  let nextPieceId = 0n
  return http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
    `https://pdp.example.com/pdp/data-sets/:id/pieces`,
    async ({ request, params }) => {
      onRequest?.()
      const { pieces } = await request.json()
      const txHash = numberToHex(Object.keys(landed).length + 1, { size: 32 })
      landed[txHash] = { dataSetId: BigInt(params.id), pieceIds: pieces.map(() => nextPieceId++) }
      return new HttpResponse(null, {
        status: 201,
        headers: { Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}` },
      })
    }
  )
}

describe('Storage Upload', () => {
  let client: AccountClient
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
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    let uploadCompleteCount = 0
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(),
      Mocks.pdp.findAnyPieceHandler(true),
      addPiecesOnChain(landed)
    )
    const synapse = new Synapse({ client, source: null })
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
        onPiecesConfirmed: () => uploadCompleteCount++,
      }),
      context.upload(secondData, {
        onPiecesConfirmed: () => uploadCompleteCount++,
      }),
      context.upload(thirdData, {
        onPiecesConfirmed: () => uploadCompleteCount++,
      }),
    ]

    const results = await Promise.all(uploads)
    assert.lengthOf(results, 3, 'All three uploads should complete successfully')

    const resultSizes = results.map((r) => r.size)
    const resultPieceIds = results.map((r) => r.copies[0].pieceId)

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(
      [...resultPieceIds].sort((a, b) => Number(a - b)),
      [0n, 1n, 2n],
      'The set of assigned piece IDs should be {0, 1, 2}'
    )
    assert.strictEqual(uploadCompleteCount, 3, 'uploadComplete should be called 3 times')
  })

  it('should commit each upload independently', async () => {
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    let addPiecesCalls = 0
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(),
      Mocks.pdp.findAnyPieceHandler(true),
      addPiecesOnChain(landed, () => addPiecesCalls++)
    )
    const synapse = new Synapse({ client, source: null, pieceBatching: false })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const firstData = new Uint8Array(127).fill(1)
    const secondData = new Uint8Array(128).fill(2)
    const thirdData = new Uint8Array(129).fill(3)

    const uploads = [context.upload(firstData), context.upload(secondData), context.upload(thirdData)]
    const results = await Promise.all(uploads)

    assert.lengthOf(results, 3, 'All three uploads should complete successfully')
    assert.strictEqual(addPiecesCalls, 3, 'Each upload should commit independently')

    const resultSizes = results.map((r) => r.size)
    const resultPieceIds = results.map((r) => r.copies[0].pieceId)

    assert.deepEqual(resultSizes, [127, 128, 129], 'Should have one result for each data size')
    assert.deepEqual(
      [...resultPieceIds].sort((a, b) => Number(a - b)),
      [0n, 1n, 2n],
      'The set of assigned piece IDs should be {0, 1, 2}'
    )
  })

  it('should expose flush for limiter-based batching', async () => {
    let addPiecesCalls = 0
    const txHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890'
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        debug: false,
        ...Mocks.landedTransactions({ [txHash]: { created: true, dataSetId: 123n, pieceIds: [10n, 11n] } }),
        warmStorageView: {
          ...Mocks.presets.basic.warmStorageView,
          getDataSet: ([dataSetId]) => [
            dataSetId === 123n
              ? {
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  clientDataSetId: 0n,
                  commissionBps: 100n,
                  dataSetId,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  payer: Mocks.ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  pendingOneTimePayments: 0n,
                  lifecycleReserveBalance: 0n,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                }
              : {
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  clientDataSetId: 0n,
                  commissionBps: 0n,
                  dataSetId,
                  payee: Mocks.ADDRESSES.zero,
                  payer: Mocks.ADDRESSES.zero,
                  pdpEndEpoch: 0n,
                  pdpRailId: 0n,
                  providerId: 0n,
                  pendingOneTimePayments: 0n,
                  lifecycleReserveBalance: 0n,
                  serviceProvider: Mocks.ADDRESSES.zero,
                },
          ],
        },
      }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(),
      Mocks.pdp.findAnyPieceHandler(true),
      http.post(`https://pdp.example.com/pdp/data-sets/create-and-add`, () => {
        addPiecesCalls++
        return new HttpResponse(null, {
          status: 201,
          headers: {
            Location: `/pdp/data-sets/created/${txHash}`,
          },
        })
      })
    )
    const synapse = new Synapse({
      client,
      source: null,
      pieceBatching: { wait: { kind: 'limiter' } },
    })
    const context = await synapse.storage.createContext({ withCDN: true })

    const uploads = [context.upload(new Uint8Array(127).fill(1)), context.upload(new Uint8Array(128).fill(2))]
    await synapse.storage.flush()
    const results = await Promise.all(uploads)

    assert.strictEqual(addPiecesCalls, 1, 'flush should submit both parked pieces in one batch')
    assert.deepEqual(
      results.map((result) => result.copies[0].pieceId),
      [10n, 11n]
    )
  })

  it('should accept exactly 127 bytes', async () => {
    let addPiecesCalls = 0
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
      addPiecesOnChain(landed, () => addPiecesCalls++)
    )
    const synapse = new Synapse({ client, source: null })
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
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
      addPiecesOnChain(landed, () => addPiecesCalls++)
    )
    const synapse = new Synapse({ client, source: null })
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

  it('should handle new server with transaction tracking', async () => {
    let piecesAddedArgs: { transaction?: string; providerId?: bigint; pieces?: { pieceCid: PieceCID }[] } | null = null
    let piecesConfirmedArgs: {
      dataSetId?: bigint
      providerId?: bigint
      pieces?: { pieceId: bigint; pieceCid: PieceCID }[]
    } | null = null
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
      addPiecesOnChain(landed)
    )
    const synapse = new Synapse({ client, source: null })
    const context = await synapse.storage.createContext({
      withCDN: true,
      metadata: {
        environment: 'test',
      },
    })

    const expectedSize = SIZE_CONSTANTS.MIN_UPLOAD_SIZE
    const uploadResult = await context.upload(new Uint8Array(expectedSize).fill(1), {
      onPiecesAdded(transaction, providerId, pieces) {
        piecesAddedArgs = { transaction, providerId, pieces }
      },
      onPiecesConfirmed(dataSetId, providerId, pieces) {
        piecesConfirmedArgs = { dataSetId, providerId, pieces }
      },
    })

    assert.isNotNull(piecesAddedArgs, 'onPiecesAdded args should be captured')
    assert.isNotNull(piecesConfirmedArgs, 'onPiecesConfirmed args should be captured')
    if (piecesAddedArgs == null || piecesConfirmedArgs == null) {
      throw new Error('Callbacks should have been called')
    }
    const addedArgs: { transaction: string; pieces: { pieceCid: PieceCID }[] } = piecesAddedArgs as any
    const confirmedArgs: { dataSetId: bigint; pieces: { pieceId: bigint; pieceCid: PieceCID }[] } =
      piecesConfirmedArgs as any
    assert.isString(addedArgs.transaction, 'onPiecesAdded should provide transaction hash')
    assert.lengthOf(addedArgs.pieces, 1, 'onPiecesAdded should have 1 piece')
    assert.strictEqual(
      addedArgs.pieces[0].pieceCid.toString(),
      uploadResult.pieceCid.toString(),
      'onPiecesAdded should provide matching pieceCid'
    )
    assert.strictEqual(
      confirmedArgs.pieces[0].pieceCid.toString(),
      uploadResult.pieceCid.toString(),
      'onPiecesConfirmed should provide matching pieceCid'
    )
    assert.strictEqual(confirmedArgs.pieces[0].pieceId, 0n, 'onPiecesConfirmed should include piece ID')
    assert.isAbove(Number(confirmedArgs.dataSetId), 0, 'onPiecesConfirmed should include dataSetId')
  })

  it('should handle ArrayBuffer input', async () => {
    const pdpOptions = {
      baseUrl: 'https://pdp.example.com',
    }
    const landed: Record<Hex, Mocks.LandedTransaction> = {}
    server.use(
      Mocks.JSONRPC({ ...Mocks.presets.basic, debug: false, ...Mocks.landedTransactions(landed) }),
      Mocks.PING(),
      ...Mocks.pdp.streamingUploadHandlers(pdpOptions),
      Mocks.pdp.findAnyPieceHandler(true, pdpOptions),
      addPiecesOnChain(landed)
    )
    const synapse = new Synapse({ client, source: null })
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
