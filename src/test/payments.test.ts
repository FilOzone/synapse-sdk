/* globals describe it beforeEach */

/**
 * Tests for SynapsePayments class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { SynapsePayments } from '../payments/index.js'
import { TOKENS } from '../utils/index.js'
import { MockProvider, createMockSigner } from './test-utils.js'

describe('SynapsePayments', () => {
  let mockProvider: MockProvider
  let mockSigner: ethers.Signer
  let payments: SynapsePayments

  beforeEach(() => {
    mockProvider = new MockProvider()
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

    it('should have USDFC constant', () => {
      assert.strictEqual(SynapsePayments.USDFC, TOKENS.USDFC)
      assert.strictEqual(SynapsePayments.USDFC, 'USDFC')
    })
  })

  describe('walletBalance', () => {
    it('should return FIL balance when no token specified', async () => {
      const balance = await payments.walletBalance()
      assert.strictEqual(balance, ethers.parseEther('100'))
    })

    it('should return FIL balance when FIL token specified', async () => {
      const balance = await payments.walletBalance('FIL')
      assert.strictEqual(balance, ethers.parseEther('100'))
    })

    it('should return USDFC balance when USDFC token specified', async () => {
      const balance = await payments.walletBalance('USDFC')
      assert.strictEqual(balance, ethers.parseUnits('1000', 18))
    })

    it('should return USDFC balance using constant', async () => {
      const balance = await payments.walletBalance(SynapsePayments.USDFC)
      assert.strictEqual(balance, ethers.parseUnits('1000', 18))
    })

    it('should return USDFC balance using TOKENS constant', async () => {
      const balance = await payments.walletBalance(TOKENS.USDFC)
      assert.strictEqual(balance, ethers.parseUnits('1000', 18))
    })

    it('should throw for unsupported tokens', async () => {
      try {
        await payments.walletBalance('UNSUPPORTED')
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('not supported'))
      }
    })
  })

  describe('balance', () => {
    it('should return payments contract balance for USDFC', async () => {
      const balance = await payments.balance()
      // MockProvider returns 500 USDFC for accounts call
      assert.strictEqual(balance, ethers.parseUnits('500', 18))
    })

    it('should return payments contract balance when USDFC specified', async () => {
      const balance = await payments.balance('USDFC')
      assert.strictEqual(balance, ethers.parseUnits('500', 18))
    })

    it('should return payments contract balance using constant', async () => {
      const balance = await payments.balance(SynapsePayments.USDFC)
      assert.strictEqual(balance, ethers.parseUnits('500', 18))
    })

    it('should throw for non-USDFC tokens', async () => {
      try {
        await payments.balance('FIL')
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('not supported'))
      }
    })
  })

  describe('decimals', () => {
    it('should return 18 for default token', () => {
      const decimals = payments.decimals()
      assert.strictEqual(decimals, 18)
    })

    it('should return 18 for USDFC', () => {
      const decimals = payments.decimals('USDFC')
      assert.strictEqual(decimals, 18)
    })

    it('should return 18 for FIL', () => {
      const decimals = payments.decimals('FIL')
      assert.strictEqual(decimals, 18)
    })

    it('should return 18 for any token', () => {
      const decimals = payments.decimals('ANYTHING')
      assert.strictEqual(decimals, 18)
    })
  })

  describe('Error handling', () => {
    it('should use Error cause property for contract errors', async () => {
      // Create a provider that throws an error for accounts call
      const errorProvider = new MockProvider()
      const originalCall = errorProvider.call.bind(errorProvider)
      errorProvider.call = async (transaction: ethers.TransactionRequest) => {
        if (typeof transaction.data === 'string' && transaction.data.includes('ad74b775')) {
          throw new Error('Contract call failed')
        }
        return await originalCall(transaction)
      }

      const errorSigner = createMockSigner('0x1234567890123456789012345678901234567890', errorProvider)
      const errorPayments = new SynapsePayments(errorProvider, errorSigner, 'calibration', false)

      try {
        await errorPayments.balance()
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        const paymentsError = error as Error

        // Verify the main error message is clean
        assert.isTrue(paymentsError.message.includes('SynapsePayments'), `Expected message to include 'SynapsePayments' but got: ${paymentsError.message}`)
        assert.isTrue(paymentsError.message.includes('payments contract balance check'))

        // Verify the cause is the original error
        assert.exists(paymentsError.cause)
        assert.isTrue((paymentsError.cause as Error).message.includes('Contract call failed'))
      }
    })
  })

  describe('Network validation', () => {
    it('should work with mainnet network', () => {
      const mainnetPayments = new SynapsePayments(mockProvider, mockSigner, 'mainnet', false)
      assert.exists(mainnetPayments)
      assert.strictEqual(mainnetPayments.decimals(), 18)
    })

    it('should work with calibration network', () => {
      const calibrationPayments = new SynapsePayments(mockProvider, mockSigner, 'calibration', false)
      assert.exists(calibrationPayments)
      assert.strictEqual(calibrationPayments.decimals(), 18)
    })
  })

  describe('NonceManager configuration', () => {
    it('should respect disableNonceManager flag', () => {
      const withNonceManager = new SynapsePayments(mockProvider, mockSigner, 'calibration', false)
      const withoutNonceManager = new SynapsePayments(mockProvider, mockSigner, 'calibration', true)

      // Both should be valid instances
      assert.exists(withNonceManager)
      assert.exists(withoutNonceManager)

      // Can't easily test the internal behavior, but we verify construction succeeds
      assert.isFunction(withNonceManager.walletBalance)
      assert.isFunction(withoutNonceManager.walletBalance)
    })
  })
})
