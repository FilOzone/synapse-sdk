import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { LimitMustBeGreaterThanZeroError } from '../src/errors/pdp-verifier.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPieces, getPiecesWithMetadata } from '../src/pdp-verifier/get-pieces.ts'
import * as Piece from '../src/piece/piece.ts'
import type { PdpDataSet } from '../src/warm-storage/types.ts'

describe('getPieces', () => {
  const server = setup()

  const firstPieceCid = Piece.parse('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

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
      activePieceCount: 2n,
      provider: {
        id: 1n,
        serviceProvider: ADDRESSES.serviceProvider1,
        payee: ADDRESSES.payee1,
        isActive: true,
        name: 'provider-1',
        description: 'test provider',
        pdp: {
          serviceURL: 'https://pdp.example.com/pdp/',
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

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  it('should fetch pieces and filter deduplicated scheduled removals', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getScheduledRemovals: () => [[1n, 1n]],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getPieces(client, {
      dataSet: createDataSet(),
      address: ADDRESSES.client1,
    })

    assert.deepEqual(result, {
      hasMore: false,
      pieces: [
        {
          cid: firstPieceCid,
          id: 0n,
          url: `https://pdp.example.com/pdp/piece/${firstPieceCid.toString()}`,
        },
      ],
    })
  })

  it('should return an empty result when the data set is not live', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getActivePieces: () => {
            throw new Error('Data set not live')
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getPieces(client, {
      dataSet: createDataSet(),
      address: ADDRESSES.client1,
    })

    assert.deepEqual(result, {
      pieces: [],
      hasMore: false,
    })
  })

  it('should throw when getPieces limit is negative', async () => {
    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    await assert.rejects(
      () =>
        getPieces(client, {
          dataSet: createDataSet(),
          address: ADDRESSES.client1,
          limit: -1n,
        }),
      LimitMustBeGreaterThanZeroError
    )
  })

  it('should return an empty result from getPiecesWithMetadata without requesting metadata when there are no pieces', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        pdpVerifier: {
          ...presets.basic.pdpVerifier,
          getActivePieces: () => [[], [], false],
        },
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getAllPieceMetadata: () => {
            throw new Error('metadata lookup should not happen')
          },
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getPiecesWithMetadata(client, {
      dataSet: createDataSet(),
      address: ADDRESSES.client1,
    })

    assert.deepEqual(result, {
      pieces: [],
      hasMore: false,
    })
  })

  it('should throw when getPiecesWithMetadata limit is negative', async () => {
    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    await assert.rejects(
      () =>
        getPiecesWithMetadata(client, {
          dataSet: createDataSet(),
          address: ADDRESSES.client1,
          limit: -1n,
        }),
      LimitMustBeGreaterThanZeroError
    )
  })
})
