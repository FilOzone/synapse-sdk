import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { asPieceCID } from '@filoz/synapse-core/piece'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createWalletClient, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { ChainRetriever } from '../retriever/chain.ts'
import { SPRegistryService } from '../sp-registry/index.ts'
import type { PieceCID, PieceRetriever } from '../types.ts'
import { WarmStorageService } from '../warm-storage/index.ts'

// Mock server for testing
const server = setup()

// Create a mock PieceCID for testing
const mockPieceCID = asPieceCID('bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace') as PieceCID

// Mock child retriever
const mockChildRetriever: PieceRetriever = {
  fetchPiece: async (_options): Promise<Response> => {
    return new Response('data from child', { status: 200 })
  },
}

describe('ChainRetriever', () => {
  let warmStorage: WarmStorageService
  let spRegistry: SPRegistryService

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    // Set up basic JSON-RPC handler before creating services
    server.use(Mocks.JSONRPC(Mocks.presets.basic))
    const client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    warmStorage = new WarmStorageService({ client })
    spRegistry = await SPRegistryService.create(client)
  })

  describe('fetchPiece with specific provider', () => {
    it('should fetch from specific provider when providerAddress is given', async () => {
      let findPieceCalled = false
      let downloadCalled = false

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
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

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      const response = await retriever.fetchPiece({
        pieceCid: mockPieceCID,
        client: Mocks.ADDRESSES.client1,
        providerAddress: Mocks.ADDRESSES.serviceProvider1,
      })

      assert.isTrue(findPieceCalled, 'Should call findPiece')
      assert.isTrue(downloadCalled, 'Should call download')
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'test data')
    })

    it('should fall back to child retriever when specific provider is not approved', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderByAddress: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: Mocks.ADDRESSES.zero,
                  payee: Mocks.ADDRESSES.zero,
                  name: '',
                  description: '',
                  isActive: false,
                },
              },
            ],
          },
        })
      )

      const retriever = new ChainRetriever({
        warmStorageService: warmStorage,
        spRegistry,
        childRetriever: mockChildRetriever,
      })
      const response = await retriever.fetchPiece({
        pieceCid: mockPieceCID,
        client: Mocks.ADDRESSES.client1,
        providerAddress: '0xNotApproved',
      })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when specific provider is not approved and no child retriever', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderByAddress: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: Mocks.ADDRESSES.zero,
                  payee: Mocks.ADDRESSES.zero,
                  name: '',
                  description: '',
                  isActive: false,
                },
              },
            ],
          },
        })
      )

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })

      try {
        await retriever.fetchPiece({
          pieceCid: mockPieceCID,
          client: Mocks.ADDRESSES.client1,
          providerAddress: Mocks.ADDRESSES.client1,
        })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, `Provider ${Mocks.ADDRESSES.client1} not found in registry`)
      }
    })
  })

  describe('fetchPiece with multiple providers', () => {
    it('should wait for successful provider even if others fail first', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
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
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider2,
                    commissionBps: 100n,
                    clientDataSetId: 2n,
                    pdpEndEpoch: 0n,
                    providerId: 2n,
                    paymentEndEpoch: 0n,
                    dataSetId: 2n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
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

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      const response = await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })

      // Should get response from provider 2 even though provider 1 failed first
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'success from provider 2')
    })

    it('should race multiple providers and return first success', async () => {
      let provider1Called = false
      let provider2Called = false

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
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

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      const response = await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })

      assert.isTrue(provider1Called || provider2Called, 'At least one provider should be called')
      assert.equal(response.status, 200)
      const text = await response.text()
      assert.include(['data from provider1', 'data from provider2'], text)
    })

    it('should fall back to child retriever when all providers fail', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
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

      const retriever = new ChainRetriever({
        warmStorageService: warmStorage,
        spRegistry,
        childRetriever: mockChildRetriever,
      })
      const response = await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when all providers fail and no child retriever', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
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

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      try {
        await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'All provider retrieval attempts failed')
      }
    })

    it('should handle child retriever when no data sets exist', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[]],
          },
        })
      )

      const retriever = new ChainRetriever({
        warmStorageService: warmStorage,
        spRegistry,
        childRetriever: mockChildRetriever,
      })
      const response = await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'data from child')
    })

    it('should throw when no data sets and no child retriever', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[]],
          },
        })
      )

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })

      try {
        await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'No active data sets with data found')
      }
    })
  })

  describe('fetchPiece error handling', () => {
    it('should throw error when provider discovery fails', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => {
              throw new Error('Database connection failed')
            },
          },
        })
      )

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })

      try {
        await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Database connection failed')
      }
    })

    it('should handle provider with no PDP product', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.providerNoPDP]), // No PDP product
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
            },
          },
        })
      )

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })

      try {
        await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Failed to retrieve piece')
      }
    })

    it('should handle mixed success and failure from multiple providers', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
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
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider2,
                    commissionBps: 100n,
                    clientDataSetId: 2n,
                    pdpEndEpoch: 0n,
                    providerId: 2n,
                    paymentEndEpoch: 0n,
                    dataSetId: 2n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
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

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      const response = await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })

      assert.equal(response.status, 200)
      assert.equal(await response.text(), 'success from provider2')
    })

    it('should handle providers with no valid data sets', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n || dataSetId === 2n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: dataSetId,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
            },
          },
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            dataSetLive: (args) => {
              const [dataSetId] = args
              return [dataSetId !== 1n] // Data set 1 not live
            },
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
            getActivePieceCount: (args) => {
              const [dataSetId] = args
              return [dataSetId === 2n ? 0n : 1n] // Data set 2 has no pieces
            },
          },
        })
      )

      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })

      try {
        await retriever.fetchPiece({ pieceCid: mockPieceCID, client: Mocks.ADDRESSES.client1 })
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
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    pdpRailId: 1n,
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    payer: Mocks.ADDRESSES.client1,
                    payee: Mocks.ADDRESSES.payee1,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                    commissionBps: 100n,
                    clientDataSetId: 1n,
                    pdpEndEpoch: 0n,
                    providerId: 1n,
                    paymentEndEpoch: 0n,
                    dataSetId: 1n,
                  },
                ]
              }
              return Mocks.presets.basic.warmStorageView.getDataSet(args)
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
      const retriever = new ChainRetriever({ warmStorageService: warmStorage, spRegistry })
      await retriever.fetchPiece({
        pieceCid: mockPieceCID,
        client: Mocks.ADDRESSES.client1,
        signal: controller.signal,
      })

      assert.isTrue(signalPassed, 'AbortSignal should be passed to fetch')
    })
  })
})
