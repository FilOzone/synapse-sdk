import assert from 'assert'
import { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../src/errors/pdp.ts'
import { AtLeastOnePieceRequiredError } from '../src/errors/warm-storage.ts'
import * as Piece from '../src/piece/index.ts'
import * as Digest from '../src/piece/internal/digest.ts'
import { PieceCID } from '../src/piece/piece-cid.ts'
import { addPiecesFits, assertAddPiecesFit } from '../src/sp/add-pieces-fits.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
const tooSmallPieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

function pieceCidWithRawSize(rawSize: number): PieceCID {
  const height = Piece.heightFor(rawSize < Piece.MIN_SIZE ? Piece.MIN_SIZE : rawSize)
  const root = new Uint8Array(32)
  const probe = PieceCID._fromDigest(Digest.fromFields({ padding: 0n, height, root }))
  return PieceCID._fromDigest(Digest.fromFields({ padding: BigInt(probe.size - rawSize), height, root }))
}

const maxMetadata = {
  aaa: 'x'.repeat(96),
  bbb: 'y'.repeat(96),
  ccc: 'z'.repeat(96),
}

function oversizedBatch() {
  const next = { pieceCid, metadata: maxMetadata }
  const pieces = [next]
  while (addPiecesFits({ kind: 'addPieces', pieces: [...pieces, next] })) {
    pieces.push(next)
  }
  pieces.push(next)
  return pieces
}

describe('assertAddPiecesFit', () => {
  it('should throw when empty', () => {
    assert.throws(() => assertAddPiecesFit({ kind: 'addPieces', pieces: [] }), AtLeastOnePieceRequiredError)
  })

  it('should accept a single small piece', () => {
    assert.doesNotThrow(() => assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid }] }))
  })

  for (const kind of ['addPieces', 'createDataSetAndAddPieces'] as const) {
    it(`should reject ${kind} above 40 pieces`, () => {
      const pieces = Array.from({ length: 40 }, () => ({ pieceCid }))
      assert.doesNotThrow(() => assertAddPiecesFit({ kind, pieces }))
      assert.throws(() => assertAddPiecesFit({ kind, pieces: [...pieces, { pieceCid }] }), AddPiecesBatchTooLargeError)
    })
  }

  it('should throw when a PieceCID is below MIN_UPLOAD_SIZE', () => {
    assert.throws(
      () => assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid: tooSmallPieceCid }] }),
      InvalidUploadSizeError
    )
  })

  it('should throw when a PieceCID is above MAX_UPLOAD_SIZE', () => {
    const tooLarge = pieceCidWithRawSize(SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
    assert.equal(tooLarge.size, SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
    assert.throws(
      () => assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid: tooLarge }] }),
      InvalidUploadSizeError
    )
  })

  it('should throw when the batch exceeds the limiter', () => {
    assert.throws(
      () => assertAddPiecesFit({ kind: 'addPieces', pieces: oversizedBatch() }),
      AddPiecesBatchTooLargeError
    )
  })
})
