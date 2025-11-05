import { asPieceCID } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { ChainRetriever } from '../retriever/chain.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { PieceCID, PieceRetriever } from '../types.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { ADDRESSES, JSONRPC, PROVIDERS, presets } from './mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry } from './mocks/jsonrpc/service-registry.ts'

// Mock server for testing
const server = setup([])

// Create a mock PieceCID for testing
const mockPieceCID = asPieceCID('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace') as PieceCID

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

describe('ChainRetriever', () => {
  let provider: ethers.Provider
  let warmStorage: WarmStorageService
  let spRegistry: SPRegistryService

  before(async () => {
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    // Set up basic JSON-RPC handler before creating services
    server.use(JSONRPC(presets.basic))
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    warmStorage = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
    spRegistry = await SPRegistryService.create(provider, ADDRESSES.calibration.spRegistry)
  })

  describe('fetchPiece with specific provider', () => {
    it('should fetch from specific provider when providerAddress is given', async () => {
      let findPieceCalled = false
      let downloadCalled = false

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
        }),
        http.get('https://provider1.example.com/pdp/piece', async ({ request }) => {
          findPieceCalled = true
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider1.example.com/piece/:pieceCid', async () => {
          downloadCalled = true
          return HttpResponse.text('test data', { status: 200 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1, {
        providerAddress: ADDRESSES.serviceProvider1,
      })

      assert.isTrue(findPieceCalled, 'Should call findPiece')
      assert.isTrue(downloadCalled, 'Should call download')
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'test data')
    })

    it('should fall back to child retriever when specific provider is not approved', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderByAddress: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: ADDRESSES.zero,
                  payee: ADDRESSES.zero,
                  name: '',
                  description: '',
                  isActive: false,
                },
              },
            ],
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1, {
        providerAddress: '0xNotApproved',
      })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when specific provider is not approved and no child retriever', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderByAddress: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: ADDRESSES.zero,
                  payee: ADDRESSES.zero,
                  name: '',
                  description: '',
                  isActive: false,
                },
              },
            ],
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)

      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1, {
          providerAddress: '0xNotApproved',
        })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Provider 0xNotApproved not found in registry')
      }
    })
  })

  describe('fetchPiece with multiple providers', () => {
    it('should wait for successful provider even if others fail first', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              if (dataSetId === 2n) {
                return [
                  {
                    pdpRailId: 2n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider2,
                    commissionBps: 100n,
                    clientDataSetId: 2n,
                    pdpEndEpoch: 0n,
                    providerId: 2n,
                    paymentEndEpoch: 0n,
                    dataSetId: 2n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        }),
        http.get('https://provider1.example.com/pdp/piece', async () => {
          return HttpResponse.json(null, { status: 404 })
        }),
        http.get('https://provider2.example.com/pdp/piece', async ({ request }) => {
          // Simulate network delay
          await new Promise((resolve) => setTimeout(resolve, 50))
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider2.example.com/piece/:pieceCid', async () => {
          return HttpResponse.text('success from provider 2', { status: 200 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)

      // Should get response from provider 2 even though provider 1 failed first
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'success from provider 2')
    })

    it('should race multiple providers and return first success', async () => {
      let provider1Called = false
      let provider2Called = false

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        http.get('https://provider1.example.com/pdp/piece', async ({ request }) => {
          provider1Called = true
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider1.example.com/piece/:pieceCid', async () => {
          // Simulate slower response from provider1
          await new Promise((resolve) => setTimeout(resolve, 100))
          return HttpResponse.text('data from provider1', { status: 200 })
        }),
        http.get('https://provider2.example.com/pdp/piece', async ({ request }) => {
          provider2Called = true
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider2.example.com/piece/:pieceCid', async () => {
          // Provider2 responds faster
          await new Promise((resolve) => setTimeout(resolve, 10))
          return HttpResponse.text('data from provider2', { status: 200 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)

      assert.isTrue(provider1Called || provider2Called, 'At least one provider should be called')
      assert.equal(response.status, 200)
      const text = await response.text()
      assert.include(['data from provider1', 'data from provider2'], text)
    })

    it('should fall back to child retriever when all providers fail', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        }),
        http.get('https://provider1.example.com/pdp/piece', async () => {
          return HttpResponse.json(null, { status: 404 })
        }),
        http.get('https://provider1.example.com/piece/:pieceCid', async () => {
          return HttpResponse.json(null, { status: 404 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when all providers fail and no child retriever', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        }),
        http.get('https://provider1.example.com/pdp/piece', async () => {
          return HttpResponse.json(null, { status: 404 })
        }),
        http.get('https://provider1.example.com/piece/:pieceCid', async () => {
          return HttpResponse.json(null, { status: 404 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)
      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'All provider retrieval attempts failed')
      }
    })

    it('should handle child retriever when no data sets exist', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[]],
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry, mockChildRetriever)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when no data sets and no child retriever', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[]],
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)

      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active data sets with data found')
      }
    })
  })

  describe('fetchPiece error handling', () => {
    it('should throw error when provider discovery fails', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => {
              throw new Error('Database connection failed')
            },
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)

      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Database connection failed')
      }
    })

    it('should handle provider with no PDP product', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.providerNoPDP]), // No PDP product
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)

      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Failed to retrieve piece')
      }
    })

    it('should handle mixed success and failure from multiple providers', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              if (dataSetId === 2n) {
                return [
                  {
                    pdpRailId: 2n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider2,
                    commissionBps: 100n,
                    clientDataSetId: 2n,
                    pdpEndEpoch: 0n,
                    providerId: 2n,
                    paymentEndEpoch: 0n,
                    dataSetId: 2n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        }),
        http.get('https://provider1.example.com/pdp/piece', async () => {
          return HttpResponse.json(null, { status: 500 })
        }),
        http.get('https://provider2.example.com/pdp/piece', async ({ request }) => {
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider2.example.com/piece/:pieceCid', async () => {
          return HttpResponse.text('success from provider2', { status: 200 })
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)
      const response = await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'success from provider2')
    })

    it('should handle providers with no valid data sets', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n || dataSetId === 2n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: dataSetId,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            dataSetLive: (args) => {
              const [dataSetId] = args
              return [dataSetId !== 1n] // Data set 1 not live
            },
            getDataSetListener: () => [ADDRESSES.calibration.warmStorage],
            getNextPieceId: (args) => {
              const [dataSetId] = args
              return [dataSetId === 2n ? 0n : 1n] // Data set 2 has no pieces
            },
          },
        })
      )

      const retriever = new ChainRetriever(warmStorage, spRegistry)

      try {
        await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active data sets with data found')
      }
    })
  })

  describe('AbortSignal support', () => {
    it('should pass AbortSignal to provider fetch', async () => {
      let signalPassed = false

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: ADDRESSES.client1,
                    payee: ADDRESSES.payee1,
                    serviceProvider: ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return presets.basic.warmStorageView.getDataSet(args)
            },
          },
        }),
        http.get('https://provider1.example.com/pdp/piece', async ({ request }) => {
          if (request.signal) {
            signalPassed = true
          }
          const url = new URL(request.url)
          const pieceCid = url.searchParams.get('pieceCid')
          return HttpResponse.json({ pieceCid })
        }),
        http.get('https://provider1.example.com/piece/:pieceCid', async ({ request }) => {
          if (request.signal) {
            signalPassed = true
          }
          return HttpResponse.text('test data', { status: 200 })
        })
      )

      const controller = new AbortController()
      const retriever = new ChainRetriever(warmStorage, spRegistry)
      await retriever.fetchPiece(mockPieceCID, ADDRESSES.client1, { signal: controller.signal })

      assert.isTrue(signalPassed, 'AbortSignal should be passed to fetch')
    })
  })
})
