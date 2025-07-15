/* globals describe it */
import { assert } from 'chai'
import {
  isProofSetCreationStatusResponse,
  isRootAdditionStatusResponse,
  isFindPieceResponse,
  validateProofSetCreationStatusResponse,
  validateRootAdditionStatusResponse,
  validateFindPieceResponse,
  asProofSetRootData,
  asProofSetData
} from '../pdp/validation.js'

describe('PDP Validation', function () {
  describe('ProofSetCreationStatusResponse validation', function () {
    it('should validate a valid response', function () {
      const validResponse = {
        createMessageHash: '0x123abc',
        proofSetCreated: true,
        service: 'pandora',
        txStatus: 'confirmed',
        ok: true,
        proofSetId: 123
      }

      assert.isTrue(isProofSetCreationStatusResponse(validResponse))
      assert.deepEqual(
        validateProofSetCreationStatusResponse(validResponse),
        validResponse
      )
    })

    it('should validate response with null ok field', function () {
      const validResponse = {
        createMessageHash: '0x123abc',
        proofSetCreated: false,
        service: 'pandora',
        txStatus: 'pending',
        ok: null
      }

      assert.isTrue(isProofSetCreationStatusResponse(validResponse))
      assert.deepEqual(
        validateProofSetCreationStatusResponse(validResponse),
        validResponse
      )
    })

    it('should validate response with lowercase proofsetCreated field (Curio compatibility)', function () {
      // NOTE: This test ensures forward compatibility with Curio
      // Curio currently returns "proofsetCreated" (lowercase 's') but this SDK normalizes to "proofSetCreated" (uppercase 'S')
      const curioResponse = {
        createMessageHash: '0x6a599b48ec4624250b4629c7bfeb4c1a0f51cdc9bd05a5993caf1e873e924f09',
        proofsetCreated: true, // NOTE: lowercase 's' - this is what Curio currently returns
        service: 'public',
        txStatus: 'confirmed',
        ok: true,
        proofSetId: 481
      }

      assert.isTrue(isProofSetCreationStatusResponse(curioResponse))
      const normalized = validateProofSetCreationStatusResponse(curioResponse)

      // Verify normalization - should have uppercase 'S' in final response
      assert.equal(normalized.proofSetCreated, true)
      assert.equal(normalized.createMessageHash, curioResponse.createMessageHash)
      assert.equal(normalized.service, curioResponse.service)
      assert.equal(normalized.txStatus, curioResponse.txStatus)
      assert.equal(normalized.ok, curioResponse.ok)
      assert.equal(normalized.proofSetId, curioResponse.proofSetId)
    })

    it('should validate response with both proofSetCreated and proofsetCreated fields', function () {
      // Edge case: if both fields are present, prefer proofSetCreated
      const mixedResponse = {
        createMessageHash: '0x123abc',
        proofSetCreated: true,
        proofsetCreated: false, // This should be ignored
        service: 'pandora',
        txStatus: 'confirmed',
        ok: true,
        proofSetId: 123
      }

      assert.isTrue(isProofSetCreationStatusResponse(mixedResponse))
      const normalized = validateProofSetCreationStatusResponse(mixedResponse)

      // Should prefer proofSetCreated over proofsetCreated
      assert.equal(normalized.proofSetCreated, true)
    })

    it('should reject invalid responses', function () {
      const invalidResponses = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { createMessageHash: 123 }, // Wrong type
        { createMessageHash: '0x123', proofSetCreated: 'yes' }, // Wrong type
        { createMessageHash: '0x123', proofsetCreated: 'yes' }, // Wrong type (lowercase field)
        { createMessageHash: '0x123', service: 'pandora', txStatus: 'pending', ok: null }, // Missing both proofSetCreated and proofsetCreated
        {
          createMessageHash: '0x123',
          proofSetCreated: true,
          service: 'pandora',
          txStatus: 'pending'
          // Missing ok field
        },
        {
          createMessageHash: '0x123',
          proofSetCreated: true,
          service: 'pandora',
          txStatus: 'pending',
          ok: null,
          proofSetId: 'abc' // Wrong type
        }
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isProofSetCreationStatusResponse(invalid))
        assert.throws(() => validateProofSetCreationStatusResponse(invalid))
      }
    })
  })

  describe('RootAdditionStatusResponse validation', function () {
    it('should validate a valid response', function () {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'confirmed',
        proofSetId: 123,
        rootCount: 5,
        addMessageOk: true,
        confirmedRootIds: [1, 2, 3, 4, 5]
      }

      assert.isTrue(isRootAdditionStatusResponse(validResponse))
      assert.deepEqual(
        validateRootAdditionStatusResponse(validResponse),
        validResponse
      )
    })

    it('should validate response with null addMessageOk', function () {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'pending',
        proofSetId: 123,
        rootCount: 5,
        addMessageOk: null
      }

      assert.isTrue(isRootAdditionStatusResponse(validResponse))
      assert.deepEqual(
        validateRootAdditionStatusResponse(validResponse),
        validResponse
      )
    })

    it('should reject invalid responses', function () {
      const invalidResponses = [
        null,
        undefined,
        {
          txHash: '0x456def',
          txStatus: 'pending',
          proofSetId: '123', // Wrong type
          rootCount: 5,
          addMessageOk: null
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          proofSetId: 123,
          rootCount: 5,
          addMessageOk: null,
          confirmedRootIds: 'not-array' // Wrong type
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          proofSetId: 123,
          rootCount: 5,
          addMessageOk: null,
          confirmedRootIds: [1, 2, 'three'] // Wrong element type
        }
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isRootAdditionStatusResponse(invalid))
        assert.throws(() => validateRootAdditionStatusResponse(invalid))
      }
    })
  })

  describe('FindPieceResponse validation', function () {
    it('should validate response with legacy piece_cid field', function () {
      const validResponse = {
        piece_cid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid.toString(), validResponse.piece_cid)
      assert.equal(normalized.piece_cid, validResponse.piece_cid)
    })

    it('should validate response with new pieceCid field', function () {
      const validResponse = {
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid.toString(), validResponse.pieceCid)
      assert.isUndefined(normalized.piece_cid) // No legacy field in this case
    })

    it('should validate response with both fields', function () {
      const validResponse = {
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        piece_cid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid.toString(), validResponse.pieceCid)
      assert.equal(normalized.piece_cid, validResponse.piece_cid) // Legacy field preserved
    })

    it('should reject invalid responses', function () {
      const invalidResponses = [
        null,
        undefined,
        'string',
        123,
        [],
        {},
        { piece_cid: 123 }, // Wrong type
        { pieceCid: 123 }, // Wrong type
        { randomField: 'baga...' }, // Wrong field name
        { piece_cid: null }, // Null value
        { pieceCid: null }, // Null value
        { pieceCid: 'not-a-commp' }, // Invalid CommP
        { piece_cid: 'QmTest123' }, // Not a CommP (wrong codec)
        { pieceCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi' } // Not a CommP (wrong multihash)
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isFindPieceResponse(invalid))
        assert.throws(() => validateFindPieceResponse(invalid))
      }
    })

    it('should throw specific error for invalid CommP', function () {
      const invalidCommPResponse = {
        pieceCid: 'not-a-valid-commp'
      }

      assert.throws(
        () => validateFindPieceResponse(invalidCommPResponse),
        Error,
        'Invalid find piece response: pieceCid is not a valid CommP'
      )
    })

    it('should return a proper CommP CID object', function () {
      const validResponse = {
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      const normalized = validateFindPieceResponse(validResponse)

      // Verify it's a CID object with the correct properties
      assert.equal(normalized.pieceCid.code, 0xf101) // fil-commitment-unsealed
      assert.equal(normalized.pieceCid.multihash.code, 0x1012) // sha2-256-trunc254-padded
      assert.equal(normalized.pieceCid.toString(), validResponse.pieceCid)
    })
  })

  describe('ProofSetRootData validation', function () {
    it('should validate and convert a valid root data object', function () {
      const validRootData = {
        rootId: 101,
        rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        subrootOffset: 0
      }

      const converted = asProofSetRootData(validRootData)
      assert.isNotNull(converted)
      assert.equal(converted?.rootId, validRootData.rootId)
      assert.equal(converted?.rootCid.toString(), validRootData.rootCid)
      assert.equal(converted?.subrootCid.toString(), validRootData.subrootCid)
      assert.equal(converted?.subrootOffset, validRootData.subrootOffset)
    })

    it('should return null for invalid root data', function () {
      const invalidCases = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { rootId: 'not-a-number' }, // Wrong type
        {
          rootId: 101,
          rootCid: 'not-a-commp',
          subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
          subrootOffset: 0
        },
        {
          rootId: 101,
          rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
          subrootCid: 'not-a-commp',
          subrootOffset: 0
        }
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asProofSetRootData(invalid))
      }
    })
  })

  describe('ProofSetData validation', function () {
    it('should validate and convert valid proof set data', function () {
      const validProofSetData = {
        id: 123,
        roots: [
          {
            rootId: 101,
            rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootOffset: 0
          }
        ],
        nextChallengeEpoch: 456
      }

      const converted = asProofSetData(validProofSetData)
      assert.isNotNull(converted)
      assert.equal(converted?.id, validProofSetData.id)
      assert.equal(converted?.nextChallengeEpoch, validProofSetData.nextChallengeEpoch)
      assert.equal(converted?.roots.length, validProofSetData.roots.length)
      assert.equal(converted?.roots[0].rootId, validProofSetData.roots[0].rootId)
      assert.equal(converted?.roots[0].rootCid.toString(), validProofSetData.roots[0].rootCid)
      assert.equal(converted?.roots[0].subrootCid.toString(), validProofSetData.roots[0].subrootCid)
      assert.equal(converted?.roots[0].subrootOffset, validProofSetData.roots[0].subrootOffset)
    })

    it('should validate and convert proof set data with multiple roots', function () {
      const validProofSetData = {
        id: 123,
        roots: [
          {
            rootId: 101,
            rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootOffset: 0
          },
          {
            rootId: 102,
            rootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subrootOffset: 1024
          }
        ],
        nextChallengeEpoch: 456
      }

      const converted = asProofSetData(validProofSetData)
      assert.isNotNull(converted)
      assert.equal(converted?.roots.length, 2)
    })

    it('should return null for invalid proof set data', function () {
      const invalidCases = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { id: 'not-a-number' }, // Wrong type
        {
          id: 123,
          roots: 'not-an-array',
          nextChallengeEpoch: 456
        },
        {
          id: 123,
          roots: [
            {
              rootId: 101,
              rootCid: 'not-a-commp',
              subrootCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
              subrootOffset: 0
            }
          ],
          nextChallengeEpoch: 456
        }
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asProofSetData(invalid))
      }
    })

    it('should throw error when validating invalid proof set data', function () {
      const invalidProofSetData = {
        id: 'not-a-number',
        roots: [],
        nextChallengeEpoch: 456
      }

      assert.throws(
        () => {
          const converted = asProofSetData(invalidProofSetData)
          if (converted == null) throw new Error('Invalid proof set data response format')
        },
        Error,
        'Invalid proof set data response format'
      )
    })
  })
})
