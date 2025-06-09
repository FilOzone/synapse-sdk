/* globals describe it */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { StorageService } from '../storage/storage-service.js'
import type { Synapse, ApprovedProviderInfo } from '../types.js'

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => new ethers.JsonRpcProvider(),
  getPandoraAddress: () => '0x1234567890123456789012345678901234567890',
  getChainId: () => BigInt(314159),
  payments: {
    serviceApproval: async () => ({
      service: '0x1234567890123456789012345678901234567890',
      rateAllowance: BigInt(1000000),
      lockupAllowance: BigInt(10000000),
      rateUsed: BigInt(0),
      lockupUsed: BigInt(0)
    })
  }
} as unknown as Synapse

// Mock provider info
const mockProvider: ApprovedProviderInfo = {
  owner: '0xabcdef1234567890123456789012345678901234',
  pdpUrl: 'https://pdp.example.com',
  pieceRetrievalUrl: 'https://retrieve.example.com',
  registeredAt: 1234567890,
  approvedAt: 1234567891
}

describe('StorageService', () => {
  describe('preflightUpload', () => {
    it('should calculate costs without CDN', async () => {
      const service = new StorageService(mockSynapse, mockProvider, 123, { withCDN: false })

      // Mock the PandoraService method - now returns costs too
      const mockCheckAllowance = async () => ({
        rateAllowanceNeeded: BigInt(100),
        lockupAllowanceNeeded: BigInt(2880000),
        currentRateAllowance: BigInt(1000000),
        currentLockupAllowance: BigInt(10000000),
        currentRateUsed: BigInt(0),
        currentLockupUsed: BigInt(0),
        sufficient: true,
        message: undefined,
        costs: {
          perEpoch: BigInt(100),
          perDay: BigInt(28800),
          perMonth: BigInt(864000)
        }
      })

      // Replace method temporarily
      const originalCheck = service._pandoraService.checkAllowanceForStorage
      service._pandoraService.checkAllowanceForStorage = mockCheckAllowance

      try {
        const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

        assert.equal(preflight.estimatedCost.perEpoch, BigInt(100))
        assert.equal(preflight.estimatedCost.perDay, BigInt(28800))
        assert.equal(preflight.estimatedCost.perMonth, BigInt(864000))
        assert.isTrue(preflight.allowanceCheck.sufficient)
        assert.isUndefined(preflight.allowanceCheck.message)
        assert.equal(preflight.selectedProvider.owner, mockProvider.owner)
        assert.equal(preflight.selectedProofSetId, 123)
      } finally {
        // Restore original method
        service._pandoraService.checkAllowanceForStorage = originalCheck
      }
    })

    it('should calculate costs with CDN', async () => {
      const service = new StorageService(mockSynapse, mockProvider, 123, { withCDN: true })

      // Mock the PandoraService method - returns CDN costs
      const mockCheckAllowance = async () => ({
        rateAllowanceNeeded: BigInt(200),
        lockupAllowanceNeeded: BigInt(5760000),
        currentRateAllowance: BigInt(1000000),
        currentLockupAllowance: BigInt(10000000),
        currentRateUsed: BigInt(0),
        currentLockupUsed: BigInt(0),
        sufficient: true,
        message: undefined,
        costs: {
          perEpoch: BigInt(200),
          perDay: BigInt(57600),
          perMonth: BigInt(1728000)
        }
      })

      // Replace method temporarily
      const originalCheck = service._pandoraService.checkAllowanceForStorage
      service._pandoraService.checkAllowanceForStorage = mockCheckAllowance

      try {
        const preflight = await service.preflightUpload(1024 * 1024) // 1 MiB

        // Should use CDN costs
        assert.equal(preflight.estimatedCost.perEpoch, BigInt(200))
        assert.equal(preflight.estimatedCost.perDay, BigInt(57600))
        assert.equal(preflight.estimatedCost.perMonth, BigInt(1728000))
        assert.isTrue(preflight.allowanceCheck.sufficient)
      } finally {
        // Restore original method
        service._pandoraService.checkAllowanceForStorage = originalCheck
      }
    })

    it('should handle insufficient allowances', async () => {
      const service = new StorageService(mockSynapse, mockProvider, 123, { withCDN: false })

      // Mock the PandoraService method - returns insufficient allowances
      const mockCheckAllowance = async () => ({
        rateAllowanceNeeded: BigInt(2000000),
        lockupAllowanceNeeded: BigInt(20000000),
        currentRateAllowance: BigInt(1000000),
        currentLockupAllowance: BigInt(10000000),
        currentRateUsed: BigInt(0),
        currentLockupUsed: BigInt(0),
        sufficient: false,
        message: 'Rate allowance insufficient: current 1000000, need 2000000. Lockup allowance insufficient: current 10000000, need 20000000',
        costs: {
          perEpoch: BigInt(100),
          perDay: BigInt(28800),
          perMonth: BigInt(864000)
        }
      })

      // Replace method temporarily
      const originalCheck = service._pandoraService.checkAllowanceForStorage
      service._pandoraService.checkAllowanceForStorage = mockCheckAllowance

      try {
        const preflight = await service.preflightUpload(100 * 1024 * 1024) // 100 MiB

        assert.isFalse(preflight.allowanceCheck.sufficient)
        assert.include(preflight.allowanceCheck.message, 'Rate allowance insufficient')
        assert.include(preflight.allowanceCheck.message, 'Lockup allowance insufficient')
      } finally {
        // Restore original method
        service._pandoraService.checkAllowanceForStorage = originalCheck
      }
    })
  })
})
