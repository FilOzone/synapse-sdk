import assert from 'assert'
import { encodeAbiParameters, encodeFunctionData, size, toHex, zeroAddress } from 'viem'
import { pdpVerifierAbi } from '../src/abis/generated.ts'
import * as Piece from '../src/piece/index.ts'
import { addPiecesFits, estimateAddPiecesCalldataSize } from '../src/sp/add-pieces-fits.ts'
import { signAddPiecesAbiParameters } from '../src/typed-data/sign-add-pieces.ts'

const pieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

describe('addPiecesFits', () => {
  it('should return false when empty', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [] }), false)
  })

  it('should return true for a single small piece', () => {
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces: [{ pieceCid }] }), true)
  })

  it('should allow more than 40 pieces when they fit the message-size budget', () => {
    const pieces = Array.from({ length: 41 }, () => ({ pieceCid }))
    assert.equal(addPiecesFits({ kind: 'addPieces', pieces }), true)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
  })

  it('should enforce the legacy data-set cap', () => {
    const pieces = Array.from({ length: 80 }, () => ({ pieceCid }))
    const legacy = { kind: 'addPieces' as const, dataSetId: 9n, legacyPieceStorageIdLimit: 10n }
    assert.equal(addPiecesFits({ ...legacy, pieces }), true)
    pieces.push({ pieceCid })
    assert.equal(addPiecesFits({ ...legacy, pieces }), false)
    assert.equal(addPiecesFits({ ...legacy, dataSetId: 10n, pieces }), true)
    assert.equal(addPiecesFits({ ...legacy, dataSetId: undefined, pieces }), true)
    assert.equal(addPiecesFits({ ...legacy, legacyPieceStorageIdLimit: undefined, pieces }), true)
    assert.equal(addPiecesFits({ kind: 'createDataSetAndAddPieces', pieces }), true)
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
