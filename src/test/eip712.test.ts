/* globals describe it */
import { assert } from 'chai'
import { getEIP712TypeString } from '../utils/eip712.ts'

describe('EIP712 Type String Generator', () => {
  it('should generate correct type string for nested type', () => {
    const result = getEIP712TypeString('AddPieces')
    // nested & sorted
    const expected =
      'AddPieces(uint256 clientDataSetId,uint256 firstAdded,Cid[] pieceData,PieceMetadata[] pieceMetadata)Cid(bytes data)MetadataEntry(string key,string value)PieceMetadata(uint256 pieceIndex,MetadataEntry[] metadata)'
    assert.equal(result, expected)
  })

  it('should throw error for non-existent type', () => {
    assert.throws(
      () => getEIP712TypeString('NonExistentType'),
      Error,
      "Type 'NonExistentType' does not exist in EIP712_TYPES"
    )
  })

  it('should handle types with no dependencies', () => {
    const result = getEIP712TypeString('DeleteDataSet')
    // DeleteDataSet has no custom type dependencies
    assert.equal(result, 'DeleteDataSet(uint256 clientDataSetId)')
  })
})
