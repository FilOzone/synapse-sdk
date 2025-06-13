/* globals describe it */
import { assert } from 'chai'
import { ChainRetriever } from '../retriever/chain.js'
import type { PandoraService } from '../pandora/index.js'
import type { ApprovedProviderInfo, EnhancedProofSetInfo, CommP } from '../types.js'
import { asCommP } from '../commp/index.js'

// Create a mock CommP for testing
const mockCommP = asCommP('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq') as CommP

// Mock provider info
const mockProvider1: ApprovedProviderInfo = {
  owner: '0x1234567890123456789012345678901234567890',
  pdpUrl: 'https://provider1.example.com',
  pieceRetrievalUrl: 'https://provider1.example.com/retrieve',
  registeredAt: 1000,
  approvedAt: 2000
}

const mockProvider2: ApprovedProviderInfo = {
  owner: '0x2345678901234567890123456789012345678901',
  pdpUrl: 'https://provider2.example.com',
  pieceRetrievalUrl: 'https://provider2.example.com/retrieve',
  registeredAt: 1000,
  approvedAt: 2000
}

// Mock proof set
const mockProofSet: EnhancedProofSetInfo = {
  railId: 1,
  payer: '0xClient',
  payee: mockProvider1.owner,
  commissionBps: 100,
  metadata: '',
  rootMetadata: [],
  clientDataSetId: 1,
  withCDN: false,
  pdpVerifierProofSetId: 123,
  nextRootId: 1,
  currentRootCount: 5,
  isLive: true,
  isManaged: true
}

describe('ChainRetriever', () => {
  describe('fetchPiece with specific provider', () => {
    it('should fetch from specific provider when providerAddress is given', async () => {
      const mockPandora: Partial<PandoraService> = {
        getProviderIdByAddress: async (addr: string) => addr === mockProvider1.owner ? 1 : 0,
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
        const retriever = new ChainRetriever(mockPandora as PandoraService)
        const response = await retriever.fetchPiece(
          mockCommP,
          '0xClient',
          { providerAddress: mockProvider1.owner }
        )

        assert.isTrue(findPieceCalled, 'Should call findPiece')
        assert.isTrue(downloadCalled, 'Should call download')
        assert.equal(response.status, 200)
        assert.equal(await response.text(), 'test data')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw when specific provider is not approved', async () => {
      const mockPandora: Partial<PandoraService> = {
        getProviderIdByAddress: async () => 0 // Provider not found
      }

      const retriever = new ChainRetriever(mockPandora as PandoraService)

      try {
        await retriever.fetchPiece(
          mockCommP,
          '0xClient',
          { providerAddress: '0xNotApproved' }
        )
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider 0xNotApproved not found or not approved')
      }
    })
  })

  describe('fetchPiece with multiple providers', () => {
    it('should wait for successful provider even if others fail first', async () => {
      // This tests that Promise.any() waits for success rather than settling with first failure
      const proofSets = [{
        isLive: true,
        currentRootCount: 1,
        payee: '0xProvider1' // Fast failing provider
      }, {
        isLive: true,
        currentRootCount: 1,
        payee: '0xProvider2' // Slower but successful provider
      }]

      const providers = [{
        owner: '0xProvider1',
        pdpUrl: 'https://pdp1.example.com',
        pieceRetrievalUrl: 'https://retrieve1.example.com',
        registeredAt: 0,
        approvedAt: 0
      }, {
        owner: '0xProvider2',
        pdpUrl: 'https://pdp2.example.com',
        pieceRetrievalUrl: 'https://retrieve2.example.com',
        registeredAt: 0,
        approvedAt: 0
      }]

      const mockPandora: Partial<PandoraService> = {
        getClientProofSetsWithDetails: async () => proofSets as any,
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

      const retriever = new ChainRetriever(mockPandora as PandoraService)

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
          return new Response(null, { status: 200 })
        }

        if (url.includes('retrieve2.example.com')) {
          return new Response('success from provider 2', { status: 200 })
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
      const mockPandora: Partial<PandoraService> = {
        getClientProofSetsWithDetails: async () => [
          mockProofSet,
          { ...mockProofSet, payee: mockProvider2.owner }
        ],
        getProviderIdByAddress: async (addr: string) => {
          if (addr === mockProvider1.owner) return 1
          if (addr === mockProvider2.owner) return 2
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
        const retriever = new ChainRetriever(mockPandora as PandoraService)
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

    it('should handle all providers failing', async () => {
      const mockPandora: Partial<PandoraService> = {
        getClientProofSetsWithDetails: async () => [mockProofSet],
        getProviderIdByAddress: async () => 1,
        getApprovedProvider: async () => mockProvider1
      }

      // Mock fetch to simulate failures
      const originalFetch = global.fetch
      global.fetch = async (input: string | URL | Request) => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.toString() : input.url)
        if (url.includes('/pdp/piece?')) {
          return new Response('', { status: 404 }) // Piece not found
        }
        throw new Error('Unexpected URL')
      }

      try {
        const retriever = new ChainRetriever(mockPandora as PandoraService)
        await retriever.fetchPiece(mockCommP, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'All providers failed to serve piece')
        assert.include(error.message, 'findPiece returned 404')
      } finally {
        global.fetch = originalFetch
      }
    })

    it('should throw when no active proof sets found', async () => {
      const mockPandora: Partial<PandoraService> = {
        getClientProofSetsWithDetails: async () => [] // No proof sets
      }

      const retriever = new ChainRetriever(mockPandora as PandoraService)

      try {
        await retriever.fetchPiece(mockCommP, '0xClient')
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active proof sets with data found')
      }
    })
  })

  describe('abort signal handling', () => {
    it('should propagate abort signal to fetch requests', async () => {
      const mockPandora: Partial<PandoraService> = {
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
        const retriever = new ChainRetriever(mockPandora as PandoraService)
        await retriever.fetchPiece(
          mockCommP,
          '0xClient',
          {
            providerAddress: mockProvider1.owner,
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
