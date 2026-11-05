import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import { TransactionNotAppliedError } from '../src/errors/pdp.ts'
import { ADDRESSES, JSONRPC, landedTransactions, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import { findAnyPieceHandler, streamingUploadHandlers } from '../src/mocks/pdp.ts'
import type { addPiecesApiRequest } from '../src/sp/add-pieces.ts'
import { uploadPieces } from '../src/sp/upload-pieces.ts'
import type { PdpDataSet } from '../src/warm-storage/types.ts'

const client = createWalletClient({
  account: privateKeyToAccount(PRIVATE_KEYS.key1),
  chain: Chains.calibration,
  transport: viemHttp(),
})
const pdpBase = 'https://pdp.example.com'
const txHashes = [
  '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890',
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
] as const

function createDataSet(): PdpDataSet {
  return {
    pdpRailId: 1n,
    cacheMissRailId: 0n,
    cdnRailId: 0n,
    payer: ADDRESSES.client1,
    payee: ADDRESSES.payee1,
    serviceProvider: ADDRESSES.serviceProvider1,
    commissionBps: 100n,
    clientDataSetId: 0n,
    pdpEndEpoch: 0n,
    pendingOneTimePayments: 0n,
    lifecycleReserveBalance: 0n,
    providerId: 1n,
    dataSetId: 1n,
    live: true,
    managed: true,
    cdn: false,
    metadata: Object.create(null),
    hasActivePieces: true,
    provider: {
      id: 1n,
      serviceProvider: ADDRESSES.serviceProvider1,
      payee: ADDRESSES.payee1,
      isActive: true,
      name: 'provider-1',
      description: 'test provider',
      pdp: {
        serviceURL: pdpBase,
        minPieceSizeInBytes: 127n,
        maxPieceSizeInBytes: 1024n * 1024n * 1024n,
        storagePricePerTibPerDay: 1n,
        minProvingPeriodInEpochs: 1n,
        location: 'US',
        paymentTokenAddress: ADDRESSES.calibration.usdfcToken,
        ipniPiece: false,
        ipniIpfs: false,
      },
    },
  }
}

/**
 * Accept add-pieces requests and land them on chain with piece ids `(request + 1) * 100 + n`.
 * Requests listed in `reverted` land as reverted transactions instead.
 */
function addPiecesHandlers(bodies: addPiecesApiRequest.RequestBody[], reverted: number[] = []) {
  return [
    JSONRPC({
      ...presets.basic,
      ...landedTransactions((hash) => {
        const request = txHashes.indexOf(hash as (typeof txHashes)[number])
        const count = bodies[request]?.pieces.length
        if (count == null) {
          return undefined
        }
        if (reverted.includes(request)) {
          return { reverted: true }
        }
        return { dataSetId: 1n, pieceIds: Array.from({ length: count }, (_, n) => BigInt((request + 1) * 100 + n)) }
      }),
    }),
    http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
      `${pdpBase}/pdp/data-sets/:id/pieces`,
      async ({ request, params }) => {
        bodies.push(await request.json())
        const txHash = txHashes[bodies.length - 1]
        return new HttpResponse(null, {
          status: 201,
          headers: { Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}` },
        })
      }
    ),
  ]
}

function failNthUpload(n: number) {
  let count = 0
  return http.put(`${pdpBase}/pdp/piece/uploads/:uuid`, async ({ request }) => {
    await request.arrayBuffer()
    count++
    if (count === n) {
      return HttpResponse.text('upload failed', { status: 400 })
    }
    return new HttpResponse(null, { status: 204 })
  })
}

const data = (fill: number) => new Uint8Array(200).fill(fill)

describe('uploadPieces', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  it('adds every piece in one request and maps the confirmed piece ids', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...streamingUploadHandlers({ baseUrl: pdpBase }),
      findAnyPieceHandler(true, { baseUrl: pdpBase }),
      ...addPiecesHandlers(bodies)
    )
    const hashes: string[] = []
    const progressed = new Set<number>()

    const result = await uploadPieces(client, {
      dataSet: createDataSet(),
      pieces: [1, 2, 3, 4, 5].map((n) => ({ data: data(n), metadata: { name: `f${n}` } })),
      concurrency: 2,
      onHash: (txHash) => hashes.push(txHash),
      onProgress: (index) => progressed.add(index),
    })

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 5)
    assert.deepEqual(hashes, [txHashes[0]])
    assert.equal(progressed.size, 5)
    assert.equal(result.confirmations.length, 1)
    assert.deepEqual(result.failed, [])
    assert.deepEqual(
      result.pieces.map((piece) => [piece.index, piece.pieceId, piece.size, piece.metadata?.name]),
      [
        [0, 100n, 200, 'f1'],
        [1, 101n, 200, 'f2'],
        [2, 102n, 200, 'f3'],
        [3, 103n, 200, 'f4'],
        [4, 104n, 200, 'f5'],
      ]
    )
  })

  it('returns failed pieces and still adds the others', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      // First match wins, so the failing PUT goes before the default handlers.
      failNthUpload(2),
      ...streamingUploadHandlers({ baseUrl: pdpBase }),
      findAnyPieceHandler(true, { baseUrl: pdpBase }),
      ...addPiecesHandlers(bodies)
    )

    const result = await uploadPieces(client, {
      dataSet: createDataSet(),
      pieces: [1, 2, 3].map((n) => ({ data: data(n) })),
      concurrency: 1,
    })

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 2)
    assert.deepEqual(
      result.failed.map((item) => item.index),
      [1]
    )
    assert.deepEqual(
      result.pieces.map((piece) => [piece.index, piece.pieceId]),
      [
        [0, 100n],
        [2, 101n],
      ]
    )
  })

  it('maps piece ids across add-pieces transactions when a batch is split', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...streamingUploadHandlers({ baseUrl: pdpBase }),
      findAnyPieceHandler(true, { baseUrl: pdpBase }),
      ...addPiecesHandlers(bodies)
    )
    const hashes: string[] = []

    const result = await uploadPieces(client, {
      dataSet: createDataSet(),
      pieces: [1, 2, 3, 4].map((n) => ({ data: data(n) })),
      concurrency: 1,
      limiter: ({ pieces }) => pieces.length > 0 && pieces.length <= 2,
      onHash: (txHash) => hashes.push(txHash),
    })

    assert.equal(bodies.length, 2)
    assert.deepEqual(hashes, [...txHashes])
    assert.equal(result.confirmations.length, 2)
    assert.deepEqual(result.failed, [])
    assert.deepEqual(
      result.pieces.map((piece) => [piece.index, piece.pieceId]),
      [
        [0, 100n],
        [1, 101n],
        [2, 200n],
        [3, 201n],
      ]
    )
  })

  it('keeps the confirmed transaction when another one is not applied', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...streamingUploadHandlers({ baseUrl: pdpBase }),
      findAnyPieceHandler(true, { baseUrl: pdpBase }),
      ...addPiecesHandlers(bodies, [1])
    )

    const result = await uploadPieces(client, {
      dataSet: createDataSet(),
      pieces: [1, 2, 3, 4].map((n) => ({ data: data(n) })),
      concurrency: 1,
      limiter: ({ pieces }) => pieces.length > 0 && pieces.length <= 2,
    })

    assert.equal(bodies.length, 2)
    assert.equal(result.confirmations.length, 1)
    assert.deepEqual(
      result.pieces.map((piece) => [piece.index, piece.pieceId]),
      [
        [0, 100n],
        [1, 101n],
      ]
    )
    assert.deepEqual(
      result.failed.map((item) => item.index),
      [2, 3]
    )
    assert.ok(result.failed.every((item) => TransactionNotAppliedError.is(item.error)))
  })

  it('throws when every piece fails', async () => {
    server.use(failNthUpload(1), ...streamingUploadHandlers({ baseUrl: pdpBase }))

    await assert.rejects(uploadPieces(client, { dataSet: createDataSet(), pieces: [{ data: data(1) }] }))
  })

  it('throws when there are no pieces', async () => {
    await assert.rejects(uploadPieces(client, { dataSet: createDataSet(), pieces: [] }), /No pieces to upload/)
  })
})
