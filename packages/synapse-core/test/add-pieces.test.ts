import assert from 'assert'
import { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../src/errors/pdp.ts'
import { AtLeastOnePieceRequiredError } from '../src/errors/warm-storage.ts'
import * as Piece from '../src/piece/index.ts'
import { addPiecesFits, assertAddPiecesFit } from '../src/utils/add-pieces-fits.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'
import { pieceCidWithRawSize } from './utils/piece-cid.ts'

const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
const tooSmallPieceCid = Piece.from('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')

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

  it('should enforce the legacy data-set cap', () => {
    const legacyPieceStorageIdLimit = 10n
    const dataSetId = 1n
    const pieces = Array.from({ length: 80 }, () => ({ pieceCid }))
    assert.doesNotThrow(() => assertAddPiecesFit({ kind: 'addPieces', dataSetId, legacyPieceStorageIdLimit, pieces }))
    assert.throws(
      () =>
        assertAddPiecesFit({
          kind: 'addPieces',
          dataSetId,
          legacyPieceStorageIdLimit,
          pieces: [...pieces, { pieceCid }],
        }),
      AddPiecesBatchTooLargeError
    )
  })

  it('should allow more than 40 pieces when they fit the message-size budget', () => {
    const pieces = Array.from({ length: 41 }, () => ({ pieceCid }))
    assert.doesNotThrow(() => assertAddPiecesFit({ kind: 'addPieces', pieces }))
    assert.doesNotThrow(() => assertAddPiecesFit({ kind: 'createDataSetAndAddPieces', pieces }))
  })

  it('should throw when a PieceCID is below MIN_UPLOAD_SIZE', () => {
    assert.throws(
      () => assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid: tooSmallPieceCid }] }),
      InvalidUploadSizeError
    )
  })

  it('should accept a PieceCID at MAX_UPLOAD_SIZE (64 GiB padded)', () => {
    const atMax = pieceCidWithRawSize(SIZE_CONSTANTS.MAX_UPLOAD_SIZE)
    assert.equal(atMax.size, SIZE_CONSTANTS.MAX_UPLOAD_SIZE)
    assert.equal(atMax.paddedSize, 64n * SIZE_CONSTANTS.GiB)
    assert.doesNotThrow(() => assertAddPiecesFit({ kind: 'addPieces', pieces: [{ pieceCid: atMax }] }))
  })

  it('should throw when a PieceCID is above MAX_UPLOAD_SIZE', () => {
    const tooLarge = pieceCidWithRawSize(SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
    assert.equal(tooLarge.size, SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
    assert.equal(tooLarge.paddedSize, 128n * SIZE_CONSTANTS.GiB)
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
