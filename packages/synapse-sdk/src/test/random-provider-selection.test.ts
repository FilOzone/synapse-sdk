/* globals describe it beforeEach afterEach */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { StorageContext } from '../storage/context.ts'
import type { Synapse } from '../synapse.ts'
import type { ProviderInfo } from '../types.ts'
import { createMockProviderInfo, setupProviderRegistryMocks } from './test-utils.ts'

// Create a mock Ethereum provider that doesn't try to connect
const mockEthProvider = {
  getTransaction: async (hash: string) => {
    // Return a mock transaction for the test txHash produced by our fetch mock
    if (hash === '0xdeadbeef') {
      return {
        hash,
        wait: async (_confirms?: number) => ({ status: 1, blockNumber: 123 }),
      } as any
    }
    return null
  },
  getNetwork: async () => ({ chainId: BigInt(314159), name: 'calibration' }),
  call: async (_tx: any) => {
    // Mock contract calls - return empty data for registry calls
    return '0x'
  },
} as any

// Mock Synapse instance
const mockSynapse = {
  getSigner: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getClient: () => new ethers.Wallet(ethers.hexlify(ethers.randomBytes(32))),
  getProvider: () => mockEthProvider,
  getWarmStorageAddress: () => '0x1234567890123456789012345678901234567890',
  getChainId: () => BigInt(314159),
  payments: {
    serviceApproval: async () => ({
      service: '0x1234567890123456789012345678901234567890',
      rateAllowance: BigInt(1000000),
      lockupAllowance: BigInt(10000000),
      rateUsed: BigInt(0),
      lockupUsed: BigInt(0),
    }),
  },
  getNetwork: () => 'calibration',
} as unknown as Synapse

// Test providers for random selection tests
const RANDOM_TEST_PROVIDERS = {
  provider1: createMockProviderInfo({
    id: 1,
    serviceProvider: '0x1111111111111111111111111111111111111111',
    name: 'Random Test Provider 1',
  }),
  provider2: createMockProviderInfo({
    id: 2,
    serviceProvider: '0x2222222222222222222222222222222222222222',
    name: 'Random Test Provider 2',
  }),
  provider3: createMockProviderInfo({
    id: 3,
    serviceProvider: '0x3333333333333333333333333333333333333333',
    name: 'Random Test Provider 3',
  }),
  provider4: createMockProviderInfo({
    id: 4,
    serviceProvider: '0x4444444444444444444444444444444444444444',
    name: 'Random Test Provider 4',
  }),
  provider5: createMockProviderInfo({
    id: 5,
    serviceProvider: '0x5555555555555555555555555555555555555555',
    name: 'Random Test Provider 5',
  }),
}

// Helper to create a mock WarmStorageService
function createMockWarmStorageService(providers: ProviderInfo[], dataSets: any[] = [], overrides: any = {}) {
  const allProviders = [...providers]

  const mockService = {
    getServiceProviderRegistryAddress: () => '0x0000000000000000000000000000000000000001',
    getClientDataSetsWithDetails: async (clientAddress: string) => {
      return dataSets.filter((ds) => ds.payer?.toLowerCase() === clientAddress.toLowerCase())
    },
    getNextClientDataSetId: async (_clientAddress: string) => 1,
    getDataSetMetadata: async (_dataSetId: number) => ({}),
    getAddPiecesInfo: async (_dataSetId: number) => ({
      clientDataSetId: 1,
      nextPieceId: 0,
    }),
    waitForDataSetCreationWithStatus: async () => ({
      summary: {
        isComplete: true,
        dataSetId: 101,
        error: null,
      },
    }),
    checkAllowanceForStorage: async (_size: number, _withCDN: boolean, _paymentsService: any) => ({
      sufficient: true,
      message: 'Allowance sufficient',
      costs: {
        perEpoch: BigInt(100),
        perDay: BigInt(2400),
        perMonth: BigInt(72000),
      },
    }),
    getApprovedProvider: async (id: number) => {
      return allProviders.find((p) => p.id === id) ?? null
    },
    getApprovedProviderByAddress: async (address: string) => {
      return allProviders.find((p) => p.serviceProvider.toLowerCase() === address.toLowerCase()) ?? null
    },
    // Methods used by ProviderResolver
    getApprovedProviderIds: async () => {
      return allProviders.map((p) => p.id)
    },
    isProviderIdApproved: async (id: number) => {
      return allProviders.some((p) => p.id === id)
    },
    getProvider: () => mockEthProvider,
    getViewContractAddress: () => '0x0000000000000000000000000000000000000001',
    ...overrides,
  }

  return mockService
}

describe('Random Provider Selection', () => {
  let cleanupMocks: (() => void) | null = null
  let originalFetch: typeof global.fetch

  beforeEach(() => {
    // Mock fetch for ping tests - default all providers respond successfully
    originalFetch = global.fetch
    global.fetch = async (input: string | URL | Request, init?: any) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as any).url

      // Handle ping endpoint used by provider health checks
      if (url.includes('/ping')) {
        return { status: 200, statusText: 'OK', text: async () => 'OK' } as any
      }

      // Handle PDP createDataSet POST used during data set creation
      if (url.endsWith('/pdp/data-sets') && init?.method === 'POST') {
        return {
          status: 201,
          statusText: 'Created',
          headers: {
            get: (_name: string) => '/pdp/data-sets/created/0xdeadbeef',
          },
          text: async () => 'Created',
        } as any
      }

      throw new Error(`Unexpected URL: ${url}`)
    }
  })

  afterEach(() => {
    global.fetch = originalFetch
    if (cleanupMocks) {
      cleanupMocks()
      cleanupMocks = null
    }
  })

  describe('selectRandomProvider static method', () => {
    it('should select a provider randomly when multiple providers are available', async () => {
      const testProviders: ProviderInfo[] = Object.values(RANDOM_TEST_PROVIDERS)

      // Run selection multiple times to test randomness
      const selections = new Set<string>()
      const attempts = 20

      for (let i = 0; i < attempts; i++) {
        const selected = await (StorageContext as any).selectRandomProvider(testProviders, mockSynapse.getSigner())
        selections.add(selected.serviceProvider)
      }

      // With 5 providers and 20 attempts, we should see some variety
      // This is probabilistic, but with proper randomness we should see at least 2 different providers
      assert.isAtLeast(selections.size, 2, 'Should select different providers across multiple attempts')

      // All selected providers should be from our test set
      for (const selected of selections) {
        assert.isTrue(
          testProviders.some((p) => p.serviceProvider === selected),
          `Selected provider ${selected} should be from test set`
        )
      }
    })

    it('should select the only provider when only one is available', async () => {
      const singleProvider = [RANDOM_TEST_PROVIDERS.provider1]

      const selected = await (StorageContext as any).selectRandomProvider(singleProvider, mockSynapse.getSigner())
      assert.equal(selected.serviceProvider, singleProvider[0].serviceProvider)
    })

    it('should fall back to Math.random when crypto is not available', async () => {
      const testProviders: ProviderInfo[] = [RANDOM_TEST_PROVIDERS.provider1, RANDOM_TEST_PROVIDERS.provider2]

      // Temporarily remove crypto
      const originalCrypto = globalThis.crypto
      delete (globalThis as any).crypto

      // Mock Math.random to return deterministic value
      const originalRandom = Math.random
      Math.random = () => 0.1 // This should select first provider

      try {
        const selected = await (StorageContext as any).selectRandomProvider(testProviders)
        assert.equal(selected.serviceProvider, testProviders[0].serviceProvider)
      } finally {
        globalThis.crypto = originalCrypto
        Math.random = originalRandom
      }
    })

    it('should use signer address for additional entropy when available', async () => {
      const testProviders: ProviderInfo[] = [RANDOM_TEST_PROVIDERS.provider1, RANDOM_TEST_PROVIDERS.provider2]

      // Remove crypto to force fallback path
      const originalCrypto = globalThis.crypto
      delete (globalThis as any).crypto

      try {
        // Test with signer (should use address for entropy)
        const signer = mockSynapse.getSigner()
        const selected1 = await (StorageContext as any).selectRandomProvider(testProviders, signer)
        assert.isTrue(testProviders.some((p) => p.serviceProvider === selected1.serviceProvider))

        // Test without signer (should still work)
        const selected2 = await (StorageContext as any).selectRandomProvider(testProviders)
        assert.isTrue(testProviders.some((p) => p.serviceProvider === selected2.serviceProvider))
      } finally {
        globalThis.crypto = originalCrypto
      }
    })

    it('should throw error when no providers are available', async () => {
      try {
        await (StorageContext as any).selectRandomProvider([])
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No providers available')
      }
    })

    it('should throw error when all providers fail ping validation', async () => {
      const testProviders: ProviderInfo[] = [RANDOM_TEST_PROVIDERS.provider1, RANDOM_TEST_PROVIDERS.provider2]

      // Mock fetch to make all pings fail
      global.fetch = async () => {
        return { status: 500, statusText: 'Internal Server Error' } as any
      }

      try {
        await (StorageContext as any).selectRandomProvider(testProviders)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'All 2 providers failed health check')
      }
    })
  })

  describe('Random selection for new data set creation', () => {
    it('should re-select provider randomly when creating new data set without specific provider', async () => {
      const testProviders: ProviderInfo[] = Object.values(RANDOM_TEST_PROVIDERS)

      // Set up registry mocks
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: testProviders,
        approvedIds: testProviders.map((p) => p.id),
      })

      // Create mock warm storage service with no existing data sets
      const mockWarmStorageService = createMockWarmStorageService(testProviders, [])

      // Track provider selection callbacks
      const selectedProviders: ProviderInfo[] = []
      let callbackCallCount = 0

      // Create multiple contexts without specifying providerId
      // This should trigger new data set creation each time
      for (let i = 0; i < 10; i++) {
        const context = await StorageContext.create(mockSynapse, mockWarmStorageService, {
          forceCreateDataSet: true, // Force new data set creation
          callbacks: {
            onProviderSelected: (provider) => {
              selectedProviders.push(provider)
              callbackCallCount++
            },
            onDataSetCreationStarted: () => {
              // Required callback - no-op for test
            },
            onDataSetResolved: () => {
              // Required callback - no-op for test
            },
          },
        })

        // Verify a provider was selected
        assert.isTrue(testProviders.some((p) => p.serviceProvider === context.serviceProvider))
      }

      // Should have called the callback for each context creation (smart selection + random re-selection)
      assert.equal(callbackCallCount, 20, 'Should have called onProviderSelected twice for each context')
      assert.equal(selectedProviders.length, 20, 'Should have recorded all selected providers')

      // Check that we got some variety in provider selection (probabilistic test)
      const uniqueProviders = new Set(selectedProviders.map((p) => p.serviceProvider))
      assert.isAtLeast(uniqueProviders.size, 2, 'Should have selected different providers across attempts')
    })

    it('should NOT re-select provider when specific providerId is given', async () => {
      const testProviders: ProviderInfo[] = Object.values(RANDOM_TEST_PROVIDERS)
      const specificProvider = RANDOM_TEST_PROVIDERS.provider3

      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: testProviders,
        approvedIds: testProviders.map((p) => p.id),
      })

      const mockWarmStorageService = createMockWarmStorageService(testProviders, [])

      // Track provider selection callbacks
      let providerCallbackCount = 0
      const selectedProviders: ProviderInfo[] = []

      const context = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerId: specificProvider.id, // Specify exact provider
        callbacks: {
          onProviderSelected: (provider) => {
            selectedProviders.push(provider)
            providerCallbackCount++
          },
          onDataSetCreationStarted: () => {
            // No-op for test
          },
          onDataSetResolved: () => {
            // No-op for test
          },
        },
      })

      // Should have used the specific provider, not random selection
      assert.equal(context.serviceProvider, specificProvider.serviceProvider)
      assert.equal(providerCallbackCount, 1, 'Should have called callback once')
      assert.equal(selectedProviders[0].id, specificProvider.id, 'Should have selected the specific provider')
    })

    it('should NOT re-select provider when specific providerAddress is given', async () => {
      const testProviders: ProviderInfo[] = Object.values(RANDOM_TEST_PROVIDERS)
      const specificProvider = RANDOM_TEST_PROVIDERS.provider4

      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: testProviders,
        approvedIds: testProviders.map((p) => p.id),
      })

      const mockWarmStorageService = createMockWarmStorageService(testProviders, [])

      let providerCallbackCount = 0
      const selectedProviders: ProviderInfo[] = []

      const context = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        providerAddress: specificProvider.serviceProvider, // Specify exact provider address
        callbacks: {
          onProviderSelected: (provider) => {
            selectedProviders.push(provider)
            providerCallbackCount++
          },
          onDataSetCreationStarted: () => {
            // No-op for test
          },
          onDataSetResolved: () => {
            // No-op for test
          },
        },
      })

      // Should have used the specific provider, not random selection
      assert.equal(context.serviceProvider, specificProvider.serviceProvider)
      assert.equal(providerCallbackCount, 1, 'Should have called callback once')
      assert.equal(selectedProviders[0].serviceProvider, specificProvider.serviceProvider)
    })
  })

  describe('Edge cases and error handling', () => {
    it('should handle empty provider list gracefully', async () => {
      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: [],
        approvedIds: [],
      })

      const mockWarmStorageService = createMockWarmStorageService([], [])

      try {
        await StorageContext.create(mockSynapse, mockWarmStorageService, {})
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved service providers available')
      }
    })

    it('should handle provider ping failures during random selection', async () => {
      const testProviders: ProviderInfo[] = [RANDOM_TEST_PROVIDERS.provider1, RANDOM_TEST_PROVIDERS.provider2]

      cleanupMocks = setupProviderRegistryMocks(mockEthProvider, {
        providers: testProviders,
        approvedIds: [1, 2],
      })

      // Make first provider fail ping, second succeed; handle PDP POSTs locally
      global.fetch = async (input: string | URL | Request, init?: any) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as any).url
        if (url.includes('/ping')) {
          if (url.includes('0x1111111111111111111111111111111111111111')) {
            return { status: 500, statusText: 'Internal Server Error', text: async () => 'Down' } as any
          }
          return { status: 200, statusText: 'OK', text: async () => 'OK' } as any
        }

        // Handle PDP createDataSet POST used during data set creation
        if (url.endsWith('/pdp/data-sets') && init?.method === 'POST') {
          return {
            status: 201,
            statusText: 'Created',
            headers: {
              get: (_name: string) => '/pdp/data-sets/created/0xdeadbeef',
            },
            text: async () => 'Created',
          } as any
        }

        throw new Error(`Unexpected URL: ${url}`)
      }

      const mockWarmStorageService = createMockWarmStorageService(testProviders, [])

      const context = await StorageContext.create(mockSynapse, mockWarmStorageService, {
        forceCreateDataSet: true,
        callbacks: {
          onProviderSelected: () => {
            // No-op for test
          },
          onDataSetCreationStarted: () => {
            // No-op for test
          },
          onDataSetResolved: () => {
            // No-op for test
          },
        },
      })

      // Should have selected the working provider (provider2)
      assert.equal(context.serviceProvider, RANDOM_TEST_PROVIDERS.provider2.serviceProvider)
    })
  })
})
