import assert from 'assert'
import { encodeAbiParameters, encodeFunctionData, size, toHex, zeroAddress } from 'viem'
import { pdpVerifierAbi } from '../src/abis/generated.ts'
import * as Piece from '../src/piece/index.ts'
import { addPiecesFits, estimateAddPiecesCalldataSize } from '../src/sp/add-pieces-fits.ts'
import { signAddPiecesAbiParameters } from '../src/typed-data/sign-add-pieces.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

describe('addPiecesFits', () => {
  it('should return false when empty', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [] }), false)
  })

  it('should return true for a single small piece', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [{ pieceCid }] }), true)
  })

  for (const kind of ['addPieces', 'createDataSetAndAddPieces'] as const) {
    it(`should retain the 40-piece provider cap for ${kind}`, () => {
      const pieces = Array.from({ length: 40 }, () => ({ pieceCid }))
      assert.equal(addPiecesFits({ kind, pieces }), true)
      assert.equal(addPiecesFits({ kind, pieces: [...pieces, { pieceCid }] }), false)
    })
  }

  it('should enforce the legacy cap when the provider cap is raised', () => {
    const providerCap = SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE
    // Simulate provider support for larger batches to exercise the legacy boundary.
    Object.assign(SIZE_CONSTANTS, { MAX_ADD_PIECES_BATCH_SIZE: 100 })
    try {
      const pieces = Array.from({ length: 80 }, () => ({ pieceCid }))
      const legacy = { kind: 'addPieces' as const, dataSetId: 9n, legacyPieceStorageIdLimit: 10n }
      assert.equal(addPiecesFits({ ...legacy, pieces }), true)
      pieces.push({ pieceCid })
      assert.equal(addPiecesFits({ ...legacy, pieces }), false)
      assert.equal(addPiecesFits({ ...legacy, dataSetId: 10n, pieces }), true)
      assert.equal(addPiecesFits({ ...legacy, dataSetId: undefined, pieces }), true)
      assert.equal(addPiecesFits({ ...legacy, legacyPieceStorageIdLimit: undefined, pieces }), true)
      assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
    } finally {
      Object.assign(SIZE_CONSTANTS, { MAX_ADD_PIECES_BATCH_SIZE: providerCap })
    }
  })

  it('should use compact metadata when every piece has none', () => {
    const emptyPieces = Array.from({ length: 2 }, () => ({ pieceCid }))
    const extraData = encodeAbiParameters(signAddPiecesAbiParameters, [0n, [], [], `0x${'00'.repeat(65)}`])
    const expectedCalldata = encodeFunctionData({
      abi: pdpVerifierAbi,
      functionName: 'addPieces',
      args: [0n, zeroAddress, emptyPieces.map((piece) => ({ data: toHex(piece.pieceCid.bytes) })), extraData],
    })

    assert.equal(estimateAddPiecesCalldataSize({ kind: 'addPieces', pieces: emptyPieces }), size(expectedCalldata))
  })

  it('should treat createDataSetAndAddPieces as larger than addPieces', () => {
    const pieces = [{ pieceCid, metadata: { name: 'a', type: 'b' } }]
    const addSize = estimateAddPiecesCalldataSize({ kind: 'addPieces', pieces })
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
