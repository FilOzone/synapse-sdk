/* globals describe it beforeEach */

/**
 * Tests for SynapsePayments class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { SynapsePayments } from '../payments/index.js'
import { TOKENS } from '../utils/index.js'

// Inline mock helpers for browser compatibility
function createMockSigner (address: string = '0x1234567890123456789012345678901234567890', provider?: any): ethers.Signer {
  const signer = {
    provider: provider ?? null,
    async getAddress () { return address },
    async signTransaction () { return '0xsignedtransaction' },
    async signMessage () { return '0xsignedmessage' },
    async signTypedData () { return '0xsignedtypeddata' },
    connect (newProvider: any) {
      return createMockSigner(address, newProvider)
    }
  }
  return signer as unknown as ethers.Signer
}

function createMockProvider (chainId: number = 314159): ethers.Provider {
  const network = new ethers.Network('test', chainId)

  const provider: any = {
    getNetwork: async () => network,
    getSigner: async function () {
      return createMockSigner('0x1234567890123456789012345678901234567890', this)
    },
    getBalance: async (address: string) => ethers.parseEther('100'),
    getTransactionCount: async (address: string, blockTag?: string) => 0,
    call: async (transaction: any) => {
      const data = transaction.data
      if (data == null) return '0x'
      if (data.includes('70a08231') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits('1000', 18)), 32)
      }
      if (data.includes('313ce567') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(18), 32)
      }
      if (data.includes('dd62ed3e') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(0), 32)
      }
      if (data.includes('095ea7b3') === true) {
        return ethers.zeroPadValue(ethers.toBeHex(1), 32)
      }
      if (data.includes('ad74b775') === true) {
        const funds = ethers.parseUnits('500', 18)
        const lockedFunds = 0n
        const frozen = false
        return ethers.AbiCoder.defaultAbiCoder().encode(
          ['uint256', 'uint256', 'bool'],
          [funds, lockedFunds, frozen]
        )
      }
      return '0x'
    },
    getBlockNumber: async () => 1000000,
    getCode: async (address: string) => '0x1234',
    estimateGas: async (transaction: any) => 21000n,
    getFeeData: async () => new ethers.FeeData(
      ethers.parseUnits('1', 'gwei'),
      ethers.parseUnits('1', 'gwei'),
      ethers.parseUnits('1', 'gwei')
    ),
    getLogs: async (filter: any) => [],
    resolveName: async (name: string) => null,
    lookupAddress: async (address: string) => null,
    broadcastTransaction: async (signedTx: string) => {
      throw new Error('Not implemented in mock')
    },
    getBlock: async (blockHashOrBlockTag: any) => {
      throw new Error('Not implemented in mock')
    },
    getTransaction: async (hash: string) => {
      throw new Error('Not implemented in mock')
    },
    getTransactionReceipt: async (hash: string) => {
      throw new Error('Not implemented in mock')
    },
    waitForTransaction: async (hash: string, confirmations?: number, timeout?: number) => {
      throw new Error('Not implemented in mock')
    },
    sendTransaction: async (transaction: any) => {
      const hash = '0x' + Math.random().toString(16).substring(2).padEnd(64, '0')
      return {
        hash,
        from: transaction.from ?? '',
        to: transaction.to ?? null,
        data: transaction.data ?? '',
        value: transaction.value ?? 0n,
        chainId: 314159n,
        gasLimit: 100000n,
        gasPrice: 1000000000n,
        nonce: 0,
        wait: async () => ({
          hash,
          from: transaction.from ?? '',
          to: transaction.to ?? null,
          contractAddress: null,
          index: 0,
          root: '',
          gasUsed: 50000n,
          gasPrice: 1000000000n,
          cumulativeGasUsed: 50000n,
          effectiveGasPrice: 1000000000n,
          logsBloom: '',
          blockHash: '',
          blockNumber: 1000000,
          logs: [],
          status: 1
        })
      } as any
    }
  }

  return provider as ethers.Provider
}

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
