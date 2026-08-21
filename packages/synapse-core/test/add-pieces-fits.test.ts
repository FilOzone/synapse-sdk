import assert from 'assert'
import { ADDRESSES } from '../src/mocks/jsonrpc/constants.ts'
import * as Piece from '../src/piece/index.ts'
import { addPiecesFits, estimateAddPiecesCalldataSize } from '../src/sp/add-pieces-fits.ts'
import type { PdpDataSet } from '../src/warm-storage/types.ts'

const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

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
        serviceURL: 'https://pdp.example.com',
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

describe('addPiecesFits', () => {
  const dataSet = createDataSet()

  it('should return false when empty', () => {
    assert.equal(
      addPiecesFits({
        kind: 'addPieces',
        dataSet,
        pieces: [],
      }),
      false
    )
  })

  it('should return true for a single small piece', () => {
    assert.equal(
      addPiecesFits({
        kind: 'addPieces',
        dataSet,
        pieces: [{ pieceCid }],
      }),
      true
    )
  })

  it('should accept more than the old 40-piece count cap when pieces are small', () => {
    const pieces = Array.from({ length: 41 }, () => ({ pieceCid }))
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces }), true)
  })

  it('should treat createDataSetAndAddPieces as larger than addPieces', () => {
    const pieces = [{ pieceCid, metadata: { name: 'a', type: 'b' } }]
    const addSize = estimateAddPiecesCalldataSize({ kind: 'addPieces', dataSet, pieces })
    const createSize = estimateAddPiecesCalldataSize({
      kind: 'createDataSetAndAddPieces',
      metadata: { withCDN: '' },
      cdn: true,
      pieces,
    })
    assert.ok(createSize > addSize)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
  })

  it('should eventually reject a list of max-metadata pieces', () => {
    const metadata = {
      aaa: 'x'.repeat(96),
      bbb: 'y'.repeat(96),
      ccc: 'z'.repeat(96),
    }
    let count = 1
    while (
      count < 10_000 &&
      addPiecesFits({
        kind: 'addPieces',
        pieces: Array.from({ length: count }, () => ({ pieceCid, metadata })),
      })
    ) {
      count++
    }
    assert.equal(
      addPiecesFits({
        kind: 'addPieces',
        pieces: Array.from({ length: count }, () => ({ pieceCid, metadata })),
      }),
      false
    )
    assert.ok(count > 1)
    assert.ok(count < 10_000)
  })

  it('should support a custom count limiter', () => {
    const limiter = ({ pieces }: { pieces: unknown[] }) => pieces.length <= 8
    assert.equal(limiter({ pieces: Array.from({ length: 8 }) }), true)
    assert.equal(limiter({ pieces: Array.from({ length: 9 }) }), false)
  })
})
