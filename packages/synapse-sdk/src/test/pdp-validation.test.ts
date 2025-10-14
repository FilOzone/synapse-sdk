/* globals describe it */
import { assert } from 'chai'
import {
  asDataSetData,
  asDataSetPieceData,
  isDataSetCreationStatusResponse,
  isFindPieceResponse,
  isPieceAdditionStatusResponse,
  isPieceStatusResponse,
  validateDataSetCreationStatusResponse,
  validateFindPieceResponse,
  validatePieceAdditionStatusResponse,
  validatePieceStatusResponse,
} from '../pdp/validation.ts'

describe('PDP Validation', () => {
  describe('DataSetCreationStatusResponse validation', () => {
    it('should validate a valid response', () => {
      const validResponse = {
        createMessageHash: '0x123abc',
        dataSetCreated: true,
        service: 'warmStorage',
        txStatus: 'confirmed',
        ok: true,
        dataSetId: 123,
      }

      assert.isTrue(isDataSetCreationStatusResponse(validResponse))
      assert.deepEqual(validateDataSetCreationStatusResponse(validResponse), validResponse)
    })

    it('should validate response with null ok field', () => {
      const validResponse = {
        createMessageHash: '0x123abc',
        dataSetCreated: false,
        service: 'warmStorage',
        txStatus: 'pending',
        ok: null,
      }

      assert.isTrue(isDataSetCreationStatusResponse(validResponse))
      assert.deepEqual(validateDataSetCreationStatusResponse(validResponse), validResponse)
    })

    it('should reject invalid responses', () => {
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
        {
          createMessageHash: '0x123',
          service: 'warmStorage',
          txStatus: 'pending',
          ok: null,
        }, // Missing both dataSetCreated and datasetCreated
        {
          createMessageHash: '0x123',
          dataSetCreated: true,
          service: 'warmStorage',
          txStatus: 'pending',
          // Missing ok field
        },
        {
          createMessageHash: '0x123',
          dataSetCreated: true,
          service: 'warmStorage',
          txStatus: 'pending',
          ok: null,
          dataSetId: 'abc', // Wrong type
        },
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isDataSetCreationStatusResponse(invalid))
        assert.throws(() => validateDataSetCreationStatusResponse(invalid))
      }
    })
  })

  describe('PieceAdditionStatusResponse validation', () => {
    it('should validate a valid response', () => {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'confirmed',
        dataSetId: 123,
        pieceCount: 5,
        addMessageOk: true,
        confirmedPieceIds: [1, 2, 3, 4, 5],
      }

      assert.isTrue(isPieceAdditionStatusResponse(validResponse))
      assert.deepEqual(validatePieceAdditionStatusResponse(validResponse), validResponse)
    })

    it('should validate response with null addMessageOk', () => {
      const validResponse = {
        txHash: '0x456def',
        txStatus: 'pending',
        dataSetId: 123,
        pieceCount: 5,
        addMessageOk: null,
      }

      assert.isTrue(isPieceAdditionStatusResponse(validResponse))
      assert.deepEqual(validatePieceAdditionStatusResponse(validResponse), validResponse)
    })

    it('should reject invalid responses', () => {
      const invalidResponses = [
        null,
        undefined,
        {
          txHash: '0x456def',
          txStatus: 'pending',
          dataSetId: '123', // Wrong type
          pieceCount: 5,
          addMessageOk: null,
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          dataSetId: 123,
          pieceCount: 5,
          addMessageOk: null,
          confirmedPieceIds: 'not-array', // Wrong type
        },
        {
          txHash: '0x456def',
          txStatus: 'pending',
          dataSetId: 123,
          pieceCount: 5,
          addMessageOk: null,
          confirmedPieceIds: [1, 2, 'three'], // Wrong element type
        },
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isPieceAdditionStatusResponse(invalid))
        assert.throws(() => validatePieceAdditionStatusResponse(invalid))
      }
    })
  })

  describe('PieceStatusResponse validation', () => {
    it('should validate a valid response with all fields', () => {
      const validResponse = {
        pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
        status: 'retrieved',
        indexed: true,
        advertised: true,
        retrieved: true,
        retrievedAt: '2025-10-11T13:35:26.541494+02:00',
      }

      assert.isTrue(isPieceStatusResponse(validResponse))
      assert.deepEqual(validatePieceStatusResponse(validResponse), validResponse)
    })

    it('should validate response without optional retrievedAt field', () => {
      const validResponse = {
        pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
        status: 'pending',
        indexed: false,
        advertised: false,
        retrieved: false,
      }

      assert.isTrue(isPieceStatusResponse(validResponse))
      assert.deepEqual(validatePieceStatusResponse(validResponse), validResponse)
    })

    it('should reject invalid responses', () => {
      const invalidResponses = [
        null,
        undefined,
        'string',
        123,
        [],
        {}, // Empty object
        { pieceCid: 123 }, // Wrong type
        {
          pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
          status: 123, // Wrong type
          indexed: true,
          advertised: true,
          retrieved: true,
        },
        {
          pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
          status: 'pending',
          indexed: 'yes', // Wrong type
          advertised: false,
          retrieved: false,
        },
        {
          pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
          status: 'pending',
          indexed: false,
          // Missing advertised field
          retrieved: false,
        },
        {
          pieceCid: 'bafkzcibdy4hapci46px57mg3znrwydsv7x7rxisg7l7ti245wxwwfmiftgmdmbqk',
          status: 'retrieved',
          indexed: true,
          advertised: true,
          retrieved: true,
          retrievedAt: 123, // Wrong type
        },
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isPieceStatusResponse(invalid))
        assert.throws(() => validatePieceStatusResponse(invalid), Error, 'Invalid piece status response format')
      }
    })
  })

  describe('FindPieceResponse validation', () => {
    it('should validate response with pieceCid field', () => {
      const validResponse = {
        pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
      }

      assert.isTrue(isFindPieceResponse(validResponse))
      const normalized = validateFindPieceResponse(validResponse)
      assert.equal(normalized.pieceCid.toString(), validResponse.pieceCid)
    })

    it('should reject invalid responses', () => {
      const invalidResponses = [
        null,
        undefined,
        'string',
        123,
        [],
        {},
        { pieceCid: 123 }, // Wrong type
        { randomField: 'bafk...' }, // Wrong field name
        { pieceCid: null }, // Null value
        { pieceCid: 'not-a-piece-link' }, // Invalid PieceCID
        {
          pieceCid: 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi',
        }, // Not a PieceCID (wrong multihash)
      ]

      for (const invalid of invalidResponses) {
        assert.isFalse(isFindPieceResponse(invalid))
        assert.throws(() => validateFindPieceResponse(invalid))
      }
    })

    it('should throw specific error for invalid PieceCID', () => {
      const invalidPieceCidResponse = {
        pieceCid: 'not-a-valid-piece-link',
      }

      assert.throws(
        () => validateFindPieceResponse(invalidPieceCidResponse),
        Error,
        'Invalid find piece response: pieceCid is not a valid PieceCID'
      )
    })

    it('should return a proper PieceCID CID object', () => {
      const validResponse = {
        pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
      }

      const normalized = validateFindPieceResponse(validResponse)

      // Verify it's a CID object with the correct properties
      assert.equal(normalized.pieceCid.code, 0x55) // raw
      assert.equal(normalized.pieceCid.multihash.code, 0x1011) // fr32-sha256-trunc254-padbintree
      assert.equal(normalized.pieceCid.toString(), validResponse.pieceCid)
    })
  })

  describe('DataSetPieceData validation', () => {
    it('should validate and convert a valid piece data object', () => {
      const validPieceData = {
        pieceId: 101,
        pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
        subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
        subPieceOffset: 0,
      }

      const converted = asDataSetPieceData(validPieceData)
      assert.isNotNull(converted)
      assert.equal(converted?.pieceId, validPieceData.pieceId)
      assert.equal(converted?.pieceCid.toString(), validPieceData.pieceCid)
      assert.equal(converted?.subPieceCid.toString(), validPieceData.subPieceCid)
      assert.equal(converted?.subPieceOffset, validPieceData.subPieceOffset)
    })

    it('should return null for invalid piece data', () => {
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
          pieceCid: 'not-a-piece-link',
          subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
          subPieceOffset: 0,
        },
        {
          pieceId: 101,
          pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
          subPieceCid: 'not-a-piece-link',
          subPieceOffset: 0,
        },
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asDataSetPieceData(invalid))
      }
    })
  })

  describe('DataSetData validation', () => {
    it('should validate and convert valid data set data', () => {
      const validDataSetData = {
        id: 123,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 456,
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

    it('should validate and convert data set data with multiple pieces', () => {
      const validDataSetData = {
        id: 123,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 1024,
          },
        ],
        nextChallengeEpoch: 456,
      }

      const converted = asDataSetData(validDataSetData)
      assert.isNotNull(converted)
      assert.equal(converted?.pieces.length, 2)
    })

    it('should return null for invalid data set data', () => {
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
          nextChallengeEpoch: 456,
        },
        {
          id: 123,
          pieces: [
            {
              pieceId: 101,
              pieceCid: 'not-a-piece-link',
              subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
              subPieceOffset: 0,
            },
          ],
          nextChallengeEpoch: 456,
        },
      ]

      for (const invalid of invalidCases) {
        assert.isNull(asDataSetData(invalid))
      }
    })

    it('should throw error when validating invalid data set data', () => {
      const invalidDataSetData = {
        id: 'not-a-number',
        pieces: [],
        nextChallengeEpoch: 456,
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
