/* globals describe it */
import { assert } from 'chai'
import { EIP712_ENCODED_TYPES, EIP712_TYPE_HASHES } from '../utils/eip712.ts'

describe('EIP712 Type String Generator', () => {
  it('should generate correct type string for nested type', () => {
    const result = EIP712_ENCODED_TYPES.AddPieces
    // nested & sorted
    const expected =
      'AddPieces(uint256 clientDataSetId,uint256 nonce,Cid[] pieceData,PieceMetadata[] pieceMetadata)Cid(bytes data)MetadataEntry(string key,string value)PieceMetadata(uint256 pieceIndex,MetadataEntry[] metadata)'
    assert.equal(result, expected)

    const expectedHash = '0x954bdc254591a7eab1b73f03842464d9283a08352772737094d710a4428fd183'
    assert.equal(EIP712_TYPE_HASHES.AddPieces, expectedHash)
  })

  it('should handle types with no dependencies', () => {
    const result = EIP712_ENCODED_TYPES.DeleteDataSet
    // DeleteDataSet has no custom type dependencies
    assert.equal(result, 'DeleteDataSet(uint256 clientDataSetId)')
  })
})
