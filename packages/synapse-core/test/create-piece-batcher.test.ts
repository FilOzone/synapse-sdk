import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import { ValidationError } from '../src/errors/base.ts'
import { AddPiecesFlushError, InvalidUploadSizeError } from '../src/errors/pdp.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  createAndAddPiecesHandler,
  createPullResponse,
  dataSetCreationStatusHandler,
  findAnyPieceHandler,
  pullPiecesWithCaptureHandler,
  streamingUploadHandlers,
} from '../src/mocks/pdp.ts'
import * as Piece from '../src/piece/index.ts'
import * as Digest from '../src/piece/internal/digest.ts'
import { PieceCID } from '../src/piece/piece-cid.ts'
import type { addPiecesApiRequest } from '../src/sp/add-pieces.ts'
import { createPieceBatcher, type EnqueuePiece } from '../src/sp/create-piece-batcher.ts'
import * as TypedData from '../src/typed-data/index.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'
import type { PdpDataSet } from '../src/warm-storage/types.ts'

const account = privateKeyToAccount(PRIVATE_KEYS.key1)
const client = createWalletClient({
  account,
  chain: Chains.calibration,
  transport: viemHttp(),
})

const pieceCidA = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
const pieceCidB = Piece.from('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace')
const tooSmallPieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

function pieceCidWithRawSize(rawSize: number): PieceCID {
  const height = Piece.heightFor(rawSize < Piece.MIN_SIZE ? Piece.MIN_SIZE : rawSize)
  const root = new Uint8Array(32)
  const probe = PieceCID._fromDigest(Digest.fromFields({ padding: 0n, height, root }))
  return PieceCID._fromDigest(Digest.fromFields({ padding: BigInt(probe.size - rawSize), height, root }))
}
const mockTxHash = '0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890' as const
const mockTxHash2 = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const
const pdpBase = 'https://pdp.example.com'

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

function parkHandlers() {
  return [...streamingUploadHandlers({ baseUrl: pdpBase }), findAnyPieceHandler(true, { baseUrl: pdpBase })]
}

function addPiecesCaptureHandler(
  onBody: (body: addPiecesApiRequest.RequestBody) => void,
  txHash: `0x${string}` = mockTxHash
) {
  return http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
    `${pdpBase}/pdp/data-sets/:id/pieces`,
    async ({ request, params }) => {
      const body = await request.json()
      onBody(body)
      return new HttpResponse(null, {
        status: 201,
        headers: {
          Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
        },
      })
    }
  )
}

describe('createPieceBatcher', () => {
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

  it('should batch two uploads in one addPieces window', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...parkHandlers(),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const aP = batcher.upload({ data: new Uint8Array(127).fill(1), pieceCid: pieceCidA, metadata: { name: 'a' } })
    const bP = batcher.upload({ data: new Uint8Array(127).fill(2), pieceCid: pieceCidB, metadata: { name: 'b' } })
    await batcher.close()
    const [a, b] = await Promise.all([aP, bP])

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 2)
    assert.equal(a.txHash, b.txHash)
    assert.equal(a.pieces.length, 2)
    assert.equal(a.batchIndex + b.batchIndex, 1)
  })

  it('should stream an upload into the same addPieces window', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...parkHandlers(),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const data = new Uint8Array(127).fill(1)
    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const streamedP = batcher.upload({
      data: new Blob([data]).stream(),
      size: data.byteLength,
      pieceCid: pieceCidA,
      metadata: { name: 'a' },
    })
    const uploadedP = batcher.upload({
      data: new Uint8Array(127).fill(2),
      pieceCid: pieceCidB,
      metadata: { name: 'b' },
    })
    await batcher.close()
    const [streamed, uploaded] = await Promise.all([streamedP, uploadedP])

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 2)
    assert.equal(streamed.txHash, uploaded.txHash)
  })

  it('should flush after one macrotask when wait is delay 0', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
    const aP = batcher.enqueue({ pieceCid: pieceCidA })
    const bP = batcher.enqueue({ pieceCid: pieceCidB })
    const [a, b] = await Promise.all([aP, bP])
    await batcher.close()

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 2)
    assert.equal(a.txHash, b.txHash)
  })

  it('should not flush on a timer when wait is limiter', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = batcher.enqueue({ pieceCid: pieceCidA })
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(bodies.length, 0)
    assert.equal(batcher.pending.length, 1)
    await batcher.close()
    await pending
    assert.equal(bodies.length, 1)
  })

  it('should flush the current window when the limiter rejects the next piece', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    const hashes = [mockTxHash, mockTxHash2]
    server.use(
      ...parkHandlers(),
      http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
        `${pdpBase}/pdp/data-sets/:id/pieces`,
        async ({ request, params }) => {
          const body = await request.json()
          bodies.push(body)
          const txHash = hashes[bodies.length - 1] ?? mockTxHash
          return new HttpResponse(null, {
            status: 201,
            headers: {
              Location: `/pdp/data-sets/${params.id}/pieces/added/${txHash}`,
            },
          })
        }
      )
    )

    const batcher = createPieceBatcher(client, {
      dataSet: createDataSet(),
      wait: { kind: 'limiter' },
      limiter: ({ pieces }) => pieces.length <= 1,
    })
    const first = batcher.enqueue({ pieceCid: pieceCidA })
    const second = batcher.enqueue({ pieceCid: pieceCidB })
    await batcher.close()
    const [a, b] = await Promise.all([first, second])

    assert.equal(bodies.length, 2)
    assert.equal(bodies[0]?.pieces.length, 1)
    assert.equal(bodies[1]?.pieces.length, 1)
    assert.equal(a.txHash, mockTxHash)
    assert.equal(b.txHash, mockTxHash2)
  })

  it('should mix upload and pull in one window', async () => {
    const addBodies: addPiecesApiRequest.RequestBody[] = []
    let pullExtraData: string | undefined
    server.use(
      ...parkHandlers(),
      pullPiecesWithCaptureHandler(
        createPullResponse('complete', [{ pieceCid: pieceCidB.toString() }]),
        (req) => {
          pullExtraData = req.extraData
        },
        { baseUrl: pdpBase }
      ),
      addPiecesCaptureHandler((body) => addBodies.push(body))
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const uploadedP = batcher.upload({ data: new Uint8Array(127).fill(1), pieceCid: pieceCidA })
    const pulledP = batcher.pull({
      pieceCid: pieceCidB,
      sourceUrl: `${pdpBase}/piece/${pieceCidB.toString()}`,
    })
    await batcher.close()
    const [uploaded, pulled] = await Promise.all([uploadedP, pulledP])

    assert.ok(pullExtraData)
    const pullDecoded = decodeAbiParameters(TypedData.signAddPiecesAbiParameters, pullExtraData as `0x${string}`)
    assert.equal(pullDecoded[1].length, 1)

    assert.equal(addBodies.length, 1)
    assert.equal(addBodies[0]?.pieces.length, 2)
    const flushDecoded = decodeAbiParameters(
      TypedData.signAddPiecesAbiParameters,
      addBodies[0]?.extraData as `0x${string}`
    )
    assert.equal(flushDecoded[1].length, 2)
    assert.equal(uploaded.txHash, pulled.txHash)
  })

  it('should call onParked after park and before addPieces', async () => {
    const parked: string[] = []
    const bodies: addPiecesApiRequest.RequestBody[] = []
    let resolveParked: (() => void) | undefined
    const bothParked = new Promise<void>((resolve) => {
      resolveParked = () => {
        resolve()
      }
    })
    server.use(
      ...parkHandlers(),
      pullPiecesWithCaptureHandler(
        createPullResponse('complete', [{ pieceCid: pieceCidB.toString() }]),
        () => undefined,
        {
          baseUrl: pdpBase,
        }
      ),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    function onParked(prefix: string) {
      return (piece: EnqueuePiece) => {
        assert.equal(bodies.length, 0)
        parked.push(`${prefix}:${piece.pieceCid.toString()}:${piece.metadata?.name}`)
        if (parked.length === 2) {
          resolveParked?.()
        }
      }
    }
    const uploadedP = batcher.upload({
      data: new Uint8Array(127).fill(1),
      pieceCid: pieceCidA,
      metadata: { name: 'a' },
      onParked: onParked('upload'),
    })
    const pulledP = batcher.pull({
      pieceCid: pieceCidB,
      sourceUrl: `${pdpBase}/piece/${pieceCidB.toString()}`,
      metadata: { name: 'b' },
      onParked: onParked('pull'),
    })
    await bothParked
    assert.equal(bodies.length, 0)
    assert.deepEqual(parked.sort(), [`pull:${pieceCidB.toString()}:b`, `upload:${pieceCidA.toString()}:a`])
    await batcher.close()
    const [uploaded, pulled] = await Promise.all([uploadedP, pulledP])
    assert.equal(bodies.length, 1)
    assert.equal(uploaded.txHash, pulled.txHash)
  })

  it('should not enqueue when onParked throws', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...parkHandlers(),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    await assert.rejects(
      () =>
        batcher.upload({
          data: new Uint8Array(127).fill(1),
          pieceCid: pieceCidA,
          onParked: () => {
            throw new Error('nope')
          },
        }),
      { message: 'nope' }
    )
    await batcher.close()
    assert.equal(bodies.length, 0)
  })

  it('should not poison sibling uploads when one park fails', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      http.post<{ uuid: string }, { pieceCid: string }>(`${pdpBase}/pdp/piece/uploads/:uuid`, async ({ request }) => {
        const body = await request.json()
        if (body.pieceCid === pieceCidA.toString()) {
          return HttpResponse.text('boom', { status: 500 })
        }
        return HttpResponse.json({ pieceCid: body.pieceCid }, { status: 200 })
      }),
      ...parkHandlers(),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const failed = batcher.upload({ data: new Uint8Array(127).fill(1), pieceCid: pieceCidA })
    const ok = batcher.upload({ data: new Uint8Array(127).fill(2), pieceCid: pieceCidB })
    await assert.rejects(failed)
    await batcher.close()
    const result = await ok

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 1)
    assert.equal(result.pieceCid.toString(), pieceCidB.toString())
  })

  it('should reject a failed flush as AddPiecesFlushError and allow enqueue retry', async () => {
    let attempts = 0
    server.use(
      http.post<{ id: string }, addPiecesApiRequest.RequestBody>(
        `${pdpBase}/pdp/data-sets/:id/pieces`,
        async ({ request, params }) => {
          attempts++
          if (attempts === 1) {
            return HttpResponse.text('nope', { status: 400 })
          }
          await request.json()
          return new HttpResponse(null, {
            status: 201,
            headers: {
              Location: `/pdp/data-sets/${params.id}/pieces/added/${mockTxHash}`,
            },
          })
        }
      )
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = batcher.enqueue({ pieceCid: pieceCidA, metadata: { name: 'a' } })
    await batcher.flush()
    const error = await pending.then(
      () => undefined,
      (err: unknown) => err
    )
    assert.ok(AddPiecesFlushError.is(error))
    if (!AddPiecesFlushError.is(error)) {
      return
    }
    assert.equal(error.pieceCid.toString(), pieceCidA.toString())
    assert.equal(error.metadata?.name, 'a')

    const retriedP = batcher.enqueue({ pieceCid: error.pieceCid, metadata: error.metadata })
    await batcher.close()
    const retried = await retriedP
    assert.equal(retried.txHash, mockTxHash)
    assert.equal(attempts, 2)
  })

  it('should throw when a piece cannot sit in a batch alone', async () => {
    const batcher = createPieceBatcher(client, {
      dataSet: createDataSet(),
      limiter: () => false,
    })
    await assert.rejects(() => batcher.enqueue({ pieceCid: pieceCidA }), ValidationError)
    await batcher.close()
  })

  it('should reject upload, pull, and enqueue when PieceCID size is outside Curio upload bounds', async () => {
    const tooLarge = pieceCidWithRawSize(SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    await assert.rejects(() => batcher.enqueue({ pieceCid: tooSmallPieceCid }), InvalidUploadSizeError)
    await assert.rejects(() => batcher.enqueue({ pieceCid: tooLarge }), InvalidUploadSizeError)
    await assert.rejects(
      () => batcher.pull({ pieceCid: tooSmallPieceCid, sourceUrl: `${pdpBase}/piece/${tooSmallPieceCid.toString()}` }),
      InvalidUploadSizeError
    )
    await assert.rejects(
      () => batcher.upload({ data: new Uint8Array(127).fill(1), pieceCid: tooLarge }),
      InvalidUploadSizeError
    )
    await assert.rejects(
      () =>
        batcher.upload({
          data: new Blob([new Uint8Array(127).fill(1)]).stream(),
          pieceCid: tooLarge,
        }),
      InvalidUploadSizeError
    )
    await batcher.close()
  })

  it('should flush leftover pieces on close and reject further work', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = batcher.enqueue({ pieceCid: pieceCidA })
    await batcher.close()
    const result = await pending
    assert.equal(bodies.length, 1)
    assert.equal(result.pieceCid.toString(), pieceCidA.toString())
    await assert.rejects(() => batcher.enqueue({ pieceCid: pieceCidB }), ValidationError)
  })

  it('should create a data set on the first flush then switch to addPieces', async () => {
    const addBodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      JSONRPC(presets.basic),
      createAndAddPiecesHandler(mockTxHash, { baseUrl: pdpBase }),
      dataSetCreationStatusHandler(
        mockTxHash,
        {
          createMessageHash: mockTxHash,
          dataSetCreated: true,
          service: 'warm',
          txStatus: 'confirmed',
          ok: true,
          dataSetId: 1,
        },
        { baseUrl: pdpBase }
      ),
      addPiecesCaptureHandler((body) => addBodies.push(body), mockTxHash2)
    )

    const batcher = createPieceBatcher(client, {
      dataSet: undefined,
      serviceURL: pdpBase,
      payee: ADDRESSES.payee1,
      wait: { kind: 'limiter' },
      limiter: ({ pieces }) => pieces.length <= 1,
    })
    const first = batcher.enqueue({ pieceCid: pieceCidA })
    const second = batcher.enqueue({ pieceCid: pieceCidB })
    await batcher.close()
    const [created, added] = await Promise.all([first, second])

    assert.ok(batcher.dataSet)
    assert.equal(batcher.dataSet?.dataSetId, 1n)
    assert.equal(created.txHash, mockTxHash)
    assert.equal(added.txHash, mockTxHash2)
    assert.equal(addBodies.length, 1)
  })
})
