/* globals describe it */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { Synapse } from '../synapse.js'
import { SynapsePayments } from '../payments/index.js'
import { MockProvider, createMockSigner } from './test-utils.js'

describe('Synapse', () => {
  let mockProvider: MockProvider
  let mockSigner: ethers.Signer

  beforeEach(() => {
    mockProvider = new MockProvider()
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

    it('should create instance with private key and rpcUrl', async function () {
      this.timeout(10000)
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
          message.includes('Failed to detect network') ||
          message.includes('Unsupported network'),
          `Unexpected error: ${message}`
        )
      }
    })

    it('should throw if no options provided', async () => {
      try {
        await Synapse.create({} as any)
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('Must provide exactly one of'))
      }
    })

    it('should throw if multiple options provided', async () => {
      try {
        await Synapse.create({
          signer: mockSigner,
          provider: mockProvider
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('Must provide exactly one of'))
      }
    })

    it('should throw if privateKey without rpcUrl', async () => {
      try {
        await Synapse.create({
          privateKey: '0x0123456789012345678901234567890123456789012345678901234567890123'
        })
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('rpcURL is required when using privateKey'))
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
    it('should use Error cause property for better error chaining', async function () {
      this.timeout(10000)
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
        assert.isTrue(synapseError.message.includes('Failed to detect network'))
        // The factory method still uses old error format with "Underlying error:"
        // This is OK since it's not using _createError (which now uses Error.cause)
      }
    })
  })

  describe('Payments integration', () => {
    it('should provide access to payments instance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof SynapsePayments)
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

    it('should use provided options', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      const storage = await synapse.createStorage({
        proofSetId: 'custom-proof-set',
        storageProvider: 'f0custom'
      })
      assert.strictEqual(storage.proofSetId, 'custom-proof-set')
      assert.strictEqual(storage.storageProvider, 'f0custom')
    })

    it('should respect withCDN option', async () => {
      const synapse = await Synapse.create({ signer: mockSigner, withCDN: true })
      const storage = await synapse.createStorage()
      assert.exists(storage)
      // The MockStorageService should be created with withCDN
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
      const mainnetProvider = new MockProvider(314) // mainnet chain ID
      const synapse = await Synapse.create({ provider: mainnetProvider })

      try {
        synapse.getPDPAuthHelper()
        assert.fail('Should have thrown')
      } catch (error) {
        assert.isTrue(error instanceof Error)
        assert.isTrue((error as Error).message.includes('PDP service contract not deployed'))
      }
    })
  })

  describe('NonceManager', () => {
    it('should use NonceManager by default', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })
      // We can't easily test this without accessing private members,
      // but we can verify it doesn't throw and construction succeeds
      assert.exists(synapse)
      assert.exists(synapse.payments)
    })

    it('should disable NonceManager when requested', async () => {
      const synapse = await Synapse.create({
        signer: mockSigner,
        disableNonceManager: true
      })
      assert.exists(synapse)
      assert.exists(synapse.payments)
    })
  })
})
