import { calibration, mainnet } from '@filoz/synapse-core/chains'
import { expect } from 'chai'
import type { request } from 'iso-web/http'
import { FilBeamService } from '../filbeam/service.ts'

type MockRequestGetJson = typeof request.json.get

describe('FilBeamService', () => {
  describe('URL construction', () => {
    it('should use mainnet URL for mainnet network', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '100', cacheMissEgressQuota: '50' } }
      }
      const service = new FilBeamService(mainnet, mockRequestGetJson as MockRequestGetJson)
      await service.getDataSetStats('test')

      expect(calledUrl).to.equal('https://stats.filbeam.com/data-set/test')
    })

    it('should use calibration URL for calibration network', async () => {
      let calledUrl: string | undefined
      const mockRequestGetJson = async (url: unknown) => {
        calledUrl = String(url)
        return { result: { cdnEgressQuota: '100', cacheMissEgressQuota: '50' } }
      }
      const service = new FilBeamService(calibration, mockRequestGetJson as MockRequestGetJson)
      await service.getDataSetStats('test')

      expect(calledUrl).to.equal('https://calibration.stats.filbeam.com/data-set/test')
    })
  })

  // Detailed tests for HTTP error handling and response validation are in synapse-core.
  // These smoke tests verify that FilBeamService delegates to synapse-core correctly.
  describe('getDataSetStats', () => {
    it('should delegate to synapse-core for mainnet', async () => {
      const mockRequestGetJson = async () => ({
        result: { cdnEgressQuota: '1000', cacheMissEgressQuota: '500' },
      })

      const service = new FilBeamService(mainnet, mockRequestGetJson as MockRequestGetJson)
      const result = await service.getDataSetStats('test-dataset')

      expect(result).to.deep.equal({
        cdnEgressQuota: 1000n,
        cacheMissEgressQuota: 500n,
      })
    })

    it('should delegate to synapse-core for calibration', async () => {
      const mockRequestGetJson = async () => ({
        result: { cdnEgressQuota: '2000', cacheMissEgressQuota: '1000' },
      })

      const service = new FilBeamService(calibration, mockRequestGetJson as MockRequestGetJson)
      const result = await service.getDataSetStats(123)

      expect(result).to.deep.equal({
        cdnEgressQuota: 2000n,
        cacheMissEgressQuota: 1000n,
      })
    })
  })
})
