import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, decodeAbiParameters, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import * as Chains from '../src/chains.ts'
import { ValidationError } from '../src/errors/base.ts'
import { PDPProviderUnavailableError } from '../src/errors/index.ts'
import { AddPiecesFlushError, InvalidUploadSizeError, TransactionNotAppliedError } from '../src/errors/pdp.ts'
import { PullError } from '../src/errors/pull.ts'
import { ADDRESSES, JSONRPC, landedTransactions, PRIVATE_KEYS, presets } from '../src/mocks/jsonrpc/index.ts'
import {
  createAndAddPiecesHandler,
  createPullResponse,
  findAnyPieceHandler,
  type PullRequestCapture,
  pullPiecesPerPieceHandler,
  pullPiecesWithCaptureHandler,
  streamingUploadHandlers,
} from '../src/mocks/pdp.ts'
import * as Piece from '../src/piece/index.ts'
import * as Digest from '../src/piece/internal/digest.ts'
import { PieceCID } from '../src/piece/piece-cid.ts'
import type { addPiecesApiRequest } from '../src/sp/add-pieces.ts'
import {
  createPieceBatcher,
  type EnqueuePiece,
  type FlushResult,
  type SubmittedBatch,
  waitForFlushReceipt,
} from '../src/sp/create-piece-batcher.ts'
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

const pullCids = Array.from({ length: 5 }, (_, index) => pieceCidWithRawSize(200 + index))

function pullSource(pieceCid: PieceCID): string {
  return `${pdpBase}/piece/${pieceCid.toString()}`
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

/** A flush result with string PieceCIDs, for deep equality. */
function comparable(result: FlushResult | undefined) {
  assert.ok(result)
  return { ...result, pieces: result.pieces.map((piece) => ({ ...piece, pieceCid: piece.pieceCid.toString() })) }
}

/** Count any addPieces or createDataSetAndAddPieces call, and fail it. */
function noSubmitHandlers(onSubmit: () => void) {
  return [
    http.post(`${pdpBase}/pdp/data-sets/:id/pieces`, () => {
      onSubmit()
      return HttpResponse.text('unexpected addPieces', { status: 500 })
    }),
    http.post(`${pdpBase}/pdp/data-sets/create-and-add`, () => {
      onSubmit()
      return HttpResponse.text('unexpected createDataSetAndAddPieces', { status: 500 })
    }),
  ]
}

/** Count createDataSetAndAddPieces calls, each answered with `mockTxHash`. */
function countingCreateHandler(onCreate: () => void) {
  return http.post(`${pdpBase}/pdp/data-sets/create-and-add`, () => {
    onCreate()
    return new HttpResponse(null, { status: 201, headers: { Location: `/pdp/data-sets/created/${mockTxHash}` } })
  })
}

const createdTransaction = { [mockTxHash]: { created: true, dataSetId: 1n, pieceIds: [0n] } }

const newDataSetOptions = {
  dataSet: undefined,
  serviceURL: pdpBase,
  payee: ADDRESSES.payee1,
  wait: { kind: 'limiter' },
} as const

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

  it('rejects uploads when the data set has no active PDP provider', async () => {
    const batcher = createPieceBatcher(client, {
      dataSet: { ...createDataSet(), provider: null },
      wait: { kind: 'limiter' },
    })
    await assert.rejects(batcher.upload({ data: new Uint8Array(127), pieceCid: pieceCidA }), (error: unknown) => {
      assert.ok(PDPProviderUnavailableError.is(error))
      assert.equal(error.providerId, 1n)
      assert.equal(error.message, 'PDP provider 1 is unavailable')
      return true
    })
    await batcher.close()
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

  it('should split 81 pieces at the legacy data-set cap', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = Array.from({ length: 81 }, (_, index) =>
      batcher.enqueue({ pieceCid: pieceCidA, metadata: { index: String(index) } })
    )
    await batcher.close()
    const results = await Promise.all(pending)

    assert.deepEqual(
      bodies.map((body) => body.pieces.length),
      [80, 1]
    )
    assert.equal(results.length, 81)
  })

  it('should keep 81 compact-data-set pieces together when they fit the message-size budget', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const compactDataSet = { ...createDataSet(), dataSetId: Chains.calibration.legacyPieceStorageIdLimit }
    const batcher = createPieceBatcher(client, { dataSet: compactDataSet, wait: { kind: 'limiter' } })
    const pending = Array.from({ length: 81 }, (_, index) =>
      batcher.enqueue({ pieceCid: pieceCidA, metadata: { index: String(index) } })
    )
    await batcher.close()
    const results = await Promise.all(pending)

    assert.deepEqual(
      bodies.map((body) => body.pieces.length),
      [81]
    )
    assert.equal(results.length, 81)
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

  it('should start the delay after all in-flight parking settles', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(
      ...parkHandlers(),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    let resolveFirstParked: () => void = () => undefined
    const firstParked = new Promise<void>((resolve) => {
      resolveFirstParked = resolve
    })
    let resolveSecondParked: () => void = () => undefined
    const secondParked = new Promise<void>((resolve) => {
      resolveSecondParked = resolve
    })
    let releaseSecond: () => void = () => undefined
    const holdSecond = new Promise<void>((resolve) => {
      releaseSecond = resolve
    })

    const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
    const first = batcher.upload({
      data: new Uint8Array(127).fill(1),
      pieceCid: pieceCidA,
      onParked: resolveFirstParked,
    })
    const second = batcher.upload({
      data: new Uint8Array(127).fill(2),
      pieceCid: pieceCidB,
      onParked: async () => {
        resolveSecondParked()
        await holdSecond
      },
    })

    await Promise.all([firstParked, secondParked])
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(bodies.length, 0)
    assert.equal(batcher.pending.length, 1)

    releaseSecond()
    const [firstResult, secondResult] = await Promise.all([first, second])
    await batcher.close()

    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 2)
    assert.equal(firstResult.txHash, secondResult.txHash)
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
      limiter: (options) => {
        assert.equal(options.kind, 'addPieces')
        if (options.kind === 'addPieces') {
          assert.equal(options.dataSet?.provider?.pdp.serviceURL, pdpBase)
          assert.equal(options.dataSet?.dataSetId, options.dataSetId)
          assert.equal(options.legacyPieceStorageIdLimit, Chains.calibration.legacyPieceStorageIdLimit)
        }
        return options.pieces.length <= 1
      },
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
    assert.equal(pullDecoded[1].length, 0)

    assert.equal(addBodies.length, 1)
    assert.equal(addBodies[0]?.pieces.length, 2)
    const flushDecoded = decodeAbiParameters(
      TypedData.signAddPiecesAbiParameters,
      addBodies[0]?.extraData as `0x${string}`
    )
    assert.equal(flushDecoded[1].length, 0)
    assert.equal(uploaded.txHash, pulled.txHash)
  })

  it('should use create-and-add authorization when pulling into a new data set', async () => {
    let pullExtraData: string | undefined
    let pullDataSetId: number | undefined
    server.use(
      JSONRPC({
        ...presets.basic,
        ...landedTransactions({ [mockTxHash]: { created: true, dataSetId: 1n, pieceIds: [0n] } }),
      }),
      pullPiecesWithCaptureHandler(
        createPullResponse('complete', [{ pieceCid: pieceCidB.toString() }]),
        (request) => {
          pullExtraData = request.extraData
          pullDataSetId = request.dataSetId
        },
        { baseUrl: pdpBase }
      ),
      createAndAddPiecesHandler(mockTxHash, { baseUrl: pdpBase })
    )

    const batcher = createPieceBatcher(client, {
      dataSet: undefined,
      serviceURL: pdpBase,
      payee: ADDRESSES.payee1,
      wait: { kind: 'limiter' },
    })
    const pulledP = batcher.pull({
      pieceCid: pieceCidB,
      sourceUrl: `${pdpBase}/piece/${pieceCidB.toString()}`,
    })
    await batcher.close()
    await pulledP

    assert.equal(pullDataSetId, undefined)
    assert.ok(pullExtraData)
    const [createExtraData, addExtraData] = decodeAbiParameters(
      TypedData.signcreateDataSetAndAddPiecesAbiParameters,
      pullExtraData as `0x${string}`
    )
    decodeAbiParameters(TypedData.signCreateDataSetAbiParameters, createExtraData)
    decodeAbiParameters(TypedData.signAddPiecesAbiParameters, addExtraData)
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

  it('should reject invalid metadata without flushing the current window', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = batcher.enqueue({ pieceCid: pieceCidA })
    await assert.rejects(
      () => batcher.enqueue({ pieceCid: pieceCidB, metadata: { name: 'x'.repeat(97) } }),
      /value exceeds the maximum length/
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.equal(bodies.length, 0)
    assert.equal(batcher.pending.length, 1)
    await batcher.close()
    await pending
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 1)
  })

  it('should submit the valid pieces and reject only the piece with invalid metadata', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    server.use(addPiecesCaptureHandler((body) => bodies.push(body)))

    // A limiter that ignores metadata, so the batcher cannot rely on the default one throwing.
    const batcher = createPieceBatcher(client, {
      dataSet: createDataSet(),
      wait: { kind: 'limiter' },
      limiter: (options) => options.pieces.length > 0,
    })
    const goodP = pullCids.slice(0, 3).map((pieceCid, i) => batcher.enqueue({ pieceCid, metadata: { name: `${i}` } }))
    const badP = batcher.enqueue({ pieceCid: pieceCidA, metadata: { name: 'x'.repeat(97) } })
    await assert.rejects(badP, /value exceeds the maximum length/)
    await batcher.close()
    const good = await Promise.all(goodP)

    assert.equal(bodies.length, 1)
    assert.deepEqual(
      bodies[0]?.pieces.map((piece) => piece.pieceCid),
      pullCids.slice(0, 3).map((cid) => cid.toString())
    )
    for (const result of good) {
      assert.equal(result.txHash, mockTxHash)
      assert.equal(result.pieces.length, 3)
    }
  })

  it('should reject an upload with invalid metadata before uploading', async () => {
    let requests = 0
    server.use(
      http.all(`${pdpBase}/*`, () => {
        requests++
        return HttpResponse.text('unexpected', { status: 500 })
      })
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const metadata = { name: 'x'.repeat(97) }
    await assert.rejects(
      () => batcher.upload({ data: new Uint8Array(127).fill(1), metadata }),
      /value exceeds the maximum length/
    )
    await assert.rejects(
      () => batcher.upload({ data: new Uint8Array(127).fill(1), pieceCid: pieceCidA, metadata }),
      /value exceeds the maximum length/
    )
    await batcher.close()
    assert.equal(requests, 0)
  })

  it('should reject every piece in the window on a window-wide failure', async () => {
    let attempts = 0
    server.use(
      http.post(`${pdpBase}/pdp/data-sets/:id/pieces`, () => {
        attempts++
        return HttpResponse.text('internal error', { status: 500 })
      })
    )

    const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
    const pending = [batcher.enqueue({ pieceCid: pieceCidA }), batcher.enqueue({ pieceCid: pieceCidB })]
    await batcher.close()
    const errors = await Promise.all(
      pending.map((p) =>
        p.then(
          () => undefined,
          (error: unknown) => error
        )
      )
    )

    assert.equal(attempts, 1)
    assert.deepEqual(
      errors.map((error) => AddPiecesFlushError.is(error) && error.pieceCid.toString()),
      [pieceCidA.toString(), pieceCidB.toString()]
    )
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
      JSONRPC({
        ...presets.basic,
        ...landedTransactions({ [mockTxHash]: { created: true, dataSetId: 1n, pieceIds: [0n] } }),
      }),
      createAndAddPiecesHandler(mockTxHash, { baseUrl: pdpBase }),
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
    assert.equal(created.payer, ADDRESSES.client1)
    assert.equal(added.txHash, mockTxHash2)
    assert.equal(addBodies.length, 1)
  })

  it('should reject the window with the receipt error when the create transaction was not applied', async () => {
    server.use(
      JSONRPC({ ...presets.basic, ...landedTransactions({ [mockTxHash]: { reverted: true } }) }),
      createAndAddPiecesHandler(mockTxHash, { baseUrl: pdpBase })
    )

    const batcher = createPieceBatcher(client, {
      dataSet: undefined,
      serviceURL: pdpBase,
      payee: ADDRESSES.payee1,
      wait: { kind: 'limiter' },
    })
    const pending = batcher.enqueue({ pieceCid: pieceCidA })
    await batcher.close()
    const error = await pending.then(
      () => undefined,
      (err: unknown) => err
    )
    assert.ok(AddPiecesFlushError.is(error))
    assert.ok(TransactionNotAppliedError.is(error.cause))
    assert.equal(batcher.dataSet, undefined)
  })

  describe('waitForFlushReceipt', () => {
    it('reads piece IDs from the add pieces receipt', async () => {
      const bodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        JSONRPC({ ...presets.basic, ...landedTransactions({ [mockTxHash]: { dataSetId: 1n, pieceIds: [7n, 8n] } }) }),
        addPiecesCaptureHandler((body) => bodies.push(body))
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const a = batcher.enqueue({ pieceCid: pieceCidA })
      const b = batcher.enqueue({ pieceCid: pieceCidB })
      await batcher.close()
      const [resultA, resultB] = await Promise.all([a, b])

      assert.equal(resultA.extraData, bodies[0]?.extraData)
      assert.equal(resultA.payer, ADDRESSES.client1)
      const receipt = await waitForFlushReceipt(client, resultB)
      assert.deepEqual(receipt, {
        txHash: mockTxHash,
        confirmedTxHash: mockTxHash,
        dataSetId: 1n,
        pieceIds: [7n, 8n],
      })
      assert.equal(receipt.pieceIds[resultB.batchIndex], 8n)
    })

    it('returns the create receipt without waiting again', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          ...landedTransactions({ [mockTxHash]: { created: true, dataSetId: 1n, pieceIds: [0n] } }),
        }),
        createAndAddPiecesHandler(mockTxHash, { baseUrl: pdpBase })
      )

      const batcher = createPieceBatcher(client, {
        dataSet: undefined,
        serviceURL: pdpBase,
        payee: ADDRESSES.payee1,
        wait: { kind: 'limiter' },
      })
      const pending = batcher.enqueue({ pieceCid: pieceCidA })
      await batcher.close()
      const result = await pending

      // A wait would fail: the node no longer knows the transaction
      server.use(JSONRPC({ ...presets.basic, ...landedTransactions({}) }))
      const receipt = await waitForFlushReceipt(client, result, { timeout: 50 })
      assert.equal(receipt.dataSetId, 1n)
      assert.deepEqual(receipt.pieceIds, [0n])
    })
  })

  it('should limit concurrent parking with concurrency and still batch every piece', async () => {
    const bodies: addPiecesApiRequest.RequestBody[] = []
    let active = 0
    let maxActive = 0
    server.use(
      ...parkHandlers(),
      http.post(`${pdpBase}/pdp/piece/uploads`, async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((resolve) => setTimeout(resolve, 10))
        active--
        return new HttpResponse('Created', {
          status: 201,
          headers: { Location: `/pdp/piece/uploads/${crypto.randomUUID()}` },
        })
      }),
      addPiecesCaptureHandler((body) => bodies.push(body))
    )

    const batcher = createPieceBatcher(client, {
      dataSet: createDataSet(),
      wait: { kind: 'limiter' },
      concurrency: 2,
    })
    const pending = Array.from({ length: 5 }, (_, index) =>
      batcher.upload({ data: new Uint8Array(200).fill(index + 1) })
    )
    // close() right away must wait for the uploads still queued for a slot.
    await batcher.close()
    const results = await Promise.all(pending)

    assert.ok(maxActive <= 2, `expected at most 2 concurrent uploads, got ${maxActive}`)
    assert.equal(bodies.length, 1)
    assert.equal(bodies[0]?.pieces.length, 5)
    assert.equal(new Set(results.map((result) => result.txHash)).size, 1)
  })

  it('should reject a concurrency below 1', () => {
    assert.throws(
      () => createPieceBatcher(client, { dataSet: createDataSet(), concurrency: 0 }),
      (error: unknown) => ValidationError.is(error)
    )
  })

  describe('batched pulls', () => {
    it('should send concurrent pulls as one pull request and settle each caller', async () => {
      const pullBodies: PullRequestCapture[] = []
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        pullPiecesPerPieceHandler(
          () => 'complete',
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler((body) => addBodies.push(body))
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
      const results = await Promise.all(
        pullCids.map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      )
      await batcher.close()

      assert.equal(pullBodies.length, 1)
      assert.deepEqual(
        pullBodies[0]?.pieces,
        pullCids.map((pieceCid) => ({ pieceCid: pieceCid.toString(), sourceUrl: pullSource(pieceCid) }))
      )
      assert.equal(addBodies.length, 1)
      assert.equal(addBodies[0]?.pieces.length, pullCids.length)
      assert.deepEqual(
        results.map((result) => result.pieceCid.toString()),
        pullCids.map((pieceCid) => pieceCid.toString())
      )
    })

    it('should split pulls into requests of PULL_BATCH_SIZE pieces sent together', async () => {
      const requestSizes: number[] = []
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      let active = 0
      let maxActive = 0
      server.use(
        http.post(`${pdpBase}/pdp/piece/pull`, async ({ request }) => {
          const body = (await request.json()) as PullRequestCapture
          requestSizes.push(body.pieces.length)
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active--
          return HttpResponse.json(createPullResponse('complete', body.pieces))
        }),
        addPiecesCaptureHandler((body) => addBodies.push(body))
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const cids = Array.from({ length: SIZE_CONSTANTS.PULL_BATCH_SIZE * 2 + 5 }, (_, index) =>
        pieceCidWithRawSize(300 + index)
      )
      const pending = cids.map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      await batcher.close()
      await Promise.all(pending)

      assert.deepEqual(requestSizes, [SIZE_CONSTANTS.PULL_BATCH_SIZE, SIZE_CONSTANTS.PULL_BATCH_SIZE, 5])
      // No client-side cap on pieces in flight: the SP's 429 is the throttle.
      assert.equal(maxActive, 3)
      assert.equal(addBodies.length, 1)
      assert.equal(addBodies[0]?.pieces.length, cids.length)
    })

    it('should wait out a full SP pull queue (429) and then settle every pull', async () => {
      let calls = 0
      server.use(
        http.post(`${pdpBase}/pdp/piece/pull`, async ({ request }) => {
          const body = (await request.json()) as PullRequestCapture
          calls++
          if (calls === 1) {
            return new HttpResponse('pull queue backpressure', { status: 429, headers: { 'Retry-After': '0' } })
          }
          return HttpResponse.json(createPullResponse('complete', body.pieces))
        }),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
      const results = await Promise.all(
        pullCids.slice(0, 2).map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      )
      await batcher.close()

      assert.equal(calls, 2)
      assert.equal(results.length, 2)
    })

    it('should not split a pull request by the addPieces limiter', async () => {
      const pullBodies: PullRequestCapture[] = []
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        pullPiecesPerPieceHandler(
          () => 'complete',
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler((body) => addBodies.push(body))
      )

      const batcher = createPieceBatcher(client, {
        dataSet: createDataSet(),
        limiter: ({ pieces }) => pieces.length <= 3,
      })
      await Promise.all(pullCids.map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) })))
      await batcher.close()

      assert.deepEqual(
        pullBodies.map((body) => body.pieces.length),
        [5]
      )
      // The limiter still sizes the addPieces windows.
      assert.deepEqual(
        addBodies.map((body) => body.pieces.length),
        [3, 2]
      )
    })

    it('should reject a pull that cannot sit in an addPieces batch alone without pulling it', async () => {
      let requests = 0
      server.use(
        http.post(`${pdpBase}/pdp/piece/pull`, () => {
          requests++
          return HttpResponse.json({}, { status: 500 })
        })
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), limiter: () => false })
      await assert.rejects(
        () => batcher.pull({ pieceCid: pieceCidA, sourceUrl: pullSource(pieceCidA) }),
        (error: unknown) => error instanceof ValidationError && /single addPieces operation/.test(error.message)
      )
      await batcher.close()

      assert.equal(requests, 0)
    })

    it('should reject a pull with invalid metadata with its own error and still pull the rest', async () => {
      const pullBodies: PullRequestCapture[] = []
      server.use(
        pullPiecesPerPieceHandler(
          () => 'complete',
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
      const [bad, good] = await Promise.allSettled([
        batcher.pull({
          pieceCid: pullCids[0] as PieceCID,
          sourceUrl: pullSource(pullCids[0] as PieceCID),
          metadata: { key: 'v'.repeat(97) },
        }),
        batcher.pull({ pieceCid: pullCids[1] as PieceCID, sourceUrl: pullSource(pullCids[1] as PieceCID) }),
      ])
      await batcher.close()

      assert.equal(bad?.status, 'rejected')
      assert.match(String((bad as PromiseRejectedResult).reason?.message), /Metadata value exceeds the maximum length/)
      assert.equal(good?.status, 'fulfilled')
      assert.deepEqual(
        pullBodies.map((body) => body.pieces.map((piece) => piece.pieceCid)),
        [[pullCids[1]?.toString()]]
      )
    })

    it('should reject only the failed piece of a batched pull', async () => {
      const failedCid = pullCids[1]?.toString()
      const pullBodies: PullRequestCapture[] = []
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        pullPiecesPerPieceHandler(
          (pieceCid) => (pieceCid === failedCid ? 'failed' : 'complete'),
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler((body) => addBodies.push(body))
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const settled = Promise.allSettled(
        pullCids.slice(0, 3).map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      )
      await batcher.close()
      const [first, failed, third] = await settled

      assert.equal(pullBodies.length, 1)
      assert.equal(first?.status, 'fulfilled')
      assert.equal(third?.status, 'fulfilled')
      assert.equal(failed?.status, 'rejected')
      assert.ok(failed?.status === 'rejected' && PullError.is(failed.reason))
      assert.equal(addBodies.length, 1)
      assert.equal(addBodies[0]?.pieces.length, 2)
    })

    it('should reject every piece when the pull request itself fails', async () => {
      server.use(
        http.post(`${pdpBase}/pdp/piece/pull`, () => HttpResponse.text('bad request', { status: 400 })),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const settled = Promise.allSettled(
        pullCids.slice(0, 2).map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      )
      await batcher.close()
      const results = await settled

      assert.ok(results.every((result) => result.status === 'rejected' && PullError.is(result.reason)))
    })

    it('should hold pulls for pullDelay before sending them together', async () => {
      const pullBodies: PullRequestCapture[] = []
      server.use(
        pullPiecesPerPieceHandler(
          () => 'complete',
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' }, pullDelay: 50 })
      const pending = pullCids
        .slice(0, 2)
        .map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      await new Promise((resolve) => setTimeout(resolve, 20))
      assert.equal(pullBodies.length, 0)

      await new Promise((resolve) => setTimeout(resolve, 60))
      assert.equal(pullBodies.length, 1)
      assert.equal(pullBodies[0]?.pieces.length, 2)
      await batcher.close()
      await Promise.all(pending)
    })

    it('should limit concurrent pull requests with concurrency', async () => {
      let requests = 0
      let active = 0
      let maxActive = 0
      server.use(
        http.post(`${pdpBase}/pdp/piece/pull`, async ({ request }) => {
          const body = (await request.json()) as PullRequestCapture
          requests++
          active++
          maxActive = Math.max(maxActive, active)
          await new Promise((resolve) => setTimeout(resolve, 10))
          active--
          return HttpResponse.json(createPullResponse('complete', body.pieces))
        }),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), concurrency: 1 })
      const cids = Array.from({ length: SIZE_CONSTANTS.PULL_BATCH_SIZE * 2 + 5 }, (_, index) =>
        pieceCidWithRawSize(300 + index)
      )
      const pending = cids.map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      await batcher.close()
      await Promise.all(pending)

      assert.equal(requests, 3)
      assert.equal(maxActive, 1)
    })

    it('should leave an aborted queued pull out of the request', async () => {
      const pullBodies: PullRequestCapture[] = []
      server.use(
        pullPiecesPerPieceHandler(
          () => 'complete',
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler(() => undefined)
      )
      const [abortedCid, keptCid] = pullCids
      if (abortedCid == null || keptCid == null) {
        return
      }

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const controller = new AbortController()
      const aborted = batcher.pull({
        pieceCid: abortedCid,
        sourceUrl: pullSource(abortedCid),
        signal: controller.signal,
      })
      // Attach the handler now: the aborted pull rejects long before close() returns.
      const abortedRejects = assert.rejects(aborted, (error: Error) => error.name === 'AbortError')
      const kept = batcher.pull({ pieceCid: keptCid, sourceUrl: pullSource(keptCid) })
      controller.abort()
      await batcher.close()

      await abortedRejects
      assert.equal((await kept).pieceCid.toString(), keptCid.toString())
      assert.equal(pullBodies.length, 1)
      assert.deepEqual(
        pullBodies[0]?.pieces.map((piece) => piece.pieceCid),
        [keptCid.toString()]
      )
    })

    it('should call onStatus with only the caller piece status', async () => {
      server.use(
        pullPiecesPerPieceHandler(() => 'complete', undefined, { baseUrl: pdpBase }),
        addPiecesCaptureHandler(() => undefined)
      )
      const seen = new Map<string, string[][]>()

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const pending = pullCids.slice(0, 2).map((pieceCid) =>
        batcher.pull({
          pieceCid,
          sourceUrl: pullSource(pieceCid),
          onStatus: (response) => {
            const calls = seen.get(pieceCid.toString()) ?? []
            calls.push(
              response.pieces.map((piece) => `${piece.pieceCid}:${piece.status}:${response.status}:${piece.index}`)
            )
            seen.set(pieceCid.toString(), calls)
          },
        })
      )
      await batcher.close()
      await Promise.all(pending)

      for (const pieceCid of pullCids.slice(0, 2)) {
        assert.deepEqual(seen.get(pieceCid.toString()), [[`${pieceCid.toString()}:complete:complete:0`]])
      }
    })

    it('should settle every caller when two pulls in one window share a PieceCID', async () => {
      const pullBodies: PullRequestCapture[] = []
      server.use(
        pullPiecesPerPieceHandler(
          (pieceCid) => (pieceCid === pullCids[1].toString() ? 'failed' : 'complete'),
          (body) => pullBodies.push(body),
          { baseUrl: pdpBase }
        ),
        addPiecesCaptureHandler(() => undefined)
      )

      const batcher = createPieceBatcher(client, { dataSet: createDataSet() })
      const [first, failed, second] = await Promise.allSettled(
        [pullCids[0], pullCids[1], pullCids[0]].map((pieceCid) =>
          batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) })
        )
      )
      await batcher.close()

      assert.equal(pullBodies.length, 1)
      assert.equal(pullBodies[0]?.pieces.length, 3)
      assert.equal(first.status, 'fulfilled')
      assert.equal(second.status, 'fulfilled')
      assert.equal(failed.status, 'rejected')
    })

    it('should reject only the caller whose onStatus throws', async () => {
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        pullPiecesPerPieceHandler(() => 'complete', undefined, { baseUrl: pdpBase }),
        addPiecesCaptureHandler((body) => addBodies.push(body))
      )
      const [throwingCid, okCid] = pullCids
      if (throwingCid == null || okCid == null) {
        return
      }
      const callbackError = new Error('onStatus failed')

      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const settled = Promise.allSettled([
        batcher.pull({
          pieceCid: throwingCid,
          sourceUrl: pullSource(throwingCid),
          onStatus: () => {
            throw callbackError
          },
        }),
        batcher.pull({ pieceCid: okCid, sourceUrl: pullSource(okCid) }),
      ])
      await batcher.close()
      const [throwing, ok] = await settled

      assert.ok(throwing?.status === 'rejected' && throwing.reason === callbackError)
      assert.equal(ok?.status, 'fulfilled')
      assert.equal(addBodies.length, 1)
      assert.deepEqual(
        addBodies[0]?.pieces.map((piece) => piece.pieceCid),
        [okCid.toString()]
      )
    })

    it('should reject a negative pullDelay', () => {
      assert.throws(
        () => createPieceBatcher(client, { dataSet: createDataSet(), pullDelay: -1 }),
        (error: unknown) => ValidationError.is(error)
      )
    })
  })

  describe('onSubmitted and resume', () => {
    it('should call onSubmitted once per submission with a JSON-safe record, before pieces settle', async () => {
      const bodies: addPiecesApiRequest.RequestBody[] = []
      server.use(addPiecesCaptureHandler((body) => bodies.push(body)))
      const events: string[] = []
      const submitted: SubmittedBatch[] = []
      const batcher = createPieceBatcher(client, {
        dataSet: createDataSet(),
        wait: { kind: 'limiter' },
        limiter: ({ pieces }) => pieces.length <= 1,
        onSubmitted: async (batch) => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          events.push(`submitted:${batch.pieces[0]?.pieceCid}`)
          submitted.push(batch)
        },
      })
      const settled = (result: { pieceCid: PieceCID }) => {
        events.push(`settled:${result.pieceCid.toString()}`)
      }
      const a = batcher.enqueue({ pieceCid: pieceCidA, metadata: { name: 'a' } }).then(settled)
      const b = batcher.enqueue({ pieceCid: pieceCidB }).then(settled)
      await batcher.close()
      await Promise.all([a, b])

      assert.equal(submitted.length, 2)
      assert.deepEqual(submitted[0], {
        kind: 'addPieces',
        txHash: mockTxHash,
        extraData: bodies[0]?.extraData,
        payer: ADDRESSES.client1,
        dataSetId: '1',
        clientDataSetId: '0',
        pieces: [{ pieceCid: pieceCidA.toString(), metadata: { name: 'a' } }],
      })
      assert.deepEqual(submitted[1]?.pieces, [{ pieceCid: pieceCidB.toString() }])
      for (const batch of submitted) {
        assert.deepEqual(JSON.parse(JSON.stringify(batch)), batch)
      }
      assert.deepEqual(events, [
        `submitted:${pieceCidA.toString()}`,
        `settled:${pieceCidA.toString()}`,
        `submitted:${pieceCidB.toString()}`,
        `settled:${pieceCidB.toString()}`,
      ])
    })

    it('should leave pieces rejected by validation out of the submitted batch', async () => {
      server.use(addPiecesCaptureHandler(() => undefined))
      const submitted: SubmittedBatch[] = []
      const batcher = createPieceBatcher(client, {
        dataSet: createDataSet(),
        wait: { kind: 'limiter' },
        onSubmitted: (batch) => {
          submitted.push(batch)
        },
      })
      const good = batcher.enqueue({ pieceCid: pieceCidA })
      const bad = batcher.enqueue({ pieceCid: pieceCidB, metadata: { name: 'x'.repeat(97) } })
      await batcher.close()
      await good
      await assert.rejects(bad, /value exceeds the maximum length/)

      assert.equal(submitted.length, 1)
      assert.deepEqual(submitted[0]?.pieces, [{ pieceCid: pieceCidA.toString() }])
    })

    it('should call onSubmitted once for a window of batched pulls', async () => {
      server.use(
        pullPiecesPerPieceHandler(() => 'complete', undefined, { baseUrl: pdpBase }),
        addPiecesCaptureHandler(() => undefined)
      )
      const submitted: SubmittedBatch[] = []
      const batcher = createPieceBatcher(client, {
        dataSet: createDataSet(),
        onSubmitted: (batch) => {
          submitted.push(batch)
        },
      })
      const results = await Promise.all(
        pullCids.map((pieceCid) => batcher.pull({ pieceCid, sourceUrl: pullSource(pieceCid) }))
      )
      await batcher.close()

      assert.equal(submitted.length, 1)
      assert.equal(submitted[0]?.pieces.length, pullCids.length)
      for (const result of results) {
        assert.equal(submitted[0]?.pieces[result.batchIndex]?.pieceCid, result.pieceCid.toString())
      }
    })

    it('should reject the window with the onSubmitted error, not AddPiecesFlushError', async () => {
      let posts = 0
      server.use(addPiecesCaptureHandler(() => posts++))
      const persistError = new Error('disk full')
      const batcher = createPieceBatcher(client, {
        dataSet: createDataSet(),
        wait: { kind: 'limiter' },
        onSubmitted: () => {
          throw persistError
        },
      })
      const pending = batcher.enqueue({ pieceCid: pieceCidA })
      assert.equal(await batcher.flush(), undefined)
      await assert.rejects(pending, (error: unknown) => error === persistError)
      assert.equal(posts, 1)
      await batcher.close()
    })

    it('should resume a persisted addPieces batch to the same result without resubmitting', async () => {
      server.use(
        JSONRPC({ ...presets.basic, ...landedTransactions({ [mockTxHash]: { dataSetId: 1n, pieceIds: [7n, 8n] } }) }),
        addPiecesCaptureHandler(() => undefined)
      )
      let persisted = ''
      const first = createPieceBatcher(client, {
        dataSet: createDataSet(),
        wait: { kind: 'limiter' },
        onSubmitted: (batch) => {
          persisted = JSON.stringify(batch)
        },
      })
      void first.enqueue({ pieceCid: pieceCidA, metadata: { name: 'a' } })
      void first.enqueue({ pieceCid: pieceCidB, size: 200 })
      const uninterrupted = await first.flush()
      await first.close()

      let resubmits = 0
      server.use(...noSubmitHandlers(() => resubmits++))
      // A batcher made for a new data set adopts the batch's data set.
      const restarted = createPieceBatcher(client, newDataSetOptions)
      const resumed = await restarted.resume(JSON.parse(persisted))
      await restarted.close()

      assert.equal(resubmits, 0)
      assert.deepEqual(comparable(resumed), comparable(uninterrupted))
      assert.equal(restarted.dataSet?.dataSetId, 1n)
      assert.deepEqual((await waitForFlushReceipt(client, resumed)).pieceIds, [7n, 8n])
    })

    it('should resume a createDataSetAndAddPieces batch after a crash without a duplicate data set', async () => {
      let creates = 0
      server.use(
        JSONRPC({ ...presets.basic, ...landedTransactions(createdTransaction) }),
        countingCreateHandler(() => creates++)
      )

      // Crashing run: persist the submission, then die before the pieces settle.
      let persisted = ''
      const crashing = createPieceBatcher(client, {
        ...newDataSetOptions,
        onSubmitted: (batch) => {
          persisted = JSON.stringify(batch)
          throw new Error('crash')
        },
      })
      const lost = crashing.enqueue({ pieceCid: pieceCidA })
      await crashing.flush()
      await assert.rejects(lost, /crash/)
      const batch: SubmittedBatch = JSON.parse(persisted)
      assert.equal(batch.kind, 'createDataSetAndAddPieces')
      assert.ok(!('dataSetId' in batch))

      // Restart: resume, then keep adding. Later pieces go to the created data set.
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(addPiecesCaptureHandler((body) => addBodies.push(body), mockTxHash2))
      const restarted = createPieceBatcher(client, newDataSetOptions)
      const resumed = await restarted.resume(batch)
      const pending = restarted.enqueue({ pieceCid: pieceCidB })
      await restarted.close()
      const next = await pending

      assert.equal(creates, 1)
      assert.equal(addBodies.length, 1)
      assert.equal(next.isNewDataSet, false)
      assert.deepEqual(comparable(resumed), {
        txHash: mockTxHash,
        confirmedTxHash: mockTxHash,
        extraData: batch.extraData,
        payer: ADDRESSES.client1,
        dataSetId: 1n,
        clientDataSetId: BigInt(batch.clientDataSetId),
        isNewDataSet: true,
        pieces: [{ pieceCid: pieceCidA.toString() }],
        receipt: resumed.receipt,
      })
      assert.deepEqual((await waitForFlushReceipt(client, resumed)).pieceIds, [0n])
    })

    it('should add later pieces to the created data set after a create window onSubmitted failure', async () => {
      let creates = 0
      const addBodies: addPiecesApiRequest.RequestBody[] = []
      server.use(
        JSONRPC({ ...presets.basic, ...landedTransactions(createdTransaction) }),
        countingCreateHandler(() => creates++),
        addPiecesCaptureHandler((body) => addBodies.push(body), mockTxHash2)
      )
      let calls = 0
      const batcher = createPieceBatcher(client, {
        ...newDataSetOptions,
        limiter: ({ pieces }) => pieces.length <= 1,
        onSubmitted: () => {
          calls++
          if (calls === 1) {
            throw new Error('persist failed')
          }
        },
      })
      const first = batcher.enqueue({ pieceCid: pieceCidA })
      const second = batcher.enqueue({ pieceCid: pieceCidB })
      await batcher.close()

      await assert.rejects(first, /persist failed/)
      const added = await second
      assert.equal(creates, 1)
      assert.equal(addBodies.length, 1)
      assert.equal(added.txHash, mockTxHash2)
      assert.equal(added.isNewDataSet, false)
      assert.equal(batcher.dataSet?.dataSetId, 1n)
    })

    it('should create again after a create window whose onSubmitted failed was not applied', async () => {
      let creates = 0
      server.use(
        JSONRPC({ ...presets.basic, ...landedTransactions({ [mockTxHash]: { reverted: true } }) }),
        countingCreateHandler(() => creates++)
      )
      const batcher = createPieceBatcher(client, {
        ...newDataSetOptions,
        onSubmitted: () => {
          throw new Error('persist failed')
        },
      })
      const first = batcher.enqueue({ pieceCid: pieceCidA })
      await batcher.flush()
      await assert.rejects(first, /persist failed/)
      assert.equal(batcher.dataSet, undefined)

      const second = batcher.enqueue({ pieceCid: pieceCidB })
      await batcher.close()
      await assert.rejects(second, /persist failed/)
      assert.equal(creates, 2)
    })

    it('should reject a resumed create that was not applied and keep creating', async () => {
      server.use(JSONRPC({ ...presets.basic, ...landedTransactions({ [mockTxHash]: { reverted: true } }) }))
      const batcher = createPieceBatcher(client, newDataSetOptions)
      await assert.rejects(
        batcher.resume({
          kind: 'createDataSetAndAddPieces',
          txHash: mockTxHash,
          extraData: '0x',
          clientDataSetId: '5',
          pieces: [{ pieceCid: pieceCidA.toString() }],
        }),
        (error: unknown) => TransactionNotAppliedError.is(error)
      )
      assert.equal(batcher.dataSet, undefined)
      await batcher.close()
    })

    it('should reject a malformed batch or one for another data set', async () => {
      const batcher = createPieceBatcher(client, { dataSet: createDataSet(), wait: { kind: 'limiter' } })
      const batch: SubmittedBatch = {
        kind: 'addPieces',
        txHash: mockTxHash,
        extraData: '0x',
        payer: ADDRESSES.client1,
        dataSetId: '2',
        clientDataSetId: '0',
        pieces: [{ pieceCid: pieceCidA.toString() }],
      }
      const rejectsValidation = (value: SubmittedBatch) =>
        assert.rejects(batcher.resume(value), (error: unknown) => ValidationError.is(error))
      await rejectsValidation(batch)
      await rejectsValidation({ ...batch, dataSetId: '1n' })
      await rejectsValidation({ ...batch, clientDataSetId: '-1' })
      await rejectsValidation({ ...batch, dataSetId: '1', pieces: [{ pieceCid: 'nope' }] })
      await rejectsValidation({ ...batch, dataSetId: '1', pieces: [] })
      await batcher.close()
      await rejectsValidation({ ...batch, dataSetId: '1' })
    })
  })
})
