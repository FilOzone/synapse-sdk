/* globals describe it */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { Synapse } from '../synapse.js'
import { SynapsePayments } from '../payments/index.js'

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

describe('Synapse', () => {
  let mockProvider: ethers.Provider
  let mockSigner: ethers.Signer

  beforeEach(() => {
    mockProvider = createMockProvider()
    mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', mockProvider)
  })

  describe('Instantiation', () => {
    it('should create instance with signer', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof SynapsePayments)
    })

    it('should create instance with provider', async () => {
      const synapse = await Synapse.create({ provider: mockProvider })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof SynapsePayments)
    })

    it.skip('should create instance with private key', async () => {
      // Skip this test in browser environment as mocking fetch is complex
      // This functionality is tested in Node.js tests
      // Would need to properly mock fetch in browser which is complex
      // Example usage would be:
      // const privateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      // const rpcURL = 'https://api.calibration.node.glif.io/rpc/v1'
      // const synapse = await Synapse.create({ privateKey, rpcURL })
    })

    it('should apply NonceManager by default', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      assert.exists(synapse)
      // We can't directly check if NonceManager is applied, but we can verify the instance is created
    })

    it('should allow disabling NonceManager', async () => {
      const synapse = await Synapse.create({ signer: mockSigner, disableNonceManager: true })
      assert.exists(synapse)
      // We can't directly check if NonceManager is not applied, but we can verify the instance is created
    })

    it('should allow enabling CDN', async () => {
      const synapse = await Synapse.create({ signer: mockSigner, withCDN: true })
      const storageService = await synapse.createStorage()
      assert.exists(storageService)
      // CDN is part of the storage service configuration
    })

    it('should reject when no authentication method provided', async () => {
      try {
        await Synapse.create({} as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Must provide exactly one of')
      }
    })

    it('should reject when multiple authentication methods provided', async () => {
      try {
        await Synapse.create({
          privateKey: '0x123',
          provider: mockProvider,
          rpcURL: 'https://example.com'
        } as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Must provide exactly one of')
      }
    })

    it('should reject privateKey without rpcURL', async () => {
      try {
        await Synapse.create({
          privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
        })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'rpcURL is required when using privateKey')
      }
    })
  })

  describe('Network validation', () => {
    it('should reject unsupported networks', async () => {
      // Create mock provider with unsupported chain ID (default 314159)
      const unsupportedProvider = createMockProvider(999999)

      try {
        await Synapse.create({ provider: unsupportedProvider })
        assert.fail('Should have thrown for unsupported network')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported network')
        assert.include(error.message, '999999')
      }
    })

    it('should accept calibration network', async () => {
      const calibrationProvider = createMockProvider(314159)
      const synapse = await Synapse.create({ provider: calibrationProvider })
      assert.exists(synapse)
    })

    it('should accept mainnet', async () => {
      const mainnetProvider = createMockProvider(314)
      const synapse = await Synapse.create({ provider: mainnetProvider })
      assert.exists(synapse)
    })
  })

  describe('createStorage', () => {
    it('should create storage service', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const storage = await synapse.createStorage()
      assert.exists(storage)
      assert.exists(storage.proofSetId)
      assert.exists(storage.storageProvider)
      assert.isFunction(storage.upload)
      assert.isFunction(storage.download)
      assert.isFunction(storage.delete)
    })

    it('should accept custom proofSetId', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const customProofSetId = 'custom_proof_set_123'
      const storage = await synapse.createStorage({ proofSetId: customProofSetId })
      assert.equal(storage.proofSetId, customProofSetId)
    })

    it('should accept custom storageProvider', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const customProvider = 'f099999'
      const storage = await synapse.createStorage({ storageProvider: customProvider })
      assert.equal(storage.storageProvider, customProvider)
    })
  })

  describe('Payment access', () => {
    it('should provide read-only access to payments', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      // Should be able to access payments
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof SynapsePayments)

      // Should have all payment methods available
      assert.isFunction(synapse.payments.walletBalance)
      assert.isFunction(synapse.payments.balance)
      assert.isFunction(synapse.payments.deposit)
      assert.isFunction(synapse.payments.withdraw)
      assert.isFunction(synapse.payments.decimals)

      // payments property should be read-only (getter only)
      const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(synapse), 'payments')
      assert.exists(descriptor?.get)
      assert.notExists(descriptor?.set)
    })
  })

  describe('getPDPAuthHelper', () => {
    it('should return PDPAuthHelper instance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const authHelper = synapse.getPDPAuthHelper()

      assert.exists(authHelper)
      assert.isFunction(authHelper.signCreateProofSet)
      assert.isFunction(authHelper.signAddRoots)
      assert.isFunction(authHelper.signScheduleRemovals)
      assert.isFunction(authHelper.signDeleteProofSet)
    })

    it('should cache PDPAuthHelper instance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const authHelper1 = synapse.getPDPAuthHelper()
      const authHelper2 = synapse.getPDPAuthHelper()

      assert.strictEqual(authHelper1, authHelper2)
    })

    it('should throw for network without PDP service contract', async () => {
      // Create a mock Synapse instance with mainnet (no PDP service contract address)
      const mainnetProvider = createMockProvider(314) // mainnet chain ID
      const synapse = await Synapse.create({ provider: mainnetProvider })

      try {
        synapse.getPDPAuthHelper()
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'PDP service contract not deployed on mainnet')
      }
    })
  })
})
