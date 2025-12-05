import { expect } from 'chai'
import { FilBeamService } from '../filbeam/service.ts'
import type { FilecoinNetworkType } from '../types.ts'

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
    it('should use mainnet URL for mainnet network', () => {
      const mockFetch = async (): Promise<Response> => {
        return {} as Response
      }
      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      const baseUrl = (service as any)._getStatsBaseUrl()
      expect(baseUrl).to.equal('https://stats.filbeam.io')
    })

    it('should use calibration URL for calibration network', () => {
      const mockFetch = async (): Promise<Response> => {
        return {} as Response
      }
      const service = new FilBeamService('calibration' as FilecoinNetworkType, mockFetch)

      const baseUrl = (service as any)._getStatsBaseUrl()
      expect(baseUrl).to.equal('https://calibration.stats.filbeam.io')
    })
  })

  describe('getDataSetStats', () => {
    it('should successfully fetch and parse remaining stats for mainnet', async () => {
      const mockResponse = {
        cdnEgressQuota: '217902493044',
        cacheMissEgressQuota: '94243853808',
      }

      const mockFetch = async (input: string | URL | Request): Promise<Response> => {
        expect(input).to.equal('https://stats.filbeam.io/data-set/test-dataset-id')
        return {
          status: 200,
          statusText: 'OK',
          json: async () => mockResponse,
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)
      const result = await service.getDataSetStats('test-dataset-id')

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

      const mockFetch = async (input: string | URL | Request): Promise<Response> => {
        expect(input).to.equal('https://calibration.stats.filbeam.io/data-set/123')
        return {
          status: 200,
          statusText: 'OK',
          json: async () => mockResponse,
        } as Response
      }

      const service = new FilBeamService('calibration' as FilecoinNetworkType, mockFetch)
      const result = await service.getDataSetStats(123)

      expect(result).to.deep.equal({
        cdnEgressQuota: BigInt('100000000000'),
        cacheMissEgressQuota: BigInt('50000000000'),
      })
    })

    it('should handle 404 errors gracefully', async () => {
      const mockFetch = async (): Promise<Response> => {
        return {
          status: 404,
          statusText: 'Not Found',
          text: async () => 'Data set not found',
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      try {
        await service.getDataSetStats('non-existent')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Data set not found: non-existent')
      }
    })

    it('should handle other HTTP errors', async () => {
      const mockFetch = async (): Promise<Response> => {
        return {
          status: 500,
          statusText: 'Internal Server Error',
          text: async () => 'Server error occurred',
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('HTTP 500 Internal Server Error')
      }
    })

    it('should validate response is an object', async () => {
      const mockFetch = async (): Promise<Response> => {
        return {
          status: 200,
          statusText: 'OK',
          json: async () => null,
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Response is not an object')
      }
    })

    it('should validate cdnEgressQuota is present', async () => {
      const mockFetch = async (): Promise<Response> => {
        return {
          status: 200,
          statusText: 'OK',
          json: async () => ({
            cacheMissEgressQuota: '12345',
          }),
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cdnEgressQuota must be a string')
      }
    })

    it('should validate cacheMissEgressQuota is present', async () => {
      const mockFetch = async (): Promise<Response> => {
        return {
          status: 200,
          statusText: 'OK',
          json: async () => ({
            cdnEgressQuota: '12345',
          }),
        } as Response
      }

      const service = new FilBeamService('mainnet' as FilecoinNetworkType, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cacheMissEgressQuota must be a string')
      }
    })
  })
})
