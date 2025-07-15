/* globals describe it */
import { assert } from 'chai'
import {
  isDataSetCreationStatusResponse,
  isPieceAdditionStatusResponse,
  isFindPieceResponse,
  validateDataSetCreationStatusResponse,
  validatePieceAdditionStatusResponse,
  validateFindPieceResponse,
  asDataSetPieceData,
  asDataSetData
} from '../pdp/validation.js'

describe('PDP Validation', function () {
  describe('DataSetCreationStatusResponse validation', function () {
    it('should validate a valid response', function () {
      const validResponse = {
        createMessageHash: '0x123abc',
        dataSetCreated: true,
        service: 'warmStorage',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123
      }

      assert.isTrue(isDataSetCreationStatusResponse(validResponse))
      assert.deepEqual(
        validateDataSetCreationStatusResponse(validResponse),
        validResponse
      )
    })

    it('should validate response with null ok field', function () {
      const validResponse = {
        createMessageHash: '0x123abc',
        dataSetCreated: false,
        service: 'warmStorage',
        txStatus: 'pending',
        ok: null
      }

      assert.isTrue(isDataSetCreationStatusResponse(validResponse))
      assert.deepEqual(
        validateDataSetCreationStatusResponse(validResponse),
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
        { createMessageHash: '0x123', dataSetCreated: 'yes' }, // Wrong type
        { createMessageHash: '0x123', datasetCreated: 'yes' }, // Wrong type (lowercase field)
        { createMessageHash: '0x123', service: 'warmStorage', txStatus: 'pending', ok: null }, // Missing both dataSetCreated and datasetCreated
        {
          createMessageHash: '0x123',
          dataSetCreated: true,
          service: 'warmStorage',
          txStatus: 'pending'
          // Missing ok field
        },
        {
          createMessageHash: '0x123',
          dataSetCreated: true,
          service: 'warmStorage',
          txStatus: 'pending',
          ok: null,
          dataSetId: 'abc' // Wrong type
        }
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isDataSetCreationStatusResponse(invalid))
        assert.throws(() => validateDataSetCreationStatusResponse(invalid))
      }
    })
  })

  describe('PieceAdditionStatusResponse validation', function () {
    it('should validate a valid response', function () {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'confirmed',
        dataSetId: 123,
        pieceCount: 5,
        addMessageOk: true,
        confirmedPieceIds: [1, 2, 3, 4, 5]
      }

      assert.isTrue(isPieceAdditionStatusResponse(validResponse))
      assert.deepEqual(
        validatePieceAdditionStatusResponse(validResponse),
        validResponse
      )
    })

    it('should validate response with null addMessageOk', function () {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'pending',
        dataSetId: 123,
        pieceCount: 5,
        addMessageOk: null
      }

      assert.isTrue(isPieceAdditionStatusResponse(validResponse))
      assert.deepEqual(
        validatePieceAdditionStatusResponse(validResponse),
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
          dataSetId: '123', // Wrong type
          pieceCount: 5,
          addMessageOk: null
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          dataSetId: 123,
          pieceCount: 5,
          addMessageOk: null,
          confirmedPieceIds: 'not-array' // Wrong type
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          dataSetId: 123,
          pieceCount: 5,
          addMessageOk: null,
          confirmedPieceIds: [1, 2, 'three'] // Wrong element type
        }
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isPieceAdditionStatusResponse(invalid))
        assert.throws(() => validatePieceAdditionStatusResponse(invalid))
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

  describe('DataSetPieceData validation', function () {
    it('should validate and convert a valid piece data object', function () {
      const validPieceData = {
        pieceId: 101,
        pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
        subPieceOffset: 0
      }

      const converted = asDataSetPieceData(validPieceData)
      assert.isNotNull(converted)
      assert.equal(converted?.pieceId, validPieceData.pieceId)
      assert.equal(converted?.pieceCid.toString(), validPieceData.pieceCid)
      assert.equal(converted?.subPieceCid.toString(), validPieceData.subPieceCid)
      assert.equal(converted?.subPieceOffset, validPieceData.subPieceOffset)
    })

    it('should return null for invalid piece data', function () {
      const invalidCases = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { pieceId: 'not-a-number' }, // Wrong type
        {
          pieceId: 101,
          pieceCid: 'not-a-commp',
          subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
          subPieceOffset: 0
        },
        {
          pieceId: 101,
          pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
          subPieceCid: 'not-a-commp',
          subPieceOffset: 0
        }
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asDataSetPieceData(invalid))
      }
    })
  })

  describe('DataSetData validation', function () {
    it('should validate and convert valid data set data', function () {
      const validDataSetData = {
        id: 123,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceOffset: 0
          }
        ],
        nextChallengeEpoch: 456
      }

      const converted = asDataSetData(validDataSetData)
      assert.isNotNull(converted)
      assert.equal(converted?.id, validDataSetData.id)
      assert.equal(converted?.nextChallengeEpoch, validDataSetData.nextChallengeEpoch)
      assert.equal(converted?.pieces.length, validDataSetData.pieces.length)
      assert.equal(converted?.pieces[0].pieceId, validDataSetData.pieces[0].pieceId)
      assert.equal(converted?.pieces[0].pieceCid.toString(), validDataSetData.pieces[0].pieceCid)
      assert.equal(converted?.pieces[0].subPieceCid.toString(), validDataSetData.pieces[0].subPieceCid)
      assert.equal(converted?.pieces[0].subPieceOffset, validDataSetData.pieces[0].subPieceOffset)
    })

    it('should validate and convert data set data with multiple pieces', function () {
      const validDataSetData = {
        id: 123,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceOffset: 0
          },
          {
            pieceId: 102,
            pieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
            subPieceOffset: 1024
          }
        ],
        nextChallengeEpoch: 456
      }

      const converted = asDataSetData(validDataSetData)
      assert.isNotNull(converted)
      assert.equal(converted?.pieces.length, 2)
    })

    it('should return null for invalid data set data', function () {
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
          pieces: 'not-an-array',
          nextChallengeEpoch: 456
        },
        {
          id: 123,
          pieces: [
            {
              pieceId: 101,
              pieceCid: 'not-a-commp',
              subPieceCid: 'baga6ea4seaqh5lmkfwaovjuigyp4hzclc6hqnhoqcm3re3ipumhp3kfka7wdvjq',
              subPieceOffset: 0
            }
          ],
          nextChallengeEpoch: 456
        }
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asDataSetData(invalid))
      }
    })

    it('should throw error when validating invalid data set data', function () {
      const invalidDataSetData = {
        id: 'not-a-number',
        pieces: [],
        nextChallengeEpoch: 456
      }

      assert.throws(
        () => {
          const converted = asDataSetData(invalidDataSetData)
          if (converted == null) throw new Error('Invalid data set data response format')
        },
        Error,
        'Invalid data set data response format'
      )
    })
  })
})
