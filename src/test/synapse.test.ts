/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { Synapse } from '../synapse.js'
import { PaymentsService } from '../payments/index.js'
import { createMockProvider, createMockSigner } from './test-utils.js'

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
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should create instance with provider', async () => {
      const synapse = await Synapse.create({ provider: mockProvider })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
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

    it.skip('should allow enabling CDN', async () => {
      // Skip this test as it requires real contract interactions
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
      // Create mock provider with unsupported chain ID
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

    it('should accept mainnet with custom pandora address', async () => {
      const mainnetProvider = createMockProvider(314)
      const synapse = await Synapse.create({
        provider: mainnetProvider,
        pandoraAddress: '0x1234567890123456789012345678901234567890' // Custom address for mainnet
      })
      assert.exists(synapse)
    })
  })

  describe('createStorage', () => {
    it.skip('should create storage service', async () => {
      // Skip this test as it requires real contract interactions
      // The real StorageService needs PandoraService and PDPServer
      // which require actual blockchain connections
      const synapse = await Synapse.create({ signer: mockSigner })
      const storage = await synapse.createStorage()
      assert.exists(storage)
      assert.exists(storage.proofSetId)
      assert.exists(storage.storageProvider)
      assert.isFunction(storage.upload)
      assert.isFunction(storage.download)
    })

    it.skip('should accept custom provider ID', async () => {
      // Skip this test as it requires real contract interactions
      const synapse = await Synapse.create({ signer: mockSigner })
      const storage = await synapse.createStorage({ providerId: 1 })
      assert.exists(storage)
    })

    it.skip('should enable CDN option', async () => {
      // Skip this test as it requires real contract interactions
      const synapse = await Synapse.create({ signer: mockSigner })
      const storage = await synapse.createStorage({ withCDN: true })
      assert.exists(storage)
    })
  })

  describe('Payment access', () => {
    it('should provide read-only access to payments', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      // Should be able to access payments
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)

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
})
