/* globals describe it beforeEach */

/**
 * Tests for enhanced SynapsePayments functionality
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { SynapsePayments } from '../payments/index.js'
import { createMockProvider, createMockSigner } from './test-utils.js'

describe('SynapsePayments Enhanced Features', () => {
  let mockProvider: ethers.Provider
  let mockSigner: ethers.Signer
  let payments: SynapsePayments

  beforeEach(() => {
    mockProvider = createMockProvider()
    mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', mockProvider)
    // Use a mock Pandora address for testing
    const mockPandoraAddress = '0xEB022abbaa66D9F459F3EC2FeCF81a6D03c2Cb6F'
    payments = new SynapsePayments(mockProvider, mockSigner, 'calibration', false, mockPandoraAddress)
  })

  describe('accountInfo', () => {
    it('should return detailed account information with correct fields', async () => {
      const info = await payments.accountInfo()

      assert.exists(info.funds)
      assert.exists(info.lockupCurrent)
      assert.exists(info.lockupRate)
      assert.exists(info.lockupLastSettledAt)
      assert.exists(info.availableFunds)

      // Check that funds is correct (500 USDFC)
      assert.equal(info.funds.toString(), ethers.parseUnits('500', 18).toString())
      // With no lockup, available funds should equal total funds
      assert.equal(info.availableFunds.toString(), info.funds.toString())
    })

    it('should calculate available funds correctly with time-based lockup', async () => {
      // Override the mock to simulate lockup
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data != null && data.includes('ad74b775') === true) {
          const funds = ethers.parseUnits('500', 18)
          const lockupCurrent = ethers.parseUnits('50', 18)
          const lockupRate = ethers.parseUnits('0.1', 18) // 0.1 USDFC per epoch
          const lockupLastSettledAt = 1000000 - 100 // 100 epochs ago
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            [funds, lockupCurrent, lockupRate, lockupLastSettledAt]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const info = await payments.accountInfo()

      // lockupCurrent (50) + lockupRate (0.1) * epochs (100) = 50 + 10 = 60
      // availableFunds = 500 - 60 = 440
      const expectedAvailable = ethers.parseUnits('440', 18)

      assert.equal(info.availableFunds.toString(), expectedAvailable.toString())
    })

    it('should use accountInfo in balance() method', async () => {
      const balance = await payments.balance()
      const info = await payments.accountInfo()

      assert.equal(balance.toString(), info.availableFunds.toString())
    })
  })

  describe('getCurrentEpoch', () => {
    it('should return block number as epoch', async () => {
      const epoch = await payments.getCurrentEpoch()

      // In Filecoin, block number is the epoch
      // Mock provider returns block number 1000000
      assert.equal(epoch.toString(), '1000000')
    })
  })

  describe('calculateStorageCost', () => {
    it('should calculate storage costs correctly for 1 GiB', async () => {
      const sizeInBytes = 1024 * 1024 * 1024 // 1 GiB
      const costs = await payments.calculateStorageCost(sizeInBytes)

      assert.exists(costs.perEpoch)
      assert.exists(costs.perDay)
      assert.exists(costs.perMonth)
      assert.exists(costs.withCDN)

      // Verify costs are reasonable
      assert.isTrue(costs.perEpoch > 0n)
      assert.isTrue(costs.perDay > costs.perEpoch)
      assert.isTrue(costs.perMonth > costs.perDay)

      // CDN costs should be higher
      assert.isTrue(costs.withCDN.perEpoch > costs.perEpoch)
      assert.isTrue(costs.withCDN.perDay > costs.perDay)
      assert.isTrue(costs.withCDN.perMonth > costs.perMonth)

      // Verify CDN is 1.5x base rate (3 USDFC vs 2 USDFC per TiB/month)
      assert.equal((costs.withCDN.perEpoch * 2n) / costs.perEpoch, 3n)
    })

    it('should scale costs linearly with size', async () => {
      const costs1GiB = await payments.calculateStorageCost(1024 * 1024 * 1024)
      const costs10GiB = await payments.calculateStorageCost(10 * 1024 * 1024 * 1024)

      // 10 GiB should cost approximately 10x more than 1 GiB
      // Allow for small rounding differences in bigint division
      const ratio = Number(costs10GiB.perEpoch) / Number(costs1GiB.perEpoch)
      assert.closeTo(ratio, 10, 0.01)

      // Verify the relationship holds for day and month calculations
      assert.equal(costs10GiB.perDay.toString(), (costs10GiB.perEpoch * 2880n).toString())
      assert.equal(costs10GiB.perMonth.toString(), (costs10GiB.perEpoch * 86400n).toString())
    })

    it('should fetch pricing from Pandora contract', async () => {
      // This test verifies that the getServicePrice function is called
      let getServicePriceCalled = false
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data?.startsWith('0x5482bdf9') === true) {
          getServicePriceCalled = true
          const pricePerTiBPerMonthNoCDN = ethers.parseUnits('2', 18)
          const pricePerTiBPerMonthWithCDN = ethers.parseUnits('3', 18)
          const tokenAddress = '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
          const epochsPerMonth = 86400n
          // Encode as a tuple (struct)
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [[pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, tokenAddress, epochsPerMonth]]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      await payments.calculateStorageCost(1024 * 1024 * 1024)
      assert.isTrue(getServicePriceCalled, 'Should have called getServicePrice on Pandora contract')
    })
  })

  describe('checkAllowanceForStorage', () => {
    it('should check allowances for storage operations', async () => {
      const check = await payments.checkAllowanceForStorage(
        10 * 1024 * 1024 * 1024, // 10 GiB
        false
      )

      assert.exists(check.rateAllowanceNeeded)
      assert.exists(check.lockupAllowanceNeeded)
      assert.exists(check.currentRateAllowance)
      assert.exists(check.currentLockupAllowance)
      assert.exists(check.sufficient)

      // With no current allowances, should not be sufficient
      assert.isFalse(check.sufficient)
      assert.exists(check.message)
      assert.include(check.message, 'insufficient')
    })

    it('should return sufficient when allowances are adequate', async () => {
      // Override mock to return approved service
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data != null && data.includes('e3d4c69e') === true) {
          const isApproved = true
          const rateAllowance = ethers.parseUnits('100', 18)
          const lockupAllowance = ethers.parseUnits('10000', 18)
          const rateUsed = 0n
          const lockupUsed = 0n
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
            [isApproved, rateAllowance, lockupAllowance, rateUsed, lockupUsed]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const check = await payments.checkAllowanceForStorage(
        1024 * 1024, // 1 MiB - small amount
        false
      )

      assert.isTrue(check.sufficient)
      assert.isUndefined(check.message)
    })
  })

  describe('prepareStorageUpload', () => {
    it('should prepare storage upload with required actions', async () => {
      const prep = await payments.prepareStorageUpload({
        dataSize: 10 * 1024 * 1024 * 1024, // 10 GiB
        withCDN: false
      })

      assert.exists(prep.estimatedCost)
      assert.exists(prep.allowanceCheck)
      assert.isArray(prep.actions)

      // Should have at least approval action (since mock has no allowances)
      assert.isAtLeast(prep.actions.length, 1)

      const approvalAction = prep.actions.find(a => a.type === 'approveService')
      assert.exists(approvalAction)
      assert.include(approvalAction.description, 'Approve service')
      assert.isFunction(approvalAction.execute)
    })

    it('should include deposit action when balance insufficient', async () => {
      // Override mock to return low account balance
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        if (data != null && data.includes('ad74b775') === true) {
          const funds = ethers.parseUnits('0.001', 18) // Very low balance (0.001 USDFC)
          const lockupCurrent = 0n
          const lockupRate = 0n
          const lockupLastSettledAt = 1000000 // Current epoch
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            [funds, lockupCurrent, lockupRate, lockupLastSettledAt]
          )
        }
        // Also need to mock the operator approval check
        if (data != null && data.includes('e3d4c69e') === true) {
          const isApproved = false
          const rateAllowance = 0n
          const lockupAllowance = 0n
          const rateUsed = 0n
          const lockupUsed = 0n
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
            [isApproved, rateAllowance, lockupAllowance, rateUsed, lockupUsed]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const prep = await payments.prepareStorageUpload({
        dataSize: 10 * 1024 * 1024 * 1024, // 10 GiB
        withCDN: false
      })

      // Should have both deposit and approval actions
      assert.isAtLeast(prep.actions.length, 2)

      const depositAction = prep.actions.find(a => a.type === 'deposit')
      assert.exists(depositAction)
      assert.include(depositAction.description, 'Deposit')
      assert.include(depositAction.description, 'USDFC')

      const approvalAction = prep.actions.find(a => a.type === 'approveService')
      assert.exists(approvalAction)
    })

    it('should return no actions when everything is ready', async () => {
      // Override mock to return sufficient balance and allowances
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data
        // Mock sufficient account balance
        if (data != null && data.includes('ad74b775') === true) {
          const funds = ethers.parseUnits('10000', 18)
          const lockupCurrent = 0n
          const lockupRate = 0n
          const lockupLastSettledAt = 1000000 // Current epoch
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['uint256', 'uint256', 'uint256', 'uint256'],
            [funds, lockupCurrent, lockupRate, lockupLastSettledAt]
          )
        }
        // Mock sufficient operator approvals
        if (data != null && data.includes('e3d4c69e') === true) {
          const isApproved = true
          const rateAllowance = ethers.parseUnits('1000', 18)
          const lockupAllowance = ethers.parseUnits('100000', 18)
          const rateUsed = 0n
          const lockupUsed = 0n
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool', 'uint256', 'uint256', 'uint256', 'uint256'],
            [isApproved, rateAllowance, lockupAllowance, rateUsed, lockupUsed]
          )
        }
        return await originalCall.call(mockProvider, transaction)
      }

      const prep = await payments.prepareStorageUpload({
        dataSize: 1024 * 1024, // 1 MiB - small amount
        withCDN: false
      })

      assert.lengthOf(prep.actions, 0)
      assert.isTrue(prep.allowanceCheck.sufficient)
    })
  })
})
