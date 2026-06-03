import assert from 'assert'
import { AtLeastOnePieceRequiredError, TooManyPiecesError } from '../src/errors/warm-storage.ts'
import { validateAddPiecesBatch } from '../src/sp/add-pieces.ts'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'

describe('validateAddPiecesBatch', () => {
  const max = SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE

  it('should throw when empty', () => {
    assert.throws(() => validateAddPiecesBatch(0), AtLeastOnePieceRequiredError)
  })

  it('should accept a count at the maximum', () => {
    assert.doesNotThrow(() => validateAddPiecesBatch(max))
  })

  it('should throw when above the maximum', () => {
    assert.throws(() => validateAddPiecesBatch(max + 1), TooManyPiecesError)
  })
})
