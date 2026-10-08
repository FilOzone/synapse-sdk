import { calibration, mainnet } from '@filoz/synapse-core/chains'
import { expect } from 'chai'
import { AbortError, TimeoutError } from 'iso-web/http'
import { FilBeamService } from '../filbeam/service.ts'

describe('FilBeamService', () => {
  describe('URL construction', () => {
    it('should use mainnet URL for mainnet network', () => {
      const mockFetch = async (): Promise<Response> => {
        return {} as Response
      }
      const service = new FilBeamService(mainnet, mockFetch)

      const baseUrl = (service as any)._getStatsBaseUrl()
      expect(baseUrl).to.equal('https://stats.filbeam.com')
    })

    it('should use calibration URL for calibration network', () => {
      const mockFetch = async (): Promise<Response> => {
        return {} as Response
      }
      const service = new FilBeamService(calibration, mockFetch)

      const baseUrl = (service as any)._getStatsBaseUrl()
      expect(baseUrl).to.equal('https://calibration.stats.filbeam.com')
    })
  })

  describe('getDataSetStats', () => {
    it('should successfully fetch and parse remaining stats for mainnet', async () => {
      const mockResponse = {
        cdnEgressQuota: '217902493044',
        cacheMissEgressQuota: '94243853808',
      }

      const mockFetch = async (input: string | URL | Request): Promise<Response> => {
        expect(input instanceof Request ? input.url : String(input)).to.equal(
          'https://stats.filbeam.com/data-set/test-dataset-id'
        )
        return Response.json(mockResponse)
      }

      const service = new FilBeamService(mainnet, mockFetch)
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
        expect(input instanceof Request ? input.url : String(input)).to.equal(
          'https://calibration.stats.filbeam.com/data-set/123'
        )
        return Response.json(mockResponse)
      }

      const service = new FilBeamService(calibration, mockFetch)
      const result = await service.getDataSetStats(123)

      expect(result).to.deep.equal({
        cdnEgressQuota: BigInt('100000000000'),
        cacheMissEgressQuota: BigInt('50000000000'),
      })
    })

    it('should handle 404 errors gracefully', async () => {
      const mockFetch = async (): Promise<Response> => {
        return new Response('Data set not found', { status: 404, statusText: 'Not Found' })
      }

      const service = new FilBeamService(mainnet, mockFetch)

      try {
        await service.getDataSetStats('non-existent')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Data set not found: non-existent')
      }
    })

    it('should handle other HTTP errors', async () => {
      const mockFetch = async (): Promise<Response> => {
        return new Response('Server error occurred', { status: 500, statusText: 'Internal Server Error' })
      }

      const service = new FilBeamService(mainnet, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('HTTP 500 Internal Server Error')
      }
    })

    it('should validate response is an object', async () => {
      const mockFetch = async (): Promise<Response> => {
        return Response.json(null)
      }

      const service = new FilBeamService(mainnet, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('Response is not an object')
      }
    })

    it('should validate cdnEgressQuota is present', async () => {
      const mockFetch = async (): Promise<Response> => {
        return Response.json({ cacheMissEgressQuota: '12345' })
      }

      const service = new FilBeamService(mainnet, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cdnEgressQuota must be a string')
      }
    })

    it('should validate cacheMissEgressQuota is present', async () => {
      const mockFetch = async (): Promise<Response> => {
        return Response.json({ cdnEgressQuota: '12345' })
      }

      const service = new FilBeamService(mainnet, mockFetch)

      try {
        await service.getDataSetStats('test-dataset')
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(error.message).to.include('cacheMissEgressQuota must be a string')
      }
    })
    it('should time out when the endpoint hangs', async () => {
      const hangingFetch = (input: string | URL | Request): Promise<Response> => {
        const signal = input instanceof Request ? input.signal : undefined
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason))
        })
      }

      const service = new FilBeamService(mainnet, hangingFetch)

      try {
        await service.getDataSetStats('test-dataset', { timeout: 10 })
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(TimeoutError.is(error)).to.equal(true)
      }
    })

    it('should abort when the signal is aborted', async () => {
      const hangingFetch = (input: string | URL | Request): Promise<Response> => {
        const signal = input instanceof Request ? input.signal : undefined
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason))
        })
      }

      const service = new FilBeamService(mainnet, hangingFetch)
      const controller = new AbortController()
      const promise = service.getDataSetStats('test-dataset', { signal: controller.signal })
      controller.abort()

      try {
        await promise
        expect.fail('Should have thrown an error')
      } catch (error: any) {
        expect(AbortError.is(error)).to.equal(true)
      }
    })
  })
})
