/* globals describe it */
import { assert } from 'chai'
import {
  isProofSetCreationStatusResponse,
  isRootAdditionStatusResponse,
  isFindPieceResponse,
  validateProofSetCreationStatusResponse,
  validateRootAdditionStatusResponse,
  validateFindPieceResponse
} from '../pdp/validation.js'

describe('PDP Validation', function () {
  describe('ProofSetCreationStatusResponse validation', function () {
    it('should validate a valid response', function () {
      const validResponse = {
        createMessageHash: '0x123abc',
        proofsetCreated: true,
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
        proofsetCreated: false,
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

    it('should reject invalid responses', function () {
      const invalidResponses = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { createMessageHash: 123 }, // Wrong type
        { createMessageHash: '0x123', proofsetCreated: 'yes' }, // Wrong type
        {
          createMessageHash: '0x123',
          proofsetCreated: true,
          service: 'pandora',
          txStatus: 'pending'
          // Missing ok field
        },
        {
          createMessageHash: '0x123',
          proofsetCreated: true,
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
      assert.equal(normalized.pieceCid, validResponse.piece_cid)
      assert.equal(normalized.piece_cid, validResponse.piece_cid)
    })

    it('should validate response with new pieceCid field', function () {
      const validResponse = {
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid, validResponse.pieceCid)
    })

    it('should validate response with both fields', function () {
      const validResponse = {
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        piece_cid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq'
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid, validResponse.pieceCid)
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
        { pieceCid: null } // Null value
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isFindPieceResponse(invalid))
        assert.throws(() => validateFindPieceResponse(invalid))
      }
    })
  })
})
