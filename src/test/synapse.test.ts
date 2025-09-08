/* globals describe it beforeEach */

/**
 * Basic tests for Synapse class
 */

import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import pDefer from 'p-defer'
import { type Address, isAddressEqual } from 'viem'

import { PaymentsService } from '../payments/index.ts'
import { Synapse } from '../synapse.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS } from './mocks/jsonrpc/index.ts'
import {
  createMockProvider,
  createMockProviderInfo,
  createMockSigner,
  extendMockProviderCall,
  MOCK_ADDRESSES,
  setupProviderRegistryMocks,
} from './test-utils.ts'

// mock server for testing
const server = setup([])
const TEST_PRIVATE_KEY = '0x1234567890123456789012345678901234567890123456789012345678901234'

describe('Synapse', () => {
  let mockProvider: ethers.Provider
  let mockSigner: ethers.Signer
  let signer: ethers.Signer
  let provider: ethers.Provider
  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })
  beforeEach(() => {
    server.resetHandlers()
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
    mockProvider = createMockProvider()
    mockSigner = createMockSigner(MOCK_ADDRESSES.SIGNER, mockProvider)
  })

  describe('Instantiation', () => {
    it('should create instance with signer', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should create instance with provider', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ provider })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should create instance with private key', async () => {
      server.use(JSONRPC())
      const privateKey = '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
      const rpcURL = 'https://api.calibration.node.glif.io/rpc/v1'
      const synapse = await Synapse.create({ privateKey, rpcURL })
      assert.exists(synapse)
      assert.exists(synapse.payments)
      assert.isTrue(synapse.payments instanceof PaymentsService)
    })

    it('should apply NonceManager by default', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })
      assert.exists(synapse)
      // We can't directly check if NonceManager is applied, but we can verify the instance is created
    })

    it('should allow disabling NonceManager', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({
        signer,
        disableNonceManager: true,
      })
      assert.exists(synapse)
      // We can't directly check if NonceManager is not applied, but we can verify the instance is created
    })

    it.skip('should allow enabling CDN', async () => {
      // Skip this test as it requires real contract interactions
      const synapse = await Synapse.create({
        signer: mockSigner,
        withCDN: true,
      })
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
          provider,
          rpcURL: 'https://example.com',
        } as any)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Must provide exactly one of')
      }
    })

    it('should reject privateKey without rpcURL', async () => {
      try {
        await Synapse.create({
          privateKey: '0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
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
      // const unsupportedProvider = createMockProvider(999999)
      server.use(
        JSONRPC({
          eth_chainId: '999999',
        })
      )
      try {
        await Synapse.create({ provider })
        assert.fail('Should have thrown for unsupported network')
      } catch (error: any) {
        assert.include(error.message, 'Unsupported network')
        assert.include(error.message, '999999')
      }
    })

    it('should accept calibration network', async () => {
      server.use(
        JSONRPC({
          eth_chainId: '314159',
        })
      )
      const synapse = await Synapse.create({ provider })
      assert.exists(synapse)
    })

    it('should accept mainnet with custom warmStorage address', async () => {
      server.use(
        JSONRPC({
          eth_chainId: '314',
        })
      )
      const synapse = await Synapse.create({
        provider,
        warmStorageAddress: '0x1234567890123456789012345678901234567890', // Custom address for mainnet
        pdpVerifierAddress: '0x9876543210987654321098765432109876543210', // Custom PDPVerifier address for mainnet
      })
      assert.exists(synapse)
    })

    // custom addresses are not used anymore in the SDK
    it.skip('should accept custom pdpVerifierAddress', async () => {
      const customPDPVerifierAddress = '0xabcdef1234567890123456789012345678901234'
      server.use(
        JSONRPC({
          warmStorage: {
            pdpVerifierAddress: customPDPVerifierAddress,
          },
        })
      )

      const synapse = await Synapse.create({
        provider,
        pdpVerifierAddress: customPDPVerifierAddress,
      })
      assert.exists(synapse)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, customPDPVerifierAddress))
    })

    // theres no default pdpVerifierAddress in the SDK anymore
    it.skip('should use default pdpVerifierAddress when not provided', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({
        provider,
      })
      assert.exists(synapse)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, ADDRESSES.calibration.pdpVerifier))
    })

    // custom addresses are not used anymore in the SDK
    it.skip('should accept both custom warmStorageAddress and pdpVerifierAddress', async () => {
      const customPDPVerifierAddress = '0x2222222222222222222222222222222222222222'

      server.use(JSONRPC())
      const synapse = await Synapse.create({
        provider,
        warmStorageAddress: ADDRESSES.mainnet.warmStorage,
        pdpVerifierAddress: customPDPVerifierAddress,
      })
      assert.exists(synapse)
      assert.equal(synapse.getWarmStorageAddress(), ADDRESSES.mainnet.warmStorage)
      assert.ok(isAddressEqual(synapse.getPDPVerifierAddress() as Address, customPDPVerifierAddress))
    })
  })

  describe('StorageManager access', () => {
    it('should provide access to StorageManager via synapse.storage', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })

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
      server.use(JSONRPC())
      const synapse = await Synapse.create({
        signer,
        withCDN: true,
      })

      assert.exists(synapse.storage)
      // The storage manager should inherit the withCDN setting
      // We can't directly test this without accessing private properties
      // but it will be used in upload/download operations
    })

    it('should return same storage manager instance', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })

      const storage1 = synapse.storage
      const storage2 = synapse.storage

      // Should be the same instance
      assert.equal(storage1, storage2)
    })
  })

  describe('Payment access', () => {
    it('should provide read-only access to payments', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })

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
      server.use(JSONRPC())

      const synapse = await Synapse.create({ provider })
      const providerInfo = await synapse.getProviderInfo(ADDRESSES.serviceProvider1)

      assert.ok(isAddressEqual(providerInfo.serviceProvider as Address, ADDRESSES.serviceProvider1))
      assert.equal(providerInfo.products.PDP?.data.serviceURL, 'https://pdp.example.com')
    })

    it('should throw for invalid provider address', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })

      try {
        await synapse.getProviderInfo('invalid-address')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Invalid provider address')
      }
    })

    it('should throw for non-approved provider', async () => {
      server.use(
        JSONRPC({
          serviceRegistry: {
            getProviderIdByAddress: 3n,
          },
          warmStorageView: {
            isProviderApproved: ([providerId]) => providerId === 1n,
          },
        })
      )
      const mockProviderAddress = ADDRESSES.serviceProvider1

      try {
        const synapse = await Synapse.create({ signer })
        await synapse.getProviderInfo(mockProviderAddress)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not approved')
      }
    })

    it('should throw when provider not found', async () => {
      server.use(
        JSONRPC({
          serviceRegistry: {
            getProviderByAddress: [
              {
                serviceProvider: ADDRESSES.zero,
                payee: ADDRESSES.zero,
                name: '',
                description: '',
                isActive: false,
              },
            ],
          },
        })
      )

      try {
        const synapse = await Synapse.create({ signer })
        await synapse.getProviderInfo(ADDRESSES.serviceProvider1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'not found')
      }
    })
  })

  describe('download', () => {
    it('should validate PieceCID input', async () => {
      server.use(JSONRPC())
      const synapse = await Synapse.create({ signer })

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
      server.use(
        JSONRPC(),
        http.get('https://pdp.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')

          return HttpResponse.json({
            pieceCid,
          })
        }),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const synapse = await Synapse.create({
        signer,
      })

      // Use the actual PieceCID for 'test data'
      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'
      const data = await synapse.download(testPieceCid)

      // Should return Uint8Array
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass withCDN option to retriever', async () => {
      const deferred = pDefer<{ cid: string; wallet: string }>()
      const testData = new TextEncoder().encode('test data')
      server.use(
        JSONRPC({ debug: true }),
        http.get<{ cid: string; wallet: string }>(`https://:wallet.calibration.filcdn.io/:cid`, async ({ params }) => {
          deferred.resolve(params)
          return HttpResponse.arrayBuffer(testData.buffer)
        }),
        http.get('https://pdp.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')

          return HttpResponse.json({
            pieceCid,
          })
        }),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )

      const synapse = await Synapse.create({
        signer,
        withCDN: false, // Instance default
      })

      const testPieceCid = 'bafkzcibcoybm2jlqsbekq6uluyl7xm5ffemw7iuzni5ez3a27iwy4qu3ssebqdq'

      // Test with explicit withCDN
      await synapse.download(testPieceCid, { withCDN: true })
      const result = await deferred.promise

      const { cid, wallet } = result
      assert.equal(cid, testPieceCid)
      assert.ok(isAddressEqual(wallet as Address, ADDRESSES.client1))

      // Test without explicit withCDN (should use instance default)
      const data = await synapse.download(testPieceCid)
      assert.isTrue(data instanceof Uint8Array)
      assert.equal(new TextDecoder().decode(data), 'test data')
    })

    it('should pass providerAddress option to retriever', async () => {
      let providerAddressReceived: string | undefined
      const testData = new TextEncoder().encode('test data')
      const mockRetriever = {
        fetchPiece: async (_pieceCid: any, _client: string, options?: any) => {
          providerAddressReceived = options?.providerAddress
          return new Response(testData)
        },
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever,
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
        },
      }

      const synapse = await Synapse.create({
        signer: mockSigner,
        pieceRetriever: mockRetriever,
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
    it.skip('should return comprehensive storage information', async () => {
      // SKIPPED: Complex mock chaining issue with provider registry mocks
      // Mock provider data
      const mockProvider1 = createMockProviderInfo({
        id: 1,
        serviceProvider: '0x1111111111111111111111111111111111111111',
        name: 'Test Provider 1',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {},
            data: {
              serviceURL: 'https://pdp1.example.com',
              minPieceSizeInBytes: BigInt(1024),
              maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerMonth: BigInt(1000000),
              minProvingPeriodInEpochs: 2880,
              location: 'US-EAST',
              paymentTokenAddress: ethers.ZeroAddress,
            },
          },
        },
      })
      const mockProvider2 = createMockProviderInfo({
        id: 2,
        serviceProvider: '0x2222222222222222222222222222222222222222',
        name: 'Test Provider 2',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {},
            data: {
              serviceURL: 'https://pdp2.example.com',
              minPieceSizeInBytes: BigInt(1024),
              maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerMonth: BigInt(2000000),
              minProvingPeriodInEpochs: 2880,
              location: 'EU-WEST',
              paymentTokenAddress: ethers.ZeroAddress,
            },
          },
        },
      })

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400,
      }

      // Mock allowances will be handled by setupProviderRegistryMocks

      // Combine registry mocks with pricing mocks in a single function
      const cleanup = extendMockProviderCall(mockProvider, async (transaction: any) => {
        const data = transaction.data

        // First try the pricing mock
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [
              [
                mockPricingData.pricePerTiBPerMonthNoCDN,
                mockPricingData.pricePerTiBPerMonthWithCDN,
                mockPricingData.tokenAddress,
                mockPricingData.epochsPerMonth,
              ],
            ]
          )
        }

        // Mock getApprovedProviders() - returns array of provider IDs
        if (data?.startsWith('0x266afe1b')) {
          return ethers.AbiCoder.defaultAbiCoder().encode(['uint256[]'], [[BigInt(1), BigInt(2)]])
        }

        return null
      })

      // Also set up provider registry mocks for the SPRegistry calls
      const registryCleanup = setupProviderRegistryMocks(mockProvider, {
        approvedIds: [1, 2],
        providers: [mockProvider1, mockProvider2],
      })

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
        assert.equal(storageInfo.providers[0].serviceProvider, mockProvider1.serviceProvider)
        assert.equal(storageInfo.providers[1].serviceProvider, mockProvider2.serviceProvider)

        // Check service parameters
        assert.equal(storageInfo.serviceParameters.network, 'calibration')
        assert.equal(storageInfo.serviceParameters.epochsPerMonth, BigInt(86400))
        assert.equal(storageInfo.serviceParameters.epochsPerDay, 2880n)
        assert.equal(storageInfo.serviceParameters.epochDuration, 30)
        assert.equal(storageInfo.serviceParameters.minUploadSize, 127)
        assert.equal(storageInfo.serviceParameters.maxUploadSize, 200 * 1024 * 1024)

        // Check allowances
        assert.exists(storageInfo.allowances)
        assert.equal(storageInfo.allowances?.service, '0xA94C1139412da84d3bBb152dac22B0943332fD78')
        assert.equal(storageInfo.allowances?.rateAllowance, BigInt(1000000))
        assert.equal(storageInfo.allowances?.lockupAllowance, BigInt(10000000))
      } finally {
        cleanup()
        registryCleanup()
      }
    })

    it('should handle missing allowances gracefully', async () => {
      // No providers for this test

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400,
      }

      // Setup with no providers and throw on approval check
      const registryCleanup = setupProviderRegistryMocks(mockProvider, {
        approvedIds: [],
        providers: [],
        throwOnApproval: true, // This will make allowances return null
      })

      // Add pricing mocks
      const pricingCleanup = extendMockProviderCall(mockProvider, async (transaction: any) => {
        const data = transaction.data

        // Mock getServicePrice
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [
              [
                mockPricingData.pricePerTiBPerMonthNoCDN,
                mockPricingData.pricePerTiBPerMonthWithCDN,
                mockPricingData.tokenAddress,
                mockPricingData.epochsPerMonth,
              ],
            ]
          )
        }

        return null
      })

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const storageInfo = await synapse.getStorageInfo()

        // Should still return data with null allowances
        assert.exists(storageInfo.pricing)
        assert.exists(storageInfo.providers)
        assert.exists(storageInfo.serviceParameters)
        assert.isNull(storageInfo.allowances)
      } finally {
        registryCleanup()
        pricingCleanup()
      }
    })

    it.skip('should filter out zero address providers', async () => {
      // SKIPPED: Complex mock chaining issue with provider registry mocks
      // Mock provider data with a zero address
      const mockProvider1 = createMockProviderInfo({
        id: 1,
        serviceProvider: '0x1111111111111111111111111111111111111111',
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {},
            data: {
              serviceURL: 'https://pdp1.example.com',
              minPieceSizeInBytes: BigInt(1024),
              maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerMonth: BigInt(1000000),
              minProvingPeriodInEpochs: 2880,
              location: 'US-EAST',
              paymentTokenAddress: ethers.ZeroAddress,
            },
          },
        },
      })
      // Provider with zero address should be filtered out
      const mockProvider2 = createMockProviderInfo({
        id: 2,
        serviceProvider: ethers.ZeroAddress,
        active: false,
      })

      // Mock pricing data
      const mockPricingData = {
        pricePerTiBPerMonthNoCDN: ethers.parseUnits('2', 18), // 2 USDFC per TiB per month
        pricePerTiBPerMonthWithCDN: ethers.parseUnits('3', 18), // 3 USDFC per TiB per month
        tokenAddress: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
        epochsPerMonth: 86400,
      }

      // Setup registry mocks with both providers (including zero address)
      const registryCleanup = setupProviderRegistryMocks(mockProvider, {
        approvedIds: [1, 2],
        providers: [mockProvider1, mockProvider2],
        throwOnApproval: true, // No allowances
      })

      // Add pricing mocks
      const pricingCleanup = extendMockProviderCall(mockProvider, async (transaction: any) => {
        const data = transaction.data

        // Mock getServicePrice
        if (data?.startsWith('0x5482bdf9') === true) {
          return ethers.AbiCoder.defaultAbiCoder().encode(
            ['tuple(uint256,uint256,address,uint256)'],
            [
              [
                mockPricingData.pricePerTiBPerMonthNoCDN,
                mockPricingData.pricePerTiBPerMonthWithCDN,
                mockPricingData.tokenAddress,
                mockPricingData.epochsPerMonth,
              ],
            ]
          )
        }

        return null
      })

      try {
        const synapse = await Synapse.create({ signer: mockSigner })
        const storageInfo = await synapse.getStorageInfo()

        // Should filter out zero address provider
        assert.equal(storageInfo.providers.length, 1)
        assert.equal(storageInfo.providers[0].serviceProvider, mockProvider1.serviceProvider)
      } finally {
        registryCleanup()
        pricingCleanup()
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
        // The error should bubble up from the contract call
        assert.include(error.message, 'RPC error')
      } finally {
        mockProvider.call = originalCall
      }
    })
  })
})
