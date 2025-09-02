/* globals describe it */
import { assert } from 'chai'
import { asPieceCID } from '../piece/index.js'
import { ChainRetriever } from '../retriever/chain.js'
import type { SPRegistryService } from '../sp-registry/index.js'
import type { EnhancedDataSetInfo, PieceCID, PieceRetriever, ProviderInfo } from '../types.js'
import type { WarmStorageService } from '../warm-storage/index.js'

// Create a mock PieceCID for testing
const mockPieceCID = asPieceCID('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace') as PieceCID

// Mock provider info
const mockProvider1: ProviderInfo = {
  id: 1,
  address: '0x1234567890123456789012345678901234567890',
  name: 'Provider 1',
  description: 'Test provider 1',
  active: true,
  products: {
    PDP: {
      type: 'PDP',
      isActive: true,
      capabilities: {},
      data: {
        serviceURL: 'https://provider1.example.com',
        minPieceSizeInBytes: BigInt(1024),
        maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
        ipniPiece: false,
        ipniIpfs: false,
        storagePricePerTibPerMonth: BigInt(1000000),
        minProvingPeriodInEpochs: 30,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      },
    },
  },
}

const mockProvider2: ProviderInfo = {
  id: 2,
  address: '0x2345678901234567890123456789012345678901',
  name: 'Provider 2',
  description: 'Test provider 2',
  active: true,
  products: {
    PDP: {
      type: 'PDP',
      isActive: true,
      capabilities: {},
      data: {
        serviceURL: 'https://provider2.example.com',
        minPieceSizeInBytes: BigInt(1024),
        maxPieceSizeInBytes: BigInt(32) * BigInt(1024) * BigInt(1024) * BigInt(1024),
        ipniPiece: false,
        ipniIpfs: false,
        storagePricePerTibPerMonth: BigInt(1000000),
        minProvingPeriodInEpochs: 30,
        location: 'us-east',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      },
    },
  },
}

// Mock child retriever
const mockChildRetriever: PieceRetriever = {
  fetchPiece: async (
    _pieceCid: PieceCID,
    _client: string,
    _options?: { providerAddress?: string; signal?: AbortSignal }
  ): Promise<Response> => {
    return new Response('data from child', { status: 200 })
  },
}

// Mock data set
const mockDataSet: EnhancedDataSetInfo = {
  pdpRailId: 1,
  cacheMissRailId: 0,
  cdnRailId: 0,
  payer: '0xClient',
  payee: mockProvider1.address,
  commissionBps: 100,
  clientDataSetId: 1,
  paymentEndEpoch: 0,
  providerId: 1,
  withCDN: false,
  pdpVerifierDataSetId: 123,
  nextPieceId: 1,
  currentPieceCount: 5,
  isLive: true,
  isManaged: true,
}

describe('ChainRetriever', () => {
  describe('fetchPiece with specific provider', () => {
    it('should fetch from specific provider when providerAddress is given', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProvider: () => null as any, // Mock provider method
        isProviderIdApproved: async (providerId: number) => providerId === 1, // Provider 1 is approved
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviderByAddress: async (addr: string) => {
          if (addr === mockProvider1.address) return mockProvider1
          return null
        },
        getProvider: async (id: number) => {
          if (id === 1) return mockProvider1
          return null
        },
      }

      // Mock fetch to simulate provider responses
      const originalFetch = global.fetch
      let findPieceCalled = false
      let downloadCalled = false

      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes('/pdp/piece?')) {
          findPieceCalled = true
          return new Response('', { status: 200 })
        }
        if (url.includes('/piece/')) {
          downloadCalled = true
          return new Response('test data', { status: 200 })
        }
        throw new Error('Unexpected URL')
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)
        const response = await retriever.fetchPiece(mockPieceCID, '0xClient', {
          providerAddress: mockProvider1.address,
        })

        assert.isTrue(findPieceCalled, 'Should call findPiece')
        assert.isTrue(downloadCalled, 'Should call download')
        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'test data')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should fall back to child retriever when specific provider is not approved', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProvider: () => null as any,
        isProviderIdApproved: async () => false, // No providers approved
      }
      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviderByAddress: async () => null, // Provider not found
      }
      const retriever = new ChainRetriever(
        mockWarmStorage as WarmStorageService,
        mockSPRegistry as SPRegistryService,
        mockChildRetriever
      )
      const response = await retriever.fetchPiece(mockPieceCID, '0xClient', {
        providerAddress: '0xNotApproved',
      })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when specific provider is not approved and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProvider: () => null as any,
        isProviderIdApproved: async () => false, // No providers approved
      }
      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviderByAddress: async () => null, // Provider not found
      }
      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      try {
        await retriever.fetchPiece(mockPieceCID, '0xClient', {
          providerAddress: '0xNotApproved',
        })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider 0xNotApproved not found or not approved')
      }
    })
  })

  describe('fetchPiece with multiple providers', () => {
    it('should wait for successful provider even if others fail first', async () => {
      // This tests that Promise.any() waits for success rather than settling with first failure
      const dataSets = [
        {
          pdpRailId: 1,
          cacheMissRailId: 0,
          cdnRailId: 0,
          payer: '0xClient',
          payee: '0xProvider1',
          commissionBps: 100,
          clientDataSetId: 1,
          paymentEndEpoch: 0,
          providerId: 1,
          isLive: true,
          currentPieceCount: 1,
        },
        {
          pdpRailId: 2,
          cacheMissRailId: 0,
          cdnRailId: 0,
          payer: '0xClient',
          payee: '0xProvider2',
          commissionBps: 100,
          clientDataSetId: 2,
          paymentEndEpoch: 0,
          providerId: 2,
          isLive: true,
          currentPieceCount: 1,
        },
      ]

      const providers: ProviderInfo[] = [
        {
          id: 1,
          address: '0xProvider1',
          name: 'Provider 1',
          description: 'Test provider',
          active: true,
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
                minProvingPeriodInEpochs: 30,
                location: 'us-east',
                paymentTokenAddress: '0x0000000000000000000000000000000000000000',
              },
            },
          },
        },
        {
          id: 2,
          address: '0xProvider2',
          name: 'Provider 2',
          description: 'Test provider',
          active: true,
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
                storagePricePerTibPerMonth: BigInt(1000000),
                minProvingPeriodInEpochs: 30,
                location: 'us-east',
                paymentTokenAddress: '0x0000000000000000000000000000000000000000',
              },
            },
          },
        },
      ]

      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => dataSets as any,
        getProvider: () => null as any,
        isProviderIdApproved: async (providerId: number) => providerId === 1 || providerId === 2, // Both providers approved
        getApprovedProviderIds: async () => [1, 2],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async (ids: number[]) => {
          return ids.map((id) => providers.find((p) => p.id === id)).filter((p) => p != null) as ProviderInfo[]
        },
      }

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      // Mock fetch
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        // Provider 1 fails immediately
        if (url.includes('pdp1.example.com')) {
          return new Response(null, { status: 404 })
        }

        // Provider 2 succeeds after a delay
        if (url.includes('pdp2.example.com')) {
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50))

          // Check if it's a piece retrieval
          if (url.includes('/piece/')) {
            return new Response('success from provider 2', { status: 200 })
          }

          // Otherwise it's a findPiece call
          return new Response(null, { status: 200 })
        }

        throw new Error(`Unexpected URL: ${url}`)
      }

      try {
        const response = await retriever.fetchPiece(mockPieceCID, '0xClient')

        // Should get response from provider 2 even though provider 1 failed first
        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'success from provider 2')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should race multiple providers and return first success', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [
          mockDataSet,
          { ...mockDataSet, providerId: 2, payee: mockProvider2.address },
        ],
        getProvider: () => null as any,
        isProviderIdApproved: async (providerId: number) => providerId === 1 || providerId === 2,
        getApprovedProviderIds: async () => [1, 2],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async (ids: number[]) => {
          return ids
            .map((id) => {
              if (id === 1) return mockProvider1
              if (id === 2) return mockProvider2
              return null
            })
            .filter((p) => p != null) as ProviderInfo[]
        },
      }

      // Mock fetch to simulate provider responses
      const originalFetch = global.fetch
      let provider1Called = false
      let provider2Called = false

      global.fetch = async (input: string | URL | Request, _init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        if (url.includes('provider1.example.com')) {
          provider1Called = true
          if (url.includes('/piece/')) {
            // Simulate slower response from provider1
            await new Promise((resolve) => setTimeout(resolve, 100))
            return new Response('data from provider1', { status: 200 })
          }
          return new Response('', { status: 200 })
        }

        if (url.includes('provider2.example.com')) {
          provider2Called = true
          if (url.includes('/piece/')) {
            // Provider2 responds faster
            await new Promise((resolve) => setTimeout(resolve, 10))
            return new Response('data from provider2', { status: 200 })
          }
          return new Response('', { status: 200 })
        }

        throw new Error('Unexpected URL')
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)
        const response = await retriever.fetchPiece(mockPieceCID, '0xClient')

        assert.isTrue(provider1Called || provider2Called, 'At least one provider should be called')
        assert.equal(response.status, 200)
        const text = await response.text()
        assert.include(['data from provider1', 'data from provider2'], text)
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should fall back to child retriever when all providers fail', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProvider: () => null as any,
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async () => [mockProvider1],
      }

      // Mock fetch to simulate provider failure
      const originalFetch = global.fetch
      global.fetch = async () => {
        return new Response('Not found', { status: 404 })
      }

      try {
        const retriever = new ChainRetriever(
          mockWarmStorage as WarmStorageService,
          mockSPRegistry as SPRegistryService,
          mockChildRetriever
        )
        const response = await retriever.fetchPiece(mockPieceCID, '0xClient')

        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'data from child')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw when all providers fail and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProvider: () => null as any,
        isProviderIdApproved: async () => true,
        getApprovedProviderIds: async () => [1],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async () => [mockProvider1],
      }

      // Mock fetch to simulate provider failure
      const originalFetch = global.fetch
      global.fetch = async () => {
        return new Response('Not found', { status: 404 })
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)
        await retriever.fetchPiece(mockPieceCID, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'All provider retrieval attempts failed')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle child retriever when no data sets exist', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [],
        getProvider: () => null as any,
      }

      const mockSPRegistry: Partial<SPRegistryService> = {}

      const retriever = new ChainRetriever(
        mockWarmStorage as WarmStorageService,
        mockSPRegistry as SPRegistryService,
        mockChildRetriever
      )
      const response = await retriever.fetchPiece(mockPieceCID, '0xClient')
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when no data sets and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [],
        getProvider: () => null as any,
      }

      const mockSPRegistry: Partial<SPRegistryService> = {}

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      try {
        await retriever.fetchPiece(mockPieceCID, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active data sets with data found')
      }
    })
  })

  describe('fetchPiece error handling', () => {
    it('should throw error when provider discovery fails', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => {
          throw new Error('Database connection failed')
        },
        getProvider: () => null as any,
      }

      const mockSPRegistry: Partial<SPRegistryService> = {}

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      try {
        await retriever.fetchPiece(mockPieceCID, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Database connection failed')
      }
    })

    it('should handle provider with no PDP product', async () => {
      const providerNoPDP: ProviderInfo = {
        ...mockProvider1,
        products: {}, // No products
      }

      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProvider: () => null as any,
        isProviderIdApproved: async () => true,
        getApprovedProviderIds: async () => [1],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async () => [providerNoPDP],
      }

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      try {
        await retriever.fetchPiece(mockPieceCID, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'All provider retrieval attempts failed')
      }
    })

    it('should handle mixed success and failure from multiple providers', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [
          mockDataSet,
          { ...mockDataSet, providerId: 2, payee: mockProvider2.address },
        ],
        getProvider: () => null as any,
        isProviderIdApproved: async (providerId: number) => providerId === 1 || providerId === 2,
        getApprovedProviderIds: async () => [1, 2],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async () => [mockProvider1, mockProvider2],
      }

      // Mock fetch to simulate mixed responses
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

        if (url.includes('provider1.example.com')) {
          // Provider1 fails
          return new Response('Server error', { status: 500 })
        }

        if (url.includes('provider2.example.com')) {
          // Provider2 succeeds
          if (url.includes('/piece/')) {
            return new Response('success from provider2', { status: 200 })
          }
          return new Response('', { status: 200 })
        }

        throw new Error('Unexpected URL')
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)
        const response = await retriever.fetchPiece(mockPieceCID, '0xClient')

        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'success from provider2')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should handle providers with no valid data sets', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [
          { ...mockDataSet, isLive: false }, // Not live
          { ...mockDataSet, currentPieceCount: 0 }, // No pieces
        ],
        getProvider: () => null as any,
      }

      const mockSPRegistry: Partial<SPRegistryService> = {}

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)

      try {
        await retriever.fetchPiece(mockPieceCID, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active data sets with data found')
      }
    })
  })

  describe('AbortSignal support', () => {
    it('should pass AbortSignal to provider fetch', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProvider: () => null as any,
        isProviderIdApproved: async () => true,
        getApprovedProviderIds: async () => [1],
        getViewContractAddress: () => '0xViewContract',
      }

      const mockSPRegistry: Partial<SPRegistryService> = {
        getProviders: async () => [mockProvider1],
      }

      // Mock fetch to check for AbortSignal
      const originalFetch = global.fetch
      let signalPassed = false

      global.fetch = async (_input: string | URL | Request, init?: RequestInit) => {
        if (init?.signal) {
          signalPassed = true
        }
        return new Response('test data', { status: 200 })
      }

      try {
        const controller = new AbortController()
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockSPRegistry as SPRegistryService)
        await retriever.fetchPiece(mockPieceCID, '0xClient', { signal: controller.signal })

        assert.isTrue(signalPassed, 'AbortSignal should be passed to fetch')
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
