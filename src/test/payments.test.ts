/* globals describe it beforeEach */

/**
 * Tests for SynapsePayments class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { SynapsePayments } from '../payments/index.js'
import { TOKENS } from '../utils/index.js'
import { createMockProvider, createMockSigner } from './test-utils.js'

describe('SynapsePayments', () => {
  let mockProvider: ethers.Provider
  let mockSigner: ethers.Signer
  let payments: SynapsePayments

  beforeEach(() => {
    mockProvider = createMockProvider()
    mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', mockProvider)
    payments = new SynapsePayments(mockProvider, mockSigner, 'calibration', false)
  })

  describe('Instantiation', () => {
    it('should create instance with required parameters', () => {
      assert.exists(payments)
      assert.isFunction(payments.walletBalance)
      assert.isFunction(payments.balance)
      assert.isFunction(payments.deposit)
      assert.isFunction(payments.withdraw)
      assert.isFunction(payments.decimals)
    })

    it('should have static USDFC property', () => {
      assert.equal(SynapsePayments.USDFC, 'USDFC')
    })
  })

  describe('walletBalance', () => {
    it('should return FIL balance when no token specified', async () => {
      const balance = await payments.walletBalance()
      assert.equal(balance.toString(), ethers.parseEther('100').toString())
    })

    it('should return FIL balance when FIL token specified', async () => {
      const balance = await payments.walletBalance(TOKENS.FIL)
      assert.equal(balance.toString(), ethers.parseEther('100').toString())
    })

    it('should return USDFC balance when USDFC specified', async () => {
      const balance = await payments.walletBalance(SynapsePayments.USDFC)
      assert.equal(balance.toString(), ethers.parseUnits('1000', 18).toString())
    })

    it('should throw for unsupported token', async () => {
      try {
        await payments.walletBalance('UNKNOWN' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('balance', () => {
    it('should return USDFC balance from payments contract', async () => {
      const balance = await payments.balance()
      // Should return available funds (500 USDFC - 0 locked = 500)
      assert.equal(balance.toString(), ethers.parseUnits('500', 18).toString())
    })

    it('should throw for non-USDFC token', async () => {
      try {
        await payments.balance('FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
        assert.include(error.message, 'USDFC')
      }
    })
  })

  describe('decimals', () => {
    it('should return 18 for USDFC', () => {
      assert.equal(payments.decimals(), 18)
    })

    it('should return 18 for any token', () => {
      assert.equal(payments.decimals('FIL' as any), 18)
    })
  })

  describe('Token operations', () => {
    it('should check allowance for USDFC', async () => {
      const paymentsAddress = '0x0E690D3e60B0576D01352AB03b258115eb84A047'
      const allowance = await payments.allowance(SynapsePayments.USDFC, paymentsAddress)
      assert.equal(allowance.toString(), '0')
    })

    it('should approve token spending', async () => {
      const paymentsAddress = '0x0E690D3e60B0576D01352AB03b258115eb84A047'
      const amount = ethers.parseUnits('100', 18)
      const txHash = await payments.approve(SynapsePayments.USDFC, paymentsAddress, amount)
      assert.exists(txHash)
      assert.typeOf(txHash, 'string')
    })

    it('should throw for unsupported token in allowance', async () => {
      try {
        await payments.allowance('FIL' as any, '0x123')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })

    it('should throw for unsupported token in approve', async () => {
      try {
        await payments.approve('FIL' as any, '0x123', 100n)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('Service approvals', () => {
    const serviceAddress = '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4'

    it('should approve service as operator', async () => {
      const rateAllowance = ethers.parseUnits('10', 18) // 10 USDFC per epoch
      const lockupAllowance = ethers.parseUnits('1000', 18) // 1000 USDFC lockup

      const txHash = await payments.approveService(
        serviceAddress,
        rateAllowance,
        lockupAllowance
      )
      assert.exists(txHash)
      assert.typeOf(txHash, 'string')
    })

    it('should revoke service operator approval', async () => {
      const txHash = await payments.revokeService(serviceAddress)
      assert.exists(txHash)
      assert.typeOf(txHash, 'string')
    })

    it('should check service approval status', async () => {
      const approval = await payments.serviceApproval(serviceAddress)
      assert.exists(approval)
      assert.exists(approval.isApproved)
      assert.exists(approval.rateAllowance)
      assert.exists(approval.rateUsed)
      assert.exists(approval.lockupAllowance)
      assert.exists(approval.lockupUsed)
    })

    it('should throw for unsupported token in service operations', async () => {
      try {
        await payments.approveService(serviceAddress, 100n, 1000n, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }

      try {
        await payments.revokeService(serviceAddress, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }

      try {
        await payments.serviceApproval(serviceAddress, 'FIL' as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not supported')
      }
    })
  })

  describe('Error handling', () => {
    it('should throw errors from payment operations', async () => {
      // Create a provider that throws an error for contract calls
      const errorProvider = createMockProvider()

      // Override sendTransaction to throw error
      errorProvider.sendTransaction = async (transaction: any) => {
        throw new Error('Contract execution failed')
      }

      const errorSigner = createMockSigner('0x1234567890123456789012345678901234567890', errorProvider)

      // Also make the signer's sendTransaction throw
      errorSigner.sendTransaction = async () => {
        throw new Error('Transaction failed')
      }

      const errorPayments = new SynapsePayments(errorProvider, errorSigner, 'calibration', false)

      try {
        // Try deposit which uses sendTransaction
        await errorPayments.deposit(ethers.parseUnits('100', 18))
        assert.fail('Should have thrown')
      } catch (error: any) {
        // Should get an error (either from signer or contract)
        assert.exists(error)
        assert.include(error.message, 'failed')
      }
    })
  })
})
