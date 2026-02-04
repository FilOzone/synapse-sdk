import assert from 'assert'
import { HttpError, type request } from 'iso-web/http'
import { calibration, mainnet } from '../src/chains.ts'
import { getDataSetStats, validateStatsResponse } from '../src/filbeam/stats.ts'

type MockRequestGetJson = typeof request.json.get

function isInvalidResponseFormatError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  if (err.name !== 'GetDataSetStatsError') return false
  if (!err.message.includes('Invalid response format')) return false
  return true
}

describe('FilBeam Stats', () => {
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

  describe('getDataSetStats', () => {
    function isGetDataSetStatsError(err: unknown): boolean {
      return err instanceof Error && err.name === 'GetDataSetStatsError'
    }

    it('should fetch and return stats for mainnet', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '1000', cacheMissEgressQuota: '500' } }
      }

      const result = await getDataSetStats({
        chain: mainnet,
        dataSetId: 'test-dataset',
        requestGetJson: mockRequestGetJson as MockRequestGetJson,
      })

      assert.equal(calledUrl, 'https://stats.filbeam.com/data-set/test-dataset')
      assert.deepStrictEqual(result, { cdnEgressQuota: 1000n, cacheMissEgressQuota: 500n })
    })

    it('should fetch and return stats for calibration', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '2000', cacheMissEgressQuota: '1000' } }
      }

      const result = await getDataSetStats({
        chain: calibration,
        dataSetId: 12345n,
        requestGetJson: mockRequestGetJson as MockRequestGetJson,
      })

      assert.equal(calledUrl, 'https://calibration.stats.filbeam.com/data-set/12345')
      assert.deepStrictEqual(result, { cdnEgressQuota: 2000n, cacheMissEgressQuota: 1000n })
    })

    it('should throw error for HTTP 404', async () => {
      const mockRequestGetJson = async () => ({
        error: new HttpError({
          response: new Response('Not found', { status: 404, statusText: 'Not Found' }),
          request: new Request('https://stats.filbeam.com/data-set/non-existent'),
          options: {},
        }),
      })

      try {
        await getDataSetStats({
          chain: mainnet,
          dataSetId: 'non-existent',
          requestGetJson: mockRequestGetJson as MockRequestGetJson,
        })
        assert.fail('Expected error to be thrown')
      } catch (error) {
        assert.ok(isGetDataSetStatsError(error))
        assert.ok((error as Error).message.includes('Data set not found: non-existent'))
      }
    })

    it('should throw error for HTTP 500', async () => {
      const mockRequestGetJson = async () => ({
        error: new HttpError({
          response: new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' }),
          request: new Request('https://stats.filbeam.com/data-set/test'),
          options: {},
        }),
      })

      try {
        await getDataSetStats({
          chain: mainnet,
          dataSetId: 'test',
          requestGetJson: mockRequestGetJson as MockRequestGetJson,
        })
        assert.fail('Expected error to be thrown')
      } catch (error) {
        assert.ok(isGetDataSetStatsError(error))
        assert.ok((error as Error).message.includes('Failed to fetch data set stats'))
      }
    })

    it('should throw error for non-HTTP errors', async () => {
      const mockRequestGetJson = async () => ({
        error: new Error('Network error'),
      })

      try {
        await getDataSetStats({
          chain: mainnet,
          dataSetId: 'test',
          requestGetJson: mockRequestGetJson as unknown as MockRequestGetJson,
        })
        assert.fail('Expected error to be thrown')
      } catch (error) {
        assert.ok(isGetDataSetStatsError(error))
        assert.ok((error as Error).message.includes('Unexpected error'))
      }
    })
  })
})
