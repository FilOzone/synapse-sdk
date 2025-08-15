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
        assert.include(error.message, 'Invalid network')
        assert.include(error.message, '999999')
      }
    })

    it('should accept calibration network', async () => {
      const calibrationProvider = createMockProvider(314159)
      const synapse = await Synapse.create({ provider: calibrationProvider })
      assert.exists(synapse)
    })

    it('should accept mainnet with custom warmStorage address', async () => {
      const mainnetProvider = createMockProvider(314)
      const synapse = await Synapse.create({
        provider: mainnetProvider,
        warmStorageAddress: '0x1234567890123456789012345678901234567890', // Custom address for mainnet
        pdpVerifierAddress: '0x9876543210987654321098765432109876543210' // Custom PDPVerifier address for mainnet
      })
      assert.exists(synapse)
    })

    it('should accept custom pdpVerifierAddress', async () => {
      const calibrationProvider = createMockProvider(314159)
      const customPDPVerifierAddress = '0xabcdef1234567890123456789012345678901234'
      const synapse = await Synapse.create({
        provider: calibrationProvider,
        pdpVerifierAddress: customPDPVerifierAddress
      })
      assert.exists(synapse)
      assert.equal(synapse.getPDPVerifierAddress(), customPDPVerifierAddress)
    })

    it('should use default pdpVerifierAddress when not provided', async () => {
      const calibrationProvider = createMockProvider(314159)
      const synapse = await Synapse.create({
        provider: calibrationProvider
      })
      assert.exists(synapse)
      assert.equal(synapse.getPDPVerifierAddress(), '0xf9f521c6e11A1680ead3eDD8a2757Ea731458617') // Calibration default
    })

    it('should accept both custom warmStorageAddress and pdpVerifierAddress', async () => {
      const mainnetProvider = createMockProvider(314)
      const customWarmStorageAddress = '0x1111111111111111111111111111111111111111'
      const customPDPVerifierAddress = '0x2222222222222222222222222222222222222222'
      const synapse = await Synapse.create({
        provider: mainnetProvider,
        warmStorageAddress: customWarmStorageAddress,
        pdpVerifierAddress: customPDPVerifierAddress
      })
      assert.exists(synapse)
      assert.equal(synapse.getWarmStorageAddress(), customWarmStorageAddress)
      assert.equal(synapse.getPDPVerifierAddress(), customPDPVerifierAddress)
    })
  })

  describe('StorageManager access', () => {
    it('should provide access to StorageManager via synapse.storage', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      // Should be able to access storage manager
      assert.exists(synapse.storage)
      assert.isObject(synapse.storage)

      // Should have all storage manager methods available
      assert.isFunction(synapse.storage.upload)
      assert.isFunction(synapse.storage.download)
      assert.isFunction(synapse.storage.createContext)
      assert.isFunction(synapse.storage.getDefaultContext)
      assert.isFunction(synapse.storage.findDataSets)
    })

    it('should create storage manager with CDN settings', async () => {
      const synapse = await Synapse.create({
        signer: mockSigner,
        withCDN: true
      })

      assert.exists(synapse.storage)
      // The storage manager should inherit the withCDN setting
      // We can't directly test this without accessing private properties
      // but it will be used in upload/download operations
    })

    it('should return same storage manager instance', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      const storage1 = synapse.storage
      const storage2 = synapse.storage

      // Should be the same instance
      assert.equal(storage1, storage2)
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

  describe('getProviderInfo', () => {
    it('should get provider info for valid approved provider', async () => {
      const mockProviderAddress = '0xabcdef1234567890123456789012345678901234'
      const expectedProviderInfo = {
        serviceProvider: mockProviderAddress,
        serviceURL: 'https://pdp.example.com',
        peerId: 'test-peer-id',
        registeredAt: 1000000,
        approvedAt: 2000000
      }

      // Mock WarmStorageService calls
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getProviderIdByAddress
        if (data?.startsWith('0x93ecb91e') === true) {
          return ethers.zeroPadValue('0x01', 32) // Return provider ID 1
        }

        // Mock getApprovedProvider
        if (data?.startsWith('0x1c7db86a') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)'],
            [[
              expectedProviderInfo.serviceProvider,
              expectedProviderInfo.serviceURL,
              ethers.toUtf8Bytes(expectedProviderInfo.peerId),
              expectedProviderInfo.registeredAt,
              expectedProviderInfo.approvedAt
            ]]
          )
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const providerInfo = await synapse.getProviderInfo(mockProviderAddress)

        assert.equal(providerInfo.serviceProvider.toLowerCase(), mockProviderAddress.toLowerCase())
        assert.equal(providerInfo.serviceURL, expectedProviderInfo.serviceURL)
        assert.equal(providerInfo.peerId, expectedProviderInfo.peerId)
        assert.equal(providerInfo.registeredAt, expectedProviderInfo.registeredAt)
        assert.equal(providerInfo.approvedAt, expectedProviderInfo.approvedAt)
      } finally {
        mockProvider.call = originalCall
      }
    })

    it('should throw for invalid provider address', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      try {
        await synapse.getProviderInfo('invalid-address')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid provider address')
      }
    })

    it('should throw for non-approved provider', async () => {
      const mockProviderAddress = '0xabcdef1234567890123456789012345678901234'

      // Mock WarmStorageService to return 0 for provider ID (not approved)
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getProviderIdByAddress returning 0
        if (data?.startsWith('0x93ecb91e') === true) {
          return ethers.zeroPadValue('0x00', 32) // Return provider ID 0 (not approved)
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        await synapse.getProviderInfo(mockProviderAddress)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'is not approved')
      } finally {
        mockProvider.call = originalCall
      }
    })

    it('should throw when provider not found', async () => {
      const mockProviderAddress = '0xabcdef1234567890123456789012345678901234'

      // Mock WarmStorageService calls
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getProviderIdByAddress
        if (data?.startsWith('0x93ecb91e') === true) {
          return ethers.zeroPadValue('0x01', 32) // Return provider ID 1
        }

        // Mock getApprovedProvider returning zero address (not found)
        if (data?.startsWith('0x1c7db86a') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)'],
            [[
              ethers.ZeroAddress,
              '',
              ethers.toUtf8Bytes(''),
              0,
              0
            ]]
          )
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        await synapse.getProviderInfo(mockProviderAddress)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not found')
      } finally {
        mockProvider.call = originalCall
      }
    })
  })

  describe('download', () => {
    it('should validate PieceCID input', async () => {
      const synapse = await Synapse.create({ signer: mockSigner })

      try {
        await synapse.download('invalid-piece-link')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID')
        assert.include(error.message, 'invalid-piece-link')
      }
    })

    it('should accept valid PieceCID string', async () => {
      // Create test data that matches the expected PieceCID
      const testData = new TextEncoder().encode('test data')

      // Mock the piece retriever
      const mockResponse = new Response(testData, { status: 200 })
      const mockRetriever = {
        fetchPiece: async () => mockResponse
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever
      })

      // Use the actual PieceCID for 'test data'
      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const data = await synapse.download(testPieceCid)

      // Should return Uint8Array
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass withCDN option to retriever', async () => {
      let cdnOptionReceived: boolean | undefined
      const testData = new TextEncoder().encode('test data')
      const mockRetriever = {
        fetchPiece: async (pieceCid: any, client: string, options?: any) => {
          cdnOptionReceived = options?.withCDN
          return new Response(testData)
        }
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever,
        withCDN: false // Instance default
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      // Test with explicit withCDN
      await synapse.download(testPieceCid, { withCDN: true })
      assert.equal(cdnOptionReceived, true, 'Should pass explicit withCDN')

      // Test without explicit withCDN (should use instance default)
      await synapse.download(testPieceCid)
      assert.equal(cdnOptionReceived, false, 'Should use instance default')
    })

    it('should pass providerAddress option to retriever', async () => {
      let providerAddressReceived: string | undefined
      const testData = new TextEncoder().encode('test data')
      const mockRetriever = {
        fetchPiece: async (pieceCid: any, client: string, options?: any) => {
          providerAddressReceived = options?.providerAddress
          return new Response(testData)
        }
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const testProvider = '0x1234567890123456789012345678901234567890'

      await synapse.download(testPieceCid, { providerAddress: testProvider })
      assert.equal(providerAddressReceived, testProvider)
    })

    it('should handle download errors', async () => {
      const mockRetriever = {
        fetchPiece: async () => {
          throw new Error('Network error')
        }
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      try {
        await synapse.download(testPieceCid)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Network error')
      }
    })
  })

  describe('getStorageInfo', () => {
    it('should return comprehensive storage information', async () => {
      // Mock provider data
      const mockProviders = [
        {
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        },
        {
          serviceProvider: '0x2222222222222222222222222222222222222222',
          serviceURL: 'https://pdp2.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567892,
          approvedAt: 1234567893
        }
      ]

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400
      }

      // Mock allowances
      const mockAllowances = {
        service: '0xfa564144f183E4E7B8FEdCfbAa412afc83D5aE3d',
        rateAllowance: BigInt(1000000),
        lockupAllowance: BigInt(10000000),
        rateUsed: BigInt(500000),
        lockupUsed: BigInt(5000000)
      }

      // Mock provider call responses
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getServicePrice
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [[
              mockPricingData.pricePerTiBPerMonthNoCDN,
              mockPricingData.pricePerTiBPerMonthWithCDN,
              mockPricingData.tokenAddress,
              mockPricingData.epochsPerMonth
            ]]
          )
        }

        // Mock getAllApprovedProviders
        if (data?.startsWith('0x0af14754') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)[]'],
            [mockProviders.map(p => [p.serviceProvider, p.serviceURL, ethers.toUtf8Bytes(p.peerId), p.registeredAt, p.approvedAt])]
          )
        }

        // Mock operatorApprovals (called by serviceApproval in PaymentsService)
        if (data?.startsWith('0xe3d4c69e') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['bool', 'uint256', 'uint256', 'uint256', 'uint256', 'uint256'],
            [
              true, // isApproved
              mockAllowances.rateAllowance,
              mockAllowances.lockupAllowance,
              mockAllowances.rateUsed,
              mockAllowances.lockupUsed,
              86400n // maxLockupPeriod: 30 days
            ]
          )
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const storageInfo = await synapse.getStorageInfo()

        // Check pricing
        assert.exists(storageInfo.pricing)
        assert.exists(storageInfo.pricing.noCDN)
        assert.exists(storageInfo.pricing.withCDN)

        // Verify pricing calculations (2 USDFC per TiB per month)
        const expectedNoCDNMonthly = ethers.parseUnits('2', 18) // 2 USDFC
        assert.equal(storageInfo.pricing.noCDN.perTiBPerMonth, expectedNoCDNMonthly)

        // Check providers
        assert.equal(storageInfo.providers.length, 2)
        assert.equal(storageInfo.providers[0].serviceProvider, mockProviders[0].serviceProvider)
        assert.equal(storageInfo.providers[1].serviceProvider, mockProviders[1].serviceProvider)

        // Check service parameters
        assert.equal(storageInfo.serviceParameters.network, 'calibration')
        assert.equal(storageInfo.serviceParameters.epochsPerMonth, BigInt(86400))
        assert.equal(storageInfo.serviceParameters.epochsPerDay, 2880n)
        assert.equal(storageInfo.serviceParameters.epochDuration, 30)
        assert.equal(storageInfo.serviceParameters.minUploadSize, 65)
        assert.equal(storageInfo.serviceParameters.maxUploadSize, 200 * 1024 * 1024)

        // Check allowances
        assert.exists(storageInfo.allowances)
        assert.equal(storageInfo.allowances?.service, mockAllowances.service)
        assert.equal(storageInfo.allowances?.rateAllowance, mockAllowances.rateAllowance)
        assert.equal(storageInfo.allowances?.lockupAllowance, mockAllowances.lockupAllowance)
      } finally {
        mockProvider.call = originalCall
      }
    })

    it('should handle missing allowances gracefully', async () => {
      // Mock provider data
      const mockProviders: any[] = []

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400
      }

      // Mock provider call responses
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getServicePrice
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [[
              mockPricingData.pricePerTiBPerMonthNoCDN,
              mockPricingData.pricePerTiBPerMonthWithCDN,
              mockPricingData.tokenAddress,
              mockPricingData.epochsPerMonth
            ]]
          )
        }

        // Mock getAllApprovedProviders
        if (data?.startsWith('0x0af14754') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)[]'],
            [mockProviders.map(p => [p.serviceProvider, p.serviceURL, ethers.toUtf8Bytes(p.peerId), p.registeredAt, p.approvedAt])]
          )
        }

        // Mock operatorApprovals to fail (no wallet connected)
        if (data?.startsWith('0xe3d4c69e') === true) {
          throw new Error('No wallet connected')
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const storageInfo = await synapse.getStorageInfo()

        // Should still return data with null allowances
        assert.exists(storageInfo.pricing)
        assert.exists(storageInfo.providers)
        assert.exists(storageInfo.serviceParameters)
        assert.isNull(storageInfo.allowances)
      } finally {
        mockProvider.call = originalCall
      }
    })

    it('should filter out zero address providers', async () => {
      // Mock provider data with a zero address
      const mockProviders = [
        {
          serviceProvider: '0x1111111111111111111111111111111111111111',
          serviceURL: 'https://pdp1.example.com',
          peerId: 'test-peer-id',
          registeredAt: 1234567890,
          approvedAt: 1234567891
        },
        {
          serviceProvider: ethers.ZeroAddress,
          serviceURL: '',
          peerId: '',
          registeredAt: 0,
          approvedAt: 0
        }
      ]

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400
      }

      // Mock provider call responses
      const originalCall = mockProvider.call
      mockProvider.call = async (transaction: any) => {
        const data = transaction.data

        // Mock getServicePrice
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [[
              mockPricingData.pricePerTiBPerMonthNoCDN,
              mockPricingData.pricePerTiBPerMonthWithCDN,
              mockPricingData.tokenAddress,
              mockPricingData.epochsPerMonth
            ]]
          )
        }

        // Mock getAllApprovedProviders
        if (data?.startsWith('0x0af14754') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(address,string,bytes,uint256,uint256)[]'],
            [mockProviders.map(p => [p.serviceProvider, p.serviceURL, ethers.toUtf8Bytes(p.peerId), p.registeredAt, p.approvedAt])]
          )
        }

        // Mock operatorApprovals to return null
        if (data?.startsWith('0xe3d4c69e') === true) {
          throw new Error('No allowances')
        }

        return '0x' + '0'.repeat(64)
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const storageInfo = await synapse.getStorageInfo()

        // Should filter out zero address provider
        assert.equal(storageInfo.providers.length, 1)
        assert.equal(storageInfo.providers[0].serviceProvider, mockProviders[0].serviceProvider)
      } finally {
        mockProvider.call = originalCall
      }
    })

    it('should handle contract call failures', async () => {
      // Mock provider to fail
      const originalCall = mockProvider.call
      mockProvider.call = async () => {
        throw new Error('RPC error')
      }

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        await synapse.getStorageInfo()
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Failed to get storage service information')
        assert.include(error.message, 'RPC error')
      } finally {
        mockProvider.call = originalCall
      }
    })
  })
})
