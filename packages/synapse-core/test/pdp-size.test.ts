import assert from 'assert'
import {
  leafCountToRawSize,
  pieceSizesToLeafCount,
  rawSizeToLeafCount,
  validatePieceSizes,
} from '../src/utils/pdp-size.ts'

describe('PDP size utilities', () => {
  it('should convert padded leaves to FWSS-priced bytes using the 127/128 ratio', () => {
    assert.equal(leafCountToRawSize(4n), 127n)
    assert.equal(leafCountToRawSize(128n), 4064n)
  })

  it('should round each known raw piece size up to its PDP data-bearing leaves', () => {
    assert.equal(rawSizeToLeafCount(1n), 1n)
    assert.equal(rawSizeToLeafCount(31n), 1n)
    assert.equal(rawSizeToLeafCount(32n), 2n)
    assert.equal(rawSizeToLeafCount(127n), 4n)
    assert.equal(rawSizeToLeafCount(128n), 5n)
  })

  it('should round leaves independently for pieces with the same total raw size', () => {
    assert.equal(pieceSizesToLeafCount([32n, 32n]), 4n)
    assert.equal(pieceSizesToLeafCount([1n, 63n]), 3n)
  })

  it('should reject empty lists and non-positive piece sizes', () => {
    assert.throws(() => validatePieceSizes([]), /at least one piece/)
    assert.throws(() => validatePieceSizes([0n]), /only positive byte sizes/)
  })
})
