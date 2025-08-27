/* globals describe it beforeEach afterEach */
import { assert } from 'chai'
import { asPieceCID } from '../piece/index.js'
import { SubgraphRetriever } from '../retriever/subgraph.js'
import { SubgraphService } from '../subgraph/index.js' // Import SubgraphService
import type { ApprovedProviderInfo, PieceCID, PieceRetriever, SubgraphConfig } from '../types.js'

const mockPieceCID = asPieceCID('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace') as PieceCID

const mockProvider: ApprovedProviderInfo = {
  serviceProvider: '0x1234567890123456789012345678901234567890',
  serviceURL: 'https://provider.example.com',
  peerId: 'test-peer-id',
  registeredAt: 1000,
  approvedAt: 2000,
}

const mockChildRetriever: PieceRetriever = {
  fetchPiece: async (
    pieceCid: PieceCID,
    client: string,
    options?: { providerAddress?: string; signal?: AbortSignal }
  ): Promise<Response> => {
    return new Response('data from child', { status: 200 })
  },
}

// Helper to create a mock SubgraphService
const createMockSubgraphService = (providersToReturn?: ApprovedProviderInfo[] | Error): SubgraphService => {
  // This creates a mock that satisfies the SubgraphService interface for testing purposes.
  // We cast to 'any' first to bypass checks for private/protected members.
  const mockService = {
    getApprovedProvidersForPieceCID: async (pieceCid: PieceCID): Promise<ApprovedProviderInfo[]> => {
      if (providersToReturn instanceof Error) {
        throw providersToReturn
      }
      return providersToReturn ?? []
    },
    getProviderByAddress: async (address: string): Promise<ApprovedProviderInfo | null> => {
      const providers = providersToReturn instanceof Error ? [] : (providersToReturn ?? [])
      return providers.find((p) => p.serviceProvider === address) ?? null
    },
  } as any

  return mockService as SubgraphService
}

describe('SubgraphRetriever', () => {
  describe('constructor', () => {
    // Note: The primary responsibility for config validation is now in SubgraphService.
    // These tests ensure SubgraphRetriever can be instantiated with a valid SubgraphService.
    it('should initialize with a SubgraphService (direct endpoint config for service)', () => {
      const config: SubgraphConfig = { endpoint: 'https://test.com/graphql' }
      const service = new SubgraphService(config)
      const retriever = new SubgraphRetriever(service)
      assert.isNotNull(retriever)
    })

    it('should initialize with a SubgraphService (Goldsky config for service)', () => {
      const config: SubgraphConfig = {
        goldsky: {
          projectId: 'test-project',
          subgraphName: 'test-subgraph',
          version: 'v1',
        },
      }
      const service = new SubgraphService(config)
      const retriever = new SubgraphRetriever(service)
      assert.isNotNull(retriever)
    })

    // The following tests are now effectively testing SubgraphService's constructor.
    // It's good to keep them to ensure the configurations are handled, but ideally,
    // SubgraphService would have its own dedicated test suite for these.
    it('SubgraphService should throw an error for incomplete Goldsky configuration', () => {
      assert.throws(() => {
        const config: SubgraphConfig = {
          goldsky: { projectId: 'test', subgraphName: '', version: '' },
        } // Provide other fields as empty to be more specific
        // eslint-disable-next-line no-new
        new SubgraphService(config)
      }, /Incomplete Goldsky config: projectId, subgraphName, and version required/)
    })

    it('SubgraphService should throw an error for empty configuration', () => {
      assert.throws(() => {
        const config: SubgraphConfig = {}
        // eslint-disable-next-line no-new
        new SubgraphService(config)
      }, /Invalid configuration: provide either endpoint or complete goldsky config/)
    })
  })

  describe('fetchPiece', () => {
    let originalFetch: typeof global.fetch

    beforeEach(() => {
      originalFetch = global.fetch
    })

    afterEach(() => {
      global.fetch = originalFetch
    })

    it('should fetch a piece from a provider found via SubgraphService', async () => {
      const mockService = createMockSubgraphService([mockProvider])
      global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockProvider.serviceURL)) {
          // Check if it's a piece retrieval
          if (url.includes('/piece/')) {
            return new Response('piece data', { status: 200 })
          }
          // Otherwise it's a findPiece call
          return new Response(null, { status: 200 })
        }
        throw new Error(`Unexpected fetch call to ${url}`)
      }

      const retriever = new SubgraphRetriever(mockService)
      const response = await retriever.fetchPiece(mockPieceCID, 'client1')

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'piece data')
    })

    it('should fall back to child retriever when SubgraphService returns no providers', async () => {
      const mockService = createMockSubgraphService([]) // Service returns no providers
      // No fetch mock needed if child is fully mocked and service returns no providers

      const retriever = new SubgraphRetriever(mockService, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, 'client1')

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should fall back to child retriever when fetching from subgraph providers (found by service) fails', async () => {
      const mockService = createMockSubgraphService([mockProvider]) // Service returns a provider
      global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        // Mock provider failure
        if (url.includes(mockProvider.serviceURL) || url.includes(mockProvider.serviceURL)) {
          return new Response('provider error', { status: 500 })
        }
        throw new Error(`Unexpected fetch call to ${url}`)
      }

      const retriever = new SubgraphRetriever(mockService, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, 'client1')

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should filter by providerAddress when provided (providers from service)', async () => {
      const otherProvider: ApprovedProviderInfo = {
        ...mockProvider,
        serviceProvider: '0xother',
      }
      const mockService = createMockSubgraphService([mockProvider, otherProvider]) // Service returns multiple providers
      let fetchCalledForMockProvider = false
      let fetchCalledForOtherProvider = false

      global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
        if (url.includes(mockProvider.serviceURL)) {
          fetchCalledForMockProvider = true
          return new Response('piece data', { status: 200 })
        }
        if (url.includes(otherProvider.serviceURL)) {
          fetchCalledForOtherProvider = true
          return new Response('other piece data', { status: 200 })
        }
        if (url.includes('/pdp')) {
          // Generic PDP success
          return new Response(null, { status: 200 })
        }
        throw new Error(`Unexpected fetch call to ${url}`)
      }

      const retriever = new SubgraphRetriever(mockService)
      await retriever.fetchPiece(mockPieceCID, 'client1', {
        providerAddress: mockProvider.serviceProvider,
      })

      assert.isTrue(fetchCalledForMockProvider, 'Should have fetched from the specified provider')
      assert.isFalse(fetchCalledForOtherProvider, 'Should NOT have fetched from the other provider')
    })

    it('should throw an error if all attempts fail (service provides provider, but fetch fails) and no child', async () => {
      const mockService = createMockSubgraphService([mockProvider]) // Service returns a provider
      global.fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
        // All provider fetches fail
        return new Response('error', { status: 500 })
      }

      const retriever = new SubgraphRetriever(mockService)
      try {
        await retriever.fetchPiece(mockPieceCID, 'client1')
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to retrieve piece')
      }
    })

    it('should throw an error if service returns no providers and no child retriever', async () => {
      const mockService = createMockSubgraphService([]) // Service returns no providers
      // No fetch mock needed as no providers will be tried

      const retriever = new SubgraphRetriever(mockService) // No child retriever
      try {
        await retriever.fetchPiece(mockPieceCID, 'client1')
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to retrieve piece')
        assert.include(error.message, 'No providers found and no additional retriever method was configured')
      }
    })

    it('should fall back if SubgraphService effectively returns empty (e.g. due to internal GraphQL error)', async () => {
      // SubgraphService is designed to return [] on its own errors.
      const mockService = createMockSubgraphService([])

      const retriever = new SubgraphRetriever(mockService, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, 'client1')

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })
  })
})
