/* globals describe it */
import { assert } from 'chai'
import { EIP712_ENCODED_TYPES, EIP712_TYPE_HASHES } from '../utils/eip712.ts'

describe('EIP712 Type String Generator', () => {
  it('should generate correct type string for nested type', () => {
    const result = EIP712_ENCODED_TYPES.AddPieces
    // nested & sorted
    const expected =
      'AddPieces(uint256 clientDataSetId,uint256 firstAdded,Cid[] pieceData,PieceMetadata[] pieceMetadata)Cid(bytes data)MetadataEntry(string key,string value)PieceMetadata(uint256 pieceIndex,MetadataEntry[] metadata)'
    assert.equal(result, expected)

    const expectedHash = '0xb557d81ec3b03a60fa3cc207f13ad04af6c95850e1955114d0a0f40919e49ffd'
    assert.equal(EIP712_TYPE_HASHES.AddPieces, expectedHash)
  })

  it('should handle types with no dependencies', () => {
    const result = EIP712_ENCODED_TYPES.DeleteDataSet
    // DeleteDataSet has no custom type dependencies
    assert.equal(result, 'DeleteDataSet(uint256 clientDataSetId)')
  })
})
