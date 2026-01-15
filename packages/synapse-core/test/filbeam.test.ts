import assert from 'assert'
import { getStatsBaseUrl, validateStatsResponse } from '../src/filbeam/stats.ts'

function isInvalidResponseFormatError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name !== 'GetDataSetStatsError') return false
  if (!err.message.includes('Invalid response format')) return false
  return true
}

describe('FilBeam Stats', () => {
  describe('getStatsBaseUrl', () => {
    it('should return mainnet URL for chainId 314', () => {
      assert.equal(getStatsBaseUrl(314), 'https://stats.filbeam.com')
    })

    it('should return calibration URL for chainId 314159', () => {
      assert.equal(getStatsBaseUrl(314159), 'https://calibration.stats.filbeam.com')
    })

    it('should return calibration URL for unknown chain IDs', () => {
      assert.equal(getStatsBaseUrl(1), 'https://calibration.stats.filbeam.com')
      assert.equal(getStatsBaseUrl(0), 'https://calibration.stats.filbeam.com')
    })
  })

  describe('validateStatsResponse', () => {
    it('should return valid DataSetStats for correct input', () => {
      const result = validateStatsResponse({
        cdnEgressQuota: '1000000',
        cacheMissEgressQuota: '500000',
      })
      assert.deepStrictEqual(result, { cdnEgressQuota: 1000000n, cacheMissEgressQuota: 500000n })
    })

    it('should handle large number strings', () => {
      const result = validateStatsResponse({
        cdnEgressQuota: '9999999999999999999999999999',
        cacheMissEgressQuota: '1234567890123456789012345678901234567890',
      })
      assert.deepStrictEqual(result, {
        cdnEgressQuota: 9999999999999999999999999999n,
        cacheMissEgressQuota: 1234567890123456789012345678901234567890n,
      })
    })

    it('should handle zero values', () => {
      const result = validateStatsResponse({
        cdnEgressQuota: '0',
        cacheMissEgressQuota: '0',
      })
      assert.deepStrictEqual(result, { cdnEgressQuota: 0n, cacheMissEgressQuota: 0n })
    })

    const invalidInputCases: Record<string, unknown> = {
      'response is null': null,
      'response is a string': 'string',
      'response is an array': [1, 2, 3],
      'response is a number': 123,
      'cdnEgressQuota is missing': { cacheMissEgressQuota: '1000' },
      'cacheMissEgressQuota is missing': { cdnEgressQuota: '1000' },
      'cdnEgressQuota is a number': { cdnEgressQuota: 1000, cacheMissEgressQuota: '500' },
      'cdnEgressQuota is an object': { cdnEgressQuota: { value: 1000 }, cacheMissEgressQuota: '500' },
      'cdnEgressQuota is a decimal': { cdnEgressQuota: '12.5', cacheMissEgressQuota: '500' },
      'cdnEgressQuota is non-numeric': { cdnEgressQuota: 'abc', cacheMissEgressQuota: '500' },
      'cacheMissEgressQuota is a number': { cdnEgressQuota: '1000', cacheMissEgressQuota: 500 },
      'cacheMissEgressQuota is scientific notation': { cdnEgressQuota: '1000', cacheMissEgressQuota: '1e10' },
      'cacheMissEgressQuota is empty string': { cdnEgressQuota: '1000', cacheMissEgressQuota: '' },
    }
    for (const [name, input] of Object.entries(invalidInputCases)) {
      it(`should throw error when ${name}`, () => {
        assert.throws(() => validateStatsResponse(input), isInvalidResponseFormatError)
      })
    }
  })
})
