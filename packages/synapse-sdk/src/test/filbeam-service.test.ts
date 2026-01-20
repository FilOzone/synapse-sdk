import { expect } from 'chai'
import { HttpError, type request } from 'iso-web/http'
import { FilBeamService } from '../filbeam/service.ts'
import type { FilecoinNetworkType } from '../types.ts'

type MockRequestGetJson = typeof request.json.get

describe('FilBeamService', () => {
  describe('network type validation', () => {
    it('should throw error if network type not mainnet or calibration', () => {
      try {
        // @ts-expect-error
        new FilBeamService('base-sepolia')
      } catch (error: any) {
        expect(error.message).to.include('Unsupported network type')
      }
    })
  })

  describe('URL construction', () => {
    it('should use mainnet URL for mainnet network', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '100', cacheMissEgressQuota: '50' } }
      }
      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)
      await service.getDataSetStats('test')

      expect(calledUrl).to.equal('https://stats.filbeam.com/data-set/test')
    })

    it('should use calibration URL for calibration network', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '100', cacheMissEgressQuota: '50' } }
      }
      const service = new FilBeamService('calibration' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)
      await service.getDataSetStats('test')

      expect(calledUrl).to.equal('https://calibration.stats.filbeam.com/data-set/test')
    })
  })

  describe('getDataSetStats', () => {
    it('should successfully fetch and parse remaining stats for mainnet', async () => {
      const mockResponse = {
        cdnEgressQuota: '217902493044',
        cacheMissEgressQuota: '94243853808',
      }

      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: mockResponse }
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)
      const result = await service.getDataSetStats('test-dataset-id')

      expect(calledUrl).to.equal('https://stats.filbeam.com/data-set/test-dataset-id')
      expect(result).to.deep.equal({
        cdnEgressQuota: BigInt('217902493044'),
        cacheMissEgressQuota: BigInt('94243853808'),
      })
    })

    it('should successfully fetch and parse remaining stats for calibration', async () => {
      const mockResponse = {
        cdnEgressQuota: '100000000000',
        cacheMissEgressQuota: '50000000000',
      }

      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: mockResponse }
      }

      const service = new FilBeamService('calibration' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)
      const result = await service.getDataSetStats(123)

      expect(calledUrl).to.equal('https://calibration.stats.filbeam.com/data-set/123')
      expect(result).to.deep.equal({
        cdnEgressQuota: BigInt('100000000000'),
        cacheMissEgressQuota: BigInt('50000000000'),
      })
    })

    it('should handle 404 errors gracefully', async () => {
      const mockRequestGetJson = async () => ({
        error: new HttpError({
          response: new Response('Not found', { status: 404, statusText: 'Not Found' }),
          request: new Request('https://stats.filbeam.com/data-set/non-existent'),
          options: {},
        }),
      })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('non-existent')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Data set not found: non-existent')
      }
    })

    it('should handle other HTTP errors', async () => {
      const mockRequestGetJson = async () => ({
        error: new HttpError({
          response: new Response('Server error occurred', { status: 500, statusText: 'Internal Server Error' }),
          request: new Request('https://stats.filbeam.com/data-set/test-dataset'),
          options: {},
        }),
      })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Failed to fetch data set stats')
        expect(error.message).to.include('HTTP 500')
      }
    })

    it('should validate response is an object', async () => {
      const mockRequestGetJson = async () => ({ result: null })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Response is not an object')
      }
    })

    it('should validate cdnEgressQuota is present', async () => {
      const mockRequestGetJson = async () => ({
        result: { cacheMissEgressQuota: '12345' },
      })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cdnEgressQuota must be a string')
      }
    })

    it('should validate cacheMissEgressQuota is present', async () => {
      const mockRequestGetJson = async () => ({
        result: { cdnEgressQuota: '12345' },
      })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cacheMissEgressQuota must be a string')
      }
    })

    it('should reject non-integer quota values', async () => {
      const mockRequestGetJson = async () => ({
        result: {
          cdnEgressQuota: '12.5',
          cacheMissEgressQuota: '100',
        },
      })

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockRequestGetJson as MockRequestGetJson)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('not a valid integer')
      }
    })
  })
})
