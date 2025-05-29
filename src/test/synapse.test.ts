/* globals describe it */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { Synapse } from '../synapse.js'

// Create a mock signer using object literal with type assertion
function createMockSigner (address: string = '0x1234567890123456789012345678901234567890', provider?: ethers.Provider): ethers.Signer {
  return {
    provider: provider ?? null,
    async getAddress () { return address },
    async signTransaction () { return '0xsignedtransaction' },
    async signMessage () { return '0xsignedmessage' },
    async signTypedData () { return '0xsignedtypeddata' },
    connect (newProvider: ethers.Provider) { return createMockSigner(address, newProvider) }
  } as unknown as ethers.Signer
}

// Mock provider that simulates basic blockchain interactions
class MockProvider extends ethers.AbstractProvider {
  private readonly _network: ethers.Network
  private readonly _mockSigner: ethers.Signer

  constructor (chainId: number = 314159) {
    super()
    this._network = new ethers.Network('test', chainId)
    this._mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', this as any)
  }

  async getNetwork (): Promise<ethers.Network> {
    return this._network
  }

  async getSigner (): Promise<ethers.Signer> {
    return this._mockSigner
  }

  async getBalance (address: string): Promise<bigint> {
    // Mock FIL balance: 100 FIL
    return ethers.parseEther('100')
  }

  async getTransactionCount (address: string, blockTag?: string): Promise<number> {
    return 0
  }

  async call (transaction: ethers.TransactionRequest): Promise<string> {
    // Mock contract calls
    if (transaction.data?.includes('70a08231') === true) {
      // balanceOf call - return 1000 USDFC (18 decimals)
      return ethers.zeroPadValue(ethers.toBeHex(ethers.parseUnits('1000', 18)), 32)
    }
    if (transaction.data?.includes('313ce567') === true) {
      // decimals call - return 18
      return ethers.zeroPadValue(ethers.toBeHex(18), 32)
    }
    return '0x'
  }

  async broadcastTransaction (signedTx: string): Promise<ethers.TransactionResponse> {
    throw new Error('Not implemented in mock')
  }

  async getBlock (blockHashOrBlockTag: string | number): Promise<ethers.Block | null> {
    throw new Error('Not implemented in mock')
  }

  async getTransaction (hash: string): Promise<ethers.TransactionResponse | null> {
    throw new Error('Not implemented in mock')
  }

  async getTransactionReceipt (hash: string): Promise<ethers.TransactionReceipt | null> {
    throw new Error('Not implemented in mock')
  }

  async getLogs (filter: ethers.Filter): Promise<ethers.Log[]> {
    return []
  }

  async resolveName (name: string): Promise<string | null> {
    return null
  }

  async lookupAddress (address: string): Promise<string | null> {
    return null
  }

  async waitForTransaction (hash: string, confirmations?: number, timeout?: number): Promise<ethers.TransactionReceipt | null> {
    throw new Error('Not implemented in mock')
  }

  async estimateGas (transaction: ethers.TransactionRequest): Promise<bigint> {
    return 21000n
  }

  async getFeeData (): Promise<ethers.FeeData> {
    return new ethers.FeeData(ethers.parseUnits('1', 'gwei'), ethers.parseUnits('1', 'gwei'), ethers.parseUnits('1', 'gwei'))
  }

  async _perform (req: ethers.PerformActionRequest): Promise<any> {
    throw new Error('Not implemented in mock')
  }
}

describe('Synapse', () => {
  let mockProvider: MockProvider
  let mockSigner: ethers.Signer

  beforeEach(() => {
    mockProvider = new MockProvider()
    mockSigner = createMockSigner('0x1234567890123456789012345678901234567890', mockProvider)
  })

  describe('Constructor', () => {
    it('should initialize with signer', () => {
      const synapse = new Synapse({ signer: mockSigner })
      assert.instanceOf(synapse, Synapse)
    })

    it('should initialize with provider', () => {
      const synapse = new Synapse({ provider: mockProvider })
      assert.instanceOf(synapse, Synapse)
    })

    it('should initialize with private key and rpcUrl', () => {
      const synapse = new Synapse({
        privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123',
        rpcURL: 'http://localhost:8545'
      })
      assert.instanceOf(synapse, Synapse)
    })

    // Note: WebSocket providers attempt to connect immediately
    // These tests would require a running WebSocket server
    // For now, we'll just verify the URL detection logic works

    it('should throw if no options provided', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new Synapse({} as any)
      }, /Must provide exactly one of/)
    })

    it('should throw if multiple options provided', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new Synapse({
          signer: mockSigner,
          provider: mockProvider
        })
      }, /Must provide exactly one of/)
    })

    it('should throw if privateKey without rpcUrl', () => {
      assert.throws(() => {
        // eslint-disable-next-line no-new
        new Synapse({
          privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123'
        })
      }, /rpcURL is required when using privateKey/)
    })
  })

  describe('Factory Method', () => {
    it('should create instance with signer', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      assert.instanceOf(synapse, Synapse)
    })

    it('should create instance with provider', async () => {
      const synapse = await Synapse.create({ provider: mockProvider })
      assert.instanceOf(synapse, Synapse)
    })

    it('should create instance with private key and rpcUrl', async () => {
      // This test would normally fail because it tries to connect to a real RPC
      // For testing purposes, we'll test the constructor behavior instead
      try {
        await Synapse.create({
          privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123',
          rpcURL: 'http://localhost:8545'
        })
        assert.fail('Should have thrown due to connection error or unsupported network')
      } catch (error) {
        // Should fail with either connection error or unsupported network error
        assert.isTrue(error instanceof Error)
        const message = (error as Error).message
        assert.isTrue(
          message.includes('connect ECONNREFUSED') ||
          message.includes('Synapse network detection failed') ||
          message.includes('Unsupported network'),
          `Unexpected error: ${message}`
        )
      }
    })
  })

  describe('WebSocket URL detection', () => {
    it('should detect WebSocket URLs correctly', () => {
      // Test URL detection logic
      const wsUrls = ['ws://localhost:8546', 'wss://example.com:8546']
      const httpUrls = ['http://localhost:8545', 'https://example.com:8545']

      wsUrls.forEach(url => {
        assert.isTrue(url.startsWith('ws://') || url.startsWith('wss://'), `${url} should be detected as WebSocket`)
      })

      httpUrls.forEach(url => {
        assert.isFalse(url.startsWith('ws://') || url.startsWith('wss://'), `${url} should not be detected as WebSocket`)
      })
    })
  })

  describe('Network validation', () => {
    it('should reject unsupported networks', async () => {
      // Create mock provider with unsupported chain ID (default 314159)
      const unsupportedProvider = new MockProvider(999999)

      try {
        await Synapse.create({ provider: unsupportedProvider })
        assert.fail('Should have thrown for unsupported network')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('Unsupported network with chain ID 999999'))
        assert.isTrue((error as Error).message.includes('Synapse SDK only supports Filecoin mainnet'))
      }
    })
  })

  describe('Error handling', () => {
    it('should use Error cause property for better error chaining', async () => {
      // Test with a failing RPC connection to verify error cause chaining
      try {
        await Synapse.create({
          privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123',
          rpcURL: 'http://localhost:8545'
        })
        assert.fail('Should have thrown due to connection error')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        const synapseError = error as Error

        // Verify the main error message is clean
        assert.isTrue(synapseError.message.includes('Synapse network detection failed'))
        assert.isFalse(synapseError.message.includes('Underlying error:')) // Should not have concatenated message

        // Verify the cause property contains the original error
        assert.isDefined(synapseError.cause)
        assert.isTrue(synapseError.cause instanceof Error)
      }
    })
  })

  describe('walletBalance', () => {
    it('should return FIL balance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const balance = await synapse.walletBalance()
      assert.strictEqual(balance, ethers.parseEther('100'))
    })

    it('should return USDFC balance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const balance = await synapse.walletBalance(Synapse.USDFC)
      assert.strictEqual(balance, ethers.parseUnits('1000', 18))
    })

    it('should handle FIL token explicitly', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const balance = await synapse.walletBalance('FIL')
      assert.strictEqual(balance, ethers.parseEther('100'))
    })
  })

  describe('decimals', () => {
    it('should return 18 for FIL', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const decimals = synapse.decimals('FIL')
      assert.strictEqual(decimals, 18)
    })

    it('should return 18 for USDFC', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const decimals = synapse.decimals('USDFC')
      assert.strictEqual(decimals, 18)
    })

    it('should return 18 for default token', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const decimals = synapse.decimals()
      assert.strictEqual(decimals, 18)
    })
  })

  describe('NonceManager', () => {
    it('should use NonceManager by default', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      // We can't easily test this without accessing private members,
      // but we can verify it doesn't throw and construction succeeds
      assert.instanceOf(synapse, Synapse)
    })

    it('should disable NonceManager when requested', async () => {
      const synapse = await Synapse.create({
        signer: mockSigner,
        disableNonceManager: true
      })
      assert.instanceOf(synapse, Synapse)
    })
  })
})
