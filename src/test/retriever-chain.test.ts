/* globals describe it */
import { assert } from 'chai'
import { ChainRetriever } from '../retriever/chain.js'
import type { WarmStorageService } from '../warm-storage/index.js'
import type { PieceRetriever, ApprovedProviderInfo, EnhancedDataSetInfo, CommP, CommPv2 } from '../types.js'
import { asCommP } from '../commp/index.js'

// Create a mock CommP for testing
const mockCommP = asCommP('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq') as CommP

// Mock provider info
const mockProvider1: ApprovedProviderInfo = {
  serviceProvider: '0x1234567890123456789012345678901234567890',
  serviceURL: 'https://provider1.example.com',
  peerId: 'test-peer-id',
  registeredAt: 1000,
  approvedAt: 2000
}

const mockProvider2: ApprovedProviderInfo = {
  serviceProvider: '0x2345678901234567890123456789012345678901',
  serviceURL: 'https://provider2.example.com',
  peerId: 'test-peer-id',
  registeredAt: 1000,
  approvedAt: 2000
}

// Mock child retriever
const mockChildRetriever: PieceRetriever = {
  fetchPiece: async (
    commP: CommP | CommPv2,
    client: string,
    options?: { providerAddress?: string, signal?: AbortSignal }
  ): Promise<Response> => {
    return new Response('data from child', { status: 200 })
  }
}

// Mock data set
const mockDataSet: EnhancedDataSetInfo = {
  railId: 1,
  payer: '0xClient',
  payee: mockProvider1.serviceProvider,
  commissionBps: 100,
  metadata: '',
  pieceMetadata: [],
  clientDataSetId: 1,
  withCDN: false,
  pdpVerifierDataSetId: 123,
  nextPieceId: 1,
  currentPieceCount: 5,
  isLive: true,
  isManaged: true
}

describe('ChainRetriever', () => {
  describe('fetchPiece with specific provider', () => {
    it('should fetch from specific provider when providerAddress is given', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProviderIdByAddress: async (addr: string) => addr === mockProvider1.serviceProvider ? 1 : 0,
        getApprovedProvider: async (id: number) => {
          if (id === 1) return mockProvider1
          throw new Error('Provider not found')
        }
      }

      // Mock fetch to simulate provider responses
      const originalFetch = global.fetch
      let findPieceCalled = false
      let downloadCalled = false

      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url)
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
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)
        const response = await retriever.fetchPiece(
          mockCommP,
          '0xClient',
          { providerAddress: mockProvider1.serviceProvider }
        )

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
        getProviderIdByAddress: async () => 0 // Provider not found
      }
      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockChildRetriever)
      const response = await retriever.fetchPiece(mockCommP, '0xClient', {
        providerAddress: '0xNotApproved'
      })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when specific provider is not approved and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProviderIdByAddress: async () => 0 // Provider not found
      }
      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)

      try {
        await retriever.fetchPiece(mockCommP, '0xClient', { providerAddress: '0xNotApproved' })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(
          error.message,
          'Provider discovery failed and no additional retriever method was configured'
        )
      }
    })
  })

  describe('fetchPiece with multiple providers', () => {
    it('should wait for successful provider even if others fail first', async () => {
      // This tests that Promise.any() waits for success rather than settling with first failure
      const dataSets = [{
        isLive: true,
        currentPieceCount: 1,
        payee: '0xProvider1' // Fast failing provider
      }, {
        isLive: true,
        currentPieceCount: 1,
        payee: '0xProvider2' // Slower but successful provider
      }]

      const providers = [{
        serviceProvider: '0xProvider1',
        serviceURL: 'https://pdp1.example.com',
        peerId: 'test-peer-id',
        registeredAt: 0,
        approvedAt: 0
      }, {
        serviceProvider: '0xProvider2',
        serviceURL: 'https://pdp2.example.com',
        peerId: 'test-peer-id',
        registeredAt: 0,
        approvedAt: 0
      }]

      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => dataSets as any,
        getProviderIdByAddress: async (addr: string) => {
          if (addr === '0xProvider1') return 1
          if (addr === '0xProvider2') return 2
          return 0
        },
        getApprovedProvider: async (id: number) => {
          if (id === 1) return providers[0]
          if (id === 2) return providers[1]
          throw new Error('Provider not found')
        }
      }

      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)

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
          await new Promise(resolve => setTimeout(resolve, 50))

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
        const response = await retriever.fetchPiece(mockCommP, '0xClient')

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
          { ...mockDataSet, payee: mockProvider2.serviceProvider }
        ],
        getProviderIdByAddress: async (addr: string) => {
          if (addr === mockProvider1.serviceProvider) return 1
          if (addr === mockProvider2.serviceProvider) return 2
          return 0
        },
        getApprovedProvider: async (id: number) => {
          if (id === 1) return mockProvider1
          if (id === 2) return mockProvider2
          throw new Error('Provider not found')
        }
      }

      // Mock fetch to simulate provider responses
      const originalFetch = global.fetch
      const fetchCalls: string[] = []

      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url)
        fetchCalls.push(url)

        // Provider 1 is slow but successful
        if (url.includes('provider1')) {
          await new Promise(resolve => setTimeout(resolve, 50))
          if (url.includes('/pdp/piece?')) {
            return new Response('', { status: 200 })
          }
          if (url.includes('/piece/')) {
            return new Response('data from provider1', { status: 200 })
          }
        }

        // Provider 2 is fast and successful
        if (url.includes('provider2')) {
          if (url.includes('/pdp/piece?')) {
            return new Response('', { status: 200 })
          }
          if (url.includes('/piece/')) {
            return new Response('data from provider2', { status: 200 })
          }
        }

        throw new Error('Unexpected URL')
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)
        const response = await retriever.fetchPiece(mockCommP, '0xClient')

        assert.equal(response.status, 200)
        const data = await response.text()
        // Should get data from provider2 since it's faster
        assert.equal(data, 'data from provider2')

        // Verify both providers were attempted
        assert.isTrue(fetchCalls.some(url => url.includes('provider1')))
        assert.isTrue(fetchCalls.some(url => url.includes('provider2')))
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should fall back to child retriever when all providers fail', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProviderIdByAddress: async () => 1,
        getApprovedProvider: async () => mockProvider1
      }
      const originalFetch = global.fetch
      global.fetch = async () => new Response('error', { status: 500 }) // All fetches fail

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockChildRetriever)
        const response = await retriever.fetchPiece(mockCommP, '0xClient')
        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'data from child')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw when all providers fail and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [mockDataSet],
        getProviderIdByAddress: async () => 1,
        getApprovedProvider: async () => mockProvider1
      }
      const originalFetch = global.fetch
      global.fetch = async () => new Response('error', { status: 500 }) // All fetches fail

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)
        await retriever.fetchPiece(mockCommP, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(
          error.message,
          'All provider retrieval attempts failed and no additional retriever method was configured'
        )
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should fall back to child retriever when no active data sets found', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [] // No data sets
      }
      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService, mockChildRetriever)
      const response = await retriever.fetchPiece(mockCommP, '0xClient')
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when no active data sets found and no child retriever', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getClientDataSetsWithDetails: async () => [] // No data sets
      }
      const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)

      try {
        await retriever.fetchPiece(mockCommP, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(
          error.message,
          'Provider discovery failed and no additional retriever method was configured'
        )
      }
    })
  })

  describe('abort signal handling', () => {
    it('should propagate abort signal to fetch requests', async () => {
      const mockWarmStorage: Partial<WarmStorageService> = {
        getProviderIdByAddress: async () => 1,
        getApprovedProvider: async () => mockProvider1
      }

      const controller = new AbortController()
      const originalFetch = global.fetch
      let signalReceived = false

      global.fetch = async (input: string | URL | Request, init?: RequestInit) => {
        if ((init?.signal) != null) {
          signalReceived = true
          // Abort immediately
          controller.abort()
          throw new Error('AbortError')
        }
        throw new Error('No signal provided')
      }

      try {
        const retriever = new ChainRetriever(mockWarmStorage as WarmStorageService)
        await retriever.fetchPiece(
          mockCommP,
          '0xClient',
          {
            providerAddress: mockProvider1.serviceProvider,
            signal: controller.signal
          }
        )
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.isTrue(signalReceived, 'Signal should be propagated to fetch')
      } finally {
        global.fetch = originalFetch
      }
    })
  })
})
