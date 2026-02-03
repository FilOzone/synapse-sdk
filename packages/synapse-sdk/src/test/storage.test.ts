import { type Chain, calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import * as Piece from '@filoz/synapse-core/piece'
import { calculate, calculate as calculatePieceCID } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { CID } from 'multiformats/cid'
import {
  type Account,
  bytesToHex,
  type Client,
  createWalletClient,
  numberToHex,
  type Transport,
  http as viemHttp,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { StorageContext } from '../storage/context.ts'
import { Synapse } from '../synapse.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'

// MSW server for JSONRPC mocking
const server = setup()

const pdpOptions = {
  baseUrl: 'https://pdp.example.com',
}

describe('StorageService', () => {
  let client: Client<Transport, Chain, Account>
  // MSW lifecycle hooks
  before(async () => {
    // Set timeout to 100ms for testing
    SP.setTimeout(100)
    // Set delay time to 10ms for polling tests
    SP.setDelayTime(10)
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
  })

  describe('create() factory method', () => {
    it('should select a random provider when no providerId specified', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Should have selected one of the providers
      assert.isTrue(
        service.serviceProvider === Mocks.PROVIDERS.provider1.providerInfo.serviceProvider ||
          service.serviceProvider === Mocks.PROVIDERS.provider2.providerInfo.serviceProvider
      )
    })

    it('should use specific provider when providerId specified', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      // Create storage service with specific providerIds
      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: Mocks.PROVIDERS.provider1.providerId,
      })

      assert.equal(service.serviceProvider, Mocks.PROVIDERS.provider1.providerInfo.serviceProvider)
    })

    it('should reuse existing data set with providerIds', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        providerId: Mocks.PROVIDERS.provider1.providerId,
      })
      // Should have reused existing data set (not created new one)
      assert.equal(context.serviceProvider, Mocks.PROVIDERS.provider1.providerInfo.serviceProvider)
      assert.equal(context.dataSetId, 1n, 'Should have a data set id')
    })

    it('should throw when no approved providers available', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getApprovedProviders() {
              return [[]]
            },
          },
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      try {
        await StorageContext.create(synapse, warmStorageService)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved service providers available')
      }
    })

    it('should throw when specified provider not found', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          providerId: 999n,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 999 not found in registry')
      }
    })

    it('should select existing data set when available', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: Mocks.PROVIDERS.provider1.providerId,
      })

      // Should use existing data set
      assert.equal(service.dataSetId, 1n)
    })

    it('should prefer data sets with existing pieces', async () => {
      const expectedDataSetBase = {
        cacheMissRailId: 0n,
        cdnRailId: 0n,
        clientDataSetId: 0n,
        commissionBps: 100n,
        dataSetId: 1n,
        payee: Mocks.ADDRESSES.serviceProvider1,
        payer: Mocks.ADDRESSES.client1,
        pdpEndEpoch: 0n,
        pdpRailId: 1n,
        providerId: 1n,
        serviceProvider: Mocks.ADDRESSES.serviceProvider1,
      }
      const expectedDataSets = [
        {
          ...expectedDataSetBase,
          dataSetId: 1n,
          pdpRailId: 1n,
        },
        {
          ...expectedDataSetBase,
          dataSetId: 2n,
          pdpRailId: 2n,
        },
      ]
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieceCount: (args) => {
              const [dataSetId] = args
              if (dataSetId === 2n) {
                return [2n]
              } else {
                return [0n]
              }
            },
          },
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getClientDataSets: () => [expectedDataSets],
            getAllDataSetMetadata: () => [[], []],
            getDataSet: (args) => {
              const [dataSetId] = args
              return [expectedDataSets.find((ds) => ds.dataSetId === dataSetId) ?? ({} as (typeof expectedDataSets)[0])]
            },
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: 1n,
      })

      // Should select the data set with pieces
      assert.equal(service.dataSetId, 2n)
    })

    it('should handle provider selection callbacks', async () => {
      let providerCallbackFired = false
      let dataSetCallbackFired = false
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      await StorageContext.create(synapse, warmStorageService, {
        providerId: Mocks.PROVIDERS.provider1.providerId,
        callbacks: {
          onProviderSelected: (provider) => {
            assert.equal(provider.serviceProvider, Mocks.PROVIDERS.provider1.providerInfo.serviceProvider)
            providerCallbackFired = true
          },
          onDataSetResolved: (info) => {
            assert.isTrue(info.isExisting)
            assert.equal(info.dataSetId, 1n)
            dataSetCallbackFired = true
          },
        },
      })

      assert.isTrue(providerCallbackFired, 'onProviderSelected should have been called')
      assert.isTrue(dataSetCallbackFired, 'onDataSetResolved should have been called')
    })

    it('should select by explicit dataSetId', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getAllDataSetMetadata: () => [[], []],
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    clientDataSetId: 0n,
                    commissionBps: 100n,
                    dataSetId: 1n,
                    payee: Mocks.ADDRESSES.serviceProvider1,
                    payer: Mocks.ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 1n,
                    providerId: 1n,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  },
                ]
              } else {
                return [
                  {
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    clientDataSetId: 0n,
                    commissionBps: 100n,
                    dataSetId: 2n,
                    payee: Mocks.ADDRESSES.serviceProvider1,
                    payer: Mocks.ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 2n,
                    providerId: 1n,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  },
                ]
              }
            },
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 2n,
      })
      assert.equal(service.dataSetId, 2n)
      assert.equal(service.serviceProvider, Mocks.PROVIDERS.provider1.providerInfo.serviceProvider)
    })

    it('should select by providerIds', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: Mocks.PROVIDERS.provider2.providerId,
      })

      assert.equal(service.serviceProvider, Mocks.PROVIDERS.provider2.providerInfo.serviceProvider)
    })

    it('should throw when dataSetId not found', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 999n,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 does not exist')
      }
    })

    it('should throw when provider not found in registry', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          providerId: 999n,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'not found in registry')
      }
    })

    it('should filter by CDN setting in smart selection', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n, 2n]],
            getAllDataSetMetadata: (args) => {
              const [dataSetId] = args
              if (dataSetId === 2n) {
                return [
                  ['withCDN'], // keys
                  [''], // values
                ]
              }
              return [[], []] // empty metadata for other data sets
            },
            getDataSet: (args) => {
              const [dataSetId] = args
              if (dataSetId === 1n) {
                return [
                  {
                    cacheMissRailId: 0n,
                    cdnRailId: 0n,
                    clientDataSetId: 0n,
                    commissionBps: 100n,
                    dataSetId: 1n,
                    payee: Mocks.ADDRESSES.serviceProvider1,
                    payer: Mocks.ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 1n,
                    providerId: 1n,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  },
                ]
              } else {
                return [
                  {
                    cacheMissRailId: 0n,
                    cdnRailId: 1n,
                    clientDataSetId: 0n,
                    commissionBps: 100n,
                    dataSetId: 2n,
                    payee: Mocks.ADDRESSES.serviceProvider1,
                    payer: Mocks.ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 2n,
                    providerId: 1n,
                    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  },
                ]
              }
            },
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      // Test with CDN = false
      const serviceNoCDN = await StorageContext.create(synapse, warmStorageService, {
        withCDN: false,
      })
      assert.equal(serviceNoCDN.dataSetId, 1n, 'Should select non-CDN data set')

      // Test with CDN = true
      const serviceWithCDN = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })
      assert.equal(serviceWithCDN.dataSetId, 2n, 'Should select CDN data set')
    })

    it('should throw when data set belongs to non-approved provider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getAllDataSetMetadata: () => [[], []],
            getDataSet: () => {
              return [
                {
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  clientDataSetId: 0n,
                  commissionBps: 100n,
                  dataSetId: 1n,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  payer: Mocks.ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 3n,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1n,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        // Provider 999 is not in the registry, so we'll get a "not found in registry" error
        assert.include(error.message, 'not found in registry')
      }
    })

    it('should handle data set not live', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            dataSetLive: () => [false],
            getDataSetListener: () => [Mocks.ADDRESSES.calibration.warmStorage],
          },
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getAllDataSetMetadata: () => [[], []],
            getDataSet: () => {
              return [
                {
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  clientDataSetId: 0n,
                  commissionBps: 100n,
                  dataSetId: 1n,
                  payee: Mocks.ADDRESSES.serviceProvider1,
                  payer: Mocks.ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1n,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 1 does not exist or is not live')
      }
    })

    it('should match providers by ID even when payee differs from serviceProvider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          warmStorageView: {
            ...Mocks.presets.basic.warmStorageView,
            clientDataSets: () => [[1n]],
            getAllDataSetMetadata: () => [[], []],
            getDataSet: () => {
              return [
                {
                  cacheMissRailId: 0n,
                  cdnRailId: 0n,
                  clientDataSetId: 0n,
                  commissionBps: 100n,
                  dataSetId: 1n,
                  payee: Mocks.ADDRESSES.serviceProvider2,
                  payer: Mocks.ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)

      const service = await StorageContext.create(synapse, warmStorageService, {})

      // Should successfully match by provider ID despite different payee
      assert.equal(service.dataSetId, 1n)
      assert.equal(service.provider.id, 1n)
      assert.equal(service.provider.serviceProvider, Mocks.ADDRESSES.serviceProvider1)
    })
  })

  describe('preflightUpload', () => {
    it('should calculate costs without CDN', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          payments: {
            ...Mocks.presets.basic.payments,
            operatorApprovals: () => [true, 2207579500n, 220757940000000n, 220757n, 220757n, 86400n],
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: false,
      })

      const preflight = await service.preflightUpload(Number(SIZE_CONSTANTS.MiB)) // 1 MiB

      assert.equal(preflight.estimatedCost.perEpoch, 22075794n)
      assert.equal(preflight.estimatedCost.perDay, 63578286720n)
      assert.equal(preflight.estimatedCost.perMonth, 1907348601600n)
      assert.isTrue(preflight.allowanceCheck.sufficient)
    })

    it('should calculate costs with CDN', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          payments: {
            ...Mocks.presets.basic.payments,
            operatorApprovals: () => [true, 2207579500n, 220757940000000n, 220757n, 220757n, 86400n],
          },
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      const preflight = await service.preflightUpload(Number(SIZE_CONSTANTS.MiB)) // 1 MiB

      // Should use CDN costs
      assert.equal(preflight.estimatedCost.perEpoch, 22075794n)
      assert.equal(preflight.estimatedCost.perDay, 63578286720n)
      assert.equal(preflight.estimatedCost.perMonth, 1907348601600n)
      assert.isTrue(preflight.allowanceCheck.sufficient)
    })

    it('should handle insufficient allowances', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      const preflight = await service.preflightUpload(Number(100n * SIZE_CONSTANTS.MiB)) // 100 MiB

      assert.isFalse(preflight.allowanceCheck.sufficient)
      assert.include(preflight.allowanceCheck.message, 'Insufficient rate and lockup allowances')
    })

    it('should enforce minimum size limit in preflightUpload', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      try {
        await service.preflightUpload(126) // 126 bytes (1 under minimum)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'below minimum allowed size')
        assert.include(error.message, '126 bytes')
        assert.include(error.message, '127 bytes')
      }
    })

    it('should enforce maximum size limit in preflightUpload', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      try {
        // 1 GiB + 1 byte exceeds the 1 GiB limit
        await service.preflightUpload(SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, String(SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1))
        assert.include(error.message, String(SIZE_CONSTANTS.MAX_UPLOAD_SIZE))
      }
    })
  })

  describe('download', () => {
    it('should download and verify a piece', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      const testPieceCID = calculate(testData).toString()
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.get(`https://${Mocks.ADDRESSES.client1}.calibration.filbeam.io/:cid`, async () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        }),
        Mocks.pdp.findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      const downloaded = await service.download(testPieceCID)
      assert.deepEqual(downloaded, testData)
    })

    it('should handle download errors', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      const testPieceCID = calculate(testData).toString()

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.download(testPieceCID)
        assert.fail('Should have thrown')
      } catch (error: any) {
        assert.include(error.message, 'Failed to retrieve piece')
      }
    })

    it('should accept empty download options', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      const testPieceCID = calculate(testData).toString()

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Test with and without empty options object
      const downloaded1 = await service.download(testPieceCID)
      assert.deepEqual(downloaded1, testData)

      const downloaded2 = await service.download(testPieceCID, {})
      assert.deepEqual(downloaded2, testData)
    })
  })

  describe('upload', () => {
    it('should handle errors in batch processing gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.post<Record<string, never>, { pieceCid: string }>('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.error()
        }),
        http.post<Record<string, never>, { pieceCid: string }>(
          'https://pdp.example.com/pdp/piece/uploads',
          async () => {
            return HttpResponse.error()
          }
        )
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Create 3 uploads
      const uploads = [
        service.upload(new Uint8Array(127).fill(1)),
        service.upload(new Uint8Array(128).fill(2)),
        service.upload(new Uint8Array(129).fill(3)),
      ]

      // All uploads should fail with store errors
      const results = await Promise.allSettled(uploads)

      // All uploads fail independently
      assert.equal(results[0].status, 'rejected')
      assert.equal(results[1].status, 'rejected')
      assert.equal(results[2].status, 'rejected')

      if (results[0].status === 'rejected') {
        assert.include(results[0].reason.message, 'Failed to store piece on service provider')
      }
      if (results[1].status === 'rejected') {
        assert.include(results[1].reason.message, 'Failed to store piece on service provider')
      }
      if (results[2].status === 'rejected') {
        assert.include(results[2].reason.message, 'Failed to store piece on service provider')
      }
    })

    it('should enforce 1 GiB size limit', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Create minimal data but mock length to simulate oversized data
      // This tests validation without allocating 1+ GiB
      const smallData = new Uint8Array(127)
      const testSize = SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1
      Object.defineProperty(smallData, 'length', { value: testSize })

      try {
        await service.upload(smallData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, String(testSize))
        assert.include(error.message, String(SIZE_CONSTANTS.MAX_UPLOAD_SIZE))
      }
    })

    it('should handle upload piece failure', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = Piece.calculate(testData).toString()
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.postPieceHandler(testPieceCID, mockUuid, pdpOptions),
        http.put('https://pdp.example.com/pdp/piece/upload/:uuid', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.upload(testData)
        assert.fail('Should have thrown upload error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to store piece on service provider')
      }
    })

    it('should handle add pieces failure', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = Piece.calculate(testData).toString()
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.postPieceUploadsHandler(mockUuid, pdpOptions),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, pdpOptions),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, undefined, pdpOptions),
        Mocks.pdp.findPieceHandler(testPieceCID, true, pdpOptions),
        http.post('https://pdp.example.com/pdp/data-sets/:id/pieces', () => {
          return HttpResponse.error()
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      try {
        await service.upload(testData)
        assert.fail('Should have thrown add pieces error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to commit pieces on-chain')
      }
    })
  })

  describe('store() split operation', () => {
    it('should store data and return pieceCid and size', async () => {
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.postPieceUploadsHandler(mockUuid, pdpOptions),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, pdpOptions),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), pdpOptions),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, pdpOptions)
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      const result = await service.store(testData)

      assert.equal(result.pieceCid.toString(), expectedPieceCid.toString())
      assert.equal(result.size, 127)
    })

    it('should throw when SP upload fails', async () => {
      const testData = new Uint8Array(127).fill(42)

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.post('https://pdp.example.com/pdp/piece/uploads', () => {
          return HttpResponse.error()
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.store(testData)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'StorageContext store failed')
        assert.include(error.message, 'Failed to store piece on service provider')
      }
    })

    it('should throw when piece parking confirmation fails', async () => {
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.postPieceUploadsHandler(mockUuid, pdpOptions),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, pdpOptions),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), pdpOptions),
        // findPiece returns not found - piece parking failed
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), false, pdpOptions)
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.store(testData)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'StorageContext store failed')
        assert.include(error.message, 'Failed to confirm piece storage')
      }
    })

    it('should validate size limit', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      const smallData = new Uint8Array(127)
      const testSize = SIZE_CONSTANTS.MAX_UPLOAD_SIZE + 1
      Object.defineProperty(smallData, 'length', { value: testSize })

      try {
        await service.store(smallData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
      }
    })
  })

  describe('commit() split operation', () => {
    const FAKE_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    // Use data set ID 1 which is set up in Mocks.presets.basic
    const DATA_SET_ID = 1

    it('should commit to existing data set and return isNewDataSet=false', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.post(`https://pdp.example.com/pdp/data-sets/${DATA_SET_ID}/pieces`, () => {
          return new HttpResponse(null, {
            status: 201,
            headers: { Location: `/pdp/data-sets/${DATA_SET_ID}/pieces/added/${FAKE_TX_HASH}` },
          })
        }),
        Mocks.pdp.pieceAdditionStatusHandler(
          DATA_SET_ID,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: DATA_SET_ID,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [101],
          },
          pdpOptions
        )
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      const result = await service.commit({
        pieces: [{ pieceCid: testPieceCid }],
      })

      assert.equal(result.txHash, FAKE_TX_HASH)
      assert.deepEqual(result.pieceIds, [101n])
      assert.equal(result.dataSetId, BigInt(DATA_SET_ID))
      assert.equal(result.isNewDataSet, false)
    })

    it('should create new data set and return isNewDataSet=true', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))
      const NEW_DATA_SET_ID = 456

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, pdpOptions),
        Mocks.pdp.dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            createMessageHash: FAKE_TX_HASH,
            dataSetCreated: true,
            service: 'test-service',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: NEW_DATA_SET_ID,
          },
          pdpOptions
        ),
        Mocks.pdp.pieceAdditionStatusHandler(
          NEW_DATA_SET_ID,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: NEW_DATA_SET_ID,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [201],
          },
          pdpOptions
        )
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      // No dataSetIds - will create new
      const service = await StorageContext.create(synapse, warmStorageService)

      const result = await service.commit({
        pieces: [{ pieceCid: testPieceCid }],
      })

      assert.equal(result.txHash, FAKE_TX_HASH)
      assert.deepEqual(result.pieceIds, [201n])
      assert.equal(result.dataSetId, BigInt(NEW_DATA_SET_ID))
      assert.equal(result.isNewDataSet, true)
    })

    it('should throw when addPieces fails', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.post(`https://pdp.example.com/pdp/data-sets/${DATA_SET_ID}/pieces`, () => {
          return HttpResponse.json({ error: 'Transaction failed' }, { status: 500 })
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      try {
        await service.commit({
          pieces: [{ pieceCid: testPieceCid }],
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'StorageContext commit failed')
        assert.include(error.message, 'Failed to commit pieces on-chain')
      }
    })

    it('should throw when createAndAddPieces fails', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.post('https://pdp.example.com/pdp/data-sets', () => {
          return HttpResponse.json({ error: 'Transaction failed' }, { status: 500 })
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.commit({
          pieces: [{ pieceCid: testPieceCid }],
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'StorageContext commit failed')
        assert.include(error.message, 'Failed to commit pieces on-chain')
      }
    })
  })

  describe('pull() split operation', () => {
    // Use data set ID 1 which is set up in Mocks.presets.basic
    const DATA_SET_ID = 1

    it('should pull pieces successfully and return complete status', async () => {
      const testPieceCid1 = calculatePieceCID(new Uint8Array(127).fill(42))
      const testPieceCid2 = calculatePieceCID(new Uint8Array(127).fill(43))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.pullPiecesHandler(
          Mocks.pdp.createPullResponse('complete', [
            { pieceCid: testPieceCid1.toString(), status: 'complete' },
            { pieceCid: testPieceCid2.toString(), status: 'complete' },
          ]),
          pdpOptions
        )
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      const result = await service.pull({
        pieces: [testPieceCid1, testPieceCid2],
        from: 'https://primary.example.com',
      })

      assert.equal(result.status, 'complete')
      assert.lengthOf(result.pieces, 2)
      assert.equal(result.pieces[0].status, 'complete')
      assert.equal(result.pieces[1].status, 'complete')
    })

    it('should return failed status when some pieces fail', async () => {
      const testPieceCid1 = calculatePieceCID(new Uint8Array(127).fill(42))
      const testPieceCid2 = calculatePieceCID(new Uint8Array(127).fill(43))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.pullPiecesHandler(
          Mocks.pdp.createPullResponse('failed', [
            { pieceCid: testPieceCid1.toString(), status: 'complete' },
            { pieceCid: testPieceCid2.toString(), status: 'failed' },
          ]),
          pdpOptions
        )
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      const result = await service.pull({
        pieces: [testPieceCid1, testPieceCid2],
        from: 'https://primary.example.com',
      })

      assert.equal(result.status, 'failed')
      assert.lengthOf(result.pieces, 2)
      assert.equal(result.pieces[0].status, 'complete')
      assert.equal(result.pieces[1].status, 'failed')
    })

    it('should throw when pull endpoint fails', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        Mocks.pdp.pullPiecesErrorHandler('Network error', 500, pdpOptions)
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      try {
        await service.pull({
          pieces: [testPieceCid],
          from: 'https://primary.example.com',
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'StorageContext pull failed')
        assert.include(error.message, 'Failed to pull pieces from source provider')
      }
    })

    it('should complete pull after polling through pending status', async () => {
      const testPieceCid = calculatePieceCID(new Uint8Array(127).fill(42))

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        // Simulate 1 pending poll before completing
        Mocks.pdp.pullPiecesPollingHandler(
          1,
          Mocks.pdp.createPullResponse('complete', [{ pieceCid: testPieceCid.toString(), status: 'complete' }]),
          pdpOptions
        )
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: BigInt(DATA_SET_ID),
      })

      const result = await service.pull({
        pieces: [testPieceCid],
        from: 'https://primary.example.com',
      })

      assert.equal(result.status, 'complete')
      assert.lengthOf(result.pieces, 1)
      assert.equal(result.pieces[0].status, 'complete')
    })
  })

  describe('multi-copy upload orchestration', () => {
    const FAKE_TX_HASH = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef' as const
    const DATA_SET_ID = 1

    it('should throw StoreError when primary store fails', async () => {
      // StoreError is only thrown in multi-copy path (count >= 2)
      // Use explicit contexts to ensure provider1 is primary
      const testData = new Uint8Array(127).fill(42)
      const provider1Options = { baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL }
      const provider2Options = { baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL }

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        // Both providers respond to ping
        Mocks.PING(provider1Options),
        Mocks.PING(provider2Options),
        // Primary store fails
        http.post(`${provider1Options.baseUrl}/pdp/piece/uploads`, () => {
          return HttpResponse.error()
        })
      )

      const synapse = new Synapse({ client })

      // Create contexts explicitly to ensure provider1 is primary
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })

      try {
        // Explicit contexts with 2 providers triggers multi-copy path
        await synapse.storage.upload(testData, { contexts })
        assert.fail('Should have thrown StoreError')
      } catch (error: any) {
        assert.include(error.name, 'StoreError')
        assert.include(error.message, 'Failed to store on primary provider')
      }
    })

    it('should throw CommitError when primary commit fails after successful store', async () => {
      // CommitError is only thrown in multi-copy path (count >= 2)
      // Use explicit contexts to ensure provider1 is primary
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const provider1Options = { baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL }
      const provider2Options = { baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL }

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        // Both providers respond to ping
        Mocks.PING(provider1Options),
        Mocks.PING(provider2Options),
        // Primary store succeeds
        Mocks.pdp.postPieceUploadsHandler(mockUuid, provider1Options),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, provider1Options),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), provider1Options),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, provider1Options),
        // Primary commit fails
        http.post(`${provider1Options.baseUrl}/pdp/data-sets/create-and-add`, () => {
          return HttpResponse.json({ error: 'Transaction failed' }, { status: 500 })
        })
      )

      const synapse = new Synapse({ client })

      // Create contexts explicitly to ensure provider1 is primary
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })

      try {
        // Explicit contexts with 2 providers triggers multi-copy path
        await synapse.storage.upload(testData, { contexts })
        assert.fail('Should have thrown CommitError')
      } catch (error: any) {
        assert.include(error.name, 'CommitError')
        assert.include(error.message, 'Failed to commit on primary provider')
      }
    })

    it('should succeed with primary-only copy when all secondaries fail', async () => {
      // This test uses explicit contexts to control provider ordering
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const provider1Options = { baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL }
      const provider2Options = { baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL }

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        // Both providers respond to ping
        Mocks.PING(provider1Options),
        Mocks.PING(provider2Options),
        // Primary (provider1) store and commit succeed
        Mocks.pdp.postPieceUploadsHandler(mockUuid, provider1Options),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, provider1Options),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), provider1Options),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, provider1Options),
        Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, provider1Options),
        Mocks.pdp.dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            createMessageHash: FAKE_TX_HASH,
            dataSetCreated: true,
            service: 'test',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: DATA_SET_ID,
          },
          provider1Options
        ),
        Mocks.pdp.pieceAdditionStatusHandler(
          DATA_SET_ID,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: DATA_SET_ID,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [101],
          },
          provider1Options
        )
        // No handlers for provider2 - secondary pull will fail
      )

      const synapse = new Synapse({ client })

      // Create contexts explicitly to ensure provider1 is primary
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })

      const result = await synapse.storage.upload(testData, { contexts })

      // Should succeed with partial result
      assert.equal(result.pieceCid.toString(), expectedPieceCid.toString())
      assert.equal(result.size, 127)
      assert.lengthOf(result.copies, 1, 'Should have 1 successful copy (primary only)')
      assert.equal(result.copies[0].role, 'primary')
      assert.isAbove(result.failures.length, 0, 'Should have at least 1 failure (secondary)')
    })

    it('should call onCopyComplete for each piece when secondary pull succeeds', async () => {
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const provider1Options = { baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL }
      const provider2Options = { baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL }

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING(provider1Options),
        Mocks.PING(provider2Options),
        // Primary store and commit
        Mocks.pdp.postPieceUploadsHandler(mockUuid, provider1Options),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, provider1Options),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), provider1Options),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, provider1Options),
        Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, provider1Options),
        Mocks.pdp.dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            createMessageHash: FAKE_TX_HASH,
            dataSetCreated: true,
            service: 'test',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: DATA_SET_ID,
          },
          provider1Options
        ),
        Mocks.pdp.pieceAdditionStatusHandler(
          DATA_SET_ID,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: DATA_SET_ID,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [101],
          },
          provider1Options
        ),
        // Secondary pull and commit
        Mocks.pdp.pullPiecesHandler(
          { status: 'complete', pieces: [{ pieceCid: expectedPieceCid.toString(), status: 'complete' }] },
          provider2Options
        ),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, provider2Options),
        Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, provider2Options),
        Mocks.pdp.dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            createMessageHash: FAKE_TX_HASH,
            dataSetCreated: true,
            service: 'test',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: DATA_SET_ID + 1,
          },
          provider2Options
        ),
        Mocks.pdp.pieceAdditionStatusHandler(
          DATA_SET_ID + 1,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: DATA_SET_ID + 1,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [201],
          },
          provider2Options
        )
      )

      const synapse = new Synapse({ client })
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })

      const copyCompleteEvents: Array<{ providerId: bigint; pieceCid: string }> = []
      const confirmedEvents: Array<{ providerId: bigint; pieceCid: string; pieceId: bigint }> = []

      const result = await synapse.storage.upload(testData, {
        contexts,
        callbacks: {
          onCopyComplete: (providerId, pieceCid) => {
            copyCompleteEvents.push({ providerId, pieceCid: pieceCid.toString() })
          },
          onPieceConfirmed: (providerId, pieceCid, pieceId) => {
            confirmedEvents.push({ providerId, pieceCid: pieceCid.toString(), pieceId })
          },
        },
      })

      assert.equal(result.copies.length, 2, 'Should have 2 copies')
      assert.equal(copyCompleteEvents.length, 1, 'onCopyComplete should fire once for secondary')
      assert.equal(copyCompleteEvents[0].providerId, Mocks.PROVIDERS.provider2.providerId)
      assert.equal(copyCompleteEvents[0].pieceCid, expectedPieceCid.toString())
      assert.equal(confirmedEvents.length, 2, 'onPieceConfirmed should fire for each provider')
    })

    it('should call onCopyFailed when secondary pull fails', async () => {
      const testData = new Uint8Array(127).fill(42)
      const expectedPieceCid = Piece.calculate(testData)
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      const provider1Options = { baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL }
      const provider2Options = { baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL }

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
        }),
        Mocks.PING(provider1Options),
        Mocks.PING(provider2Options),
        // Primary store and commit succeeds
        Mocks.pdp.postPieceUploadsHandler(mockUuid, provider1Options),
        Mocks.pdp.uploadPieceStreamingHandler(mockUuid, provider1Options),
        Mocks.pdp.finalizePieceUploadHandler(mockUuid, expectedPieceCid.toString(), provider1Options),
        Mocks.pdp.findPieceHandler(expectedPieceCid.toString(), true, provider1Options),
        Mocks.pdp.createAndAddPiecesHandler(FAKE_TX_HASH, provider1Options),
        Mocks.pdp.dataSetCreationStatusHandler(
          FAKE_TX_HASH,
          {
            createMessageHash: FAKE_TX_HASH,
            dataSetCreated: true,
            service: 'test',
            txStatus: 'confirmed',
            ok: true,
            dataSetId: DATA_SET_ID,
          },
          provider1Options
        ),
        Mocks.pdp.pieceAdditionStatusHandler(
          DATA_SET_ID,
          FAKE_TX_HASH,
          {
            txHash: FAKE_TX_HASH,
            txStatus: 'confirmed',
            dataSetId: DATA_SET_ID,
            pieceCount: 1,
            addMessageOk: true,
            piecesAdded: true,
            confirmedPieceIds: [101],
          },
          provider1Options
        ),
        // Secondary pull fails
        Mocks.pdp.pullPiecesErrorHandler('Pull failed: connection refused', 500, provider2Options)
      )

      const synapse = new Synapse({ client })
      const contexts = await synapse.storage.createContexts({
        providerIds: [Mocks.PROVIDERS.provider1.providerId, Mocks.PROVIDERS.provider2.providerId],
      })

      const copyFailedEvents: Array<{ providerId: bigint; pieceCid: string; error: string }> = []

      const result = await synapse.storage.upload(testData, {
        contexts,
        callbacks: {
          onCopyFailed: (providerId, pieceCid, error) => {
            copyFailedEvents.push({ providerId, pieceCid: pieceCid.toString(), error: error.message })
          },
        },
      })

      assert.equal(result.copies.length, 1, 'Should have 1 copy (primary only)')
      assert.equal(result.failures.length, 1, 'Should have 1 failure')
      assert.equal(copyFailedEvents.length, 1, 'onCopyFailed should fire once')
      assert.equal(copyFailedEvents[0].providerId, Mocks.PROVIDERS.provider2.providerId)
    })
  })

  describe('Provider Ping Validation', () => {
    describe('selectRandomProvider with ping validation', () => {
      it('should select first provider that responds to ping', async () => {
        server.use(
          Mocks.JSONRPC({
            ...Mocks.presets.basic,
            serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
          }),
          http.get(`${Mocks.PROVIDERS.provider1.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          }),
          Mocks.PING({
            baseUrl: Mocks.PROVIDERS.provider2.products[0].offering.serviceURL,
          })
        )
        const synapse = new Synapse({ client })
        const warmStorageService = new WarmStorageService(client)
        const service = await StorageContext.create(synapse, warmStorageService)
        // Should have selected the second provider (first one failed ping)
        assert.equal(service.serviceProvider, Mocks.PROVIDERS.provider2.providerInfo.serviceProvider)
      })

      // Test removed: selectRandomProvider no longer supports exclusion functionality

      it('should throw error when all providers fail ping', async () => {
        server.use(
          Mocks.JSONRPC({
            ...Mocks.presets.basic,
            serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1, Mocks.PROVIDERS.provider2]),
          }),
          http.get(`${Mocks.PROVIDERS.provider1.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          }),
          http.get(`${Mocks.PROVIDERS.provider2.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          })
        )
        const synapse = new Synapse({ client })
        const warmStorageService = new WarmStorageService(client)

        try {
          await StorageContext.create(synapse, warmStorageService)
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'StorageContext smartSelectProvider failed')
          assert.include(error.message, 'All 2 providers failed health check')
        }
      })
    })
  })

  describe('getProviderInfo', () => {
    it('should return provider info through WarmStorageService', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService)

      const providerInfo = await service.getProviderInfo()

      assert.deepEqual(providerInfo, {
        id: 1n,
        serviceProvider: '0x0000000000000000000000000000000000000001',
        payee: '0x1000000000000000000000000000000000000001',
        name: 'Provider 1',
        description: 'Test provider 1',
        isActive: true,
        pdp: {
          serviceURL: 'https://provider1.example.com',
          minPieceSizeInBytes: 1024n,
          maxPieceSizeInBytes: 34359738368n,
          ipniPiece: false,
          ipniIpfs: false,
          ipniPeerId: undefined,
          storagePricePerTibPerDay: 1000000n,
          minProvingPeriodInEpochs: 30n,
          location: 'us-east',
          paymentTokenAddress: '0xb3042734b608a1b16e9e86b374a3f3e389b4cdf0',
        },
      })
    })
  })

  describe('getDataSetPieces', () => {
    it('should successfully fetch data set pieces', async () => {
      const mockDataSetData = {
        id: 1,
        pieces: [
          {
            pieceId: 101,
            pieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceCid: 'bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy',
            subPieceOffset: 0,
          },
          {
            pieceId: 102,
            pieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceCid: 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace',
            subPieceOffset: 0,
          },
        ],
        nextChallengeEpoch: 1500,
      }
      // Mock getActivePieces to return the expected pieces
      const piecesData = mockDataSetData.pieces.map((piece) => {
        const cid = CID.parse(piece.pieceCid)
        return { data: bytesToHex(cid.bytes) }
      })
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => [piecesData, [101n, 102n], false],
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].toString(), mockDataSetData.pieces[0].pieceCid)
      assert.equal(result[1].toString(), mockDataSetData.pieces[1].pieceCid)
    })

    it('should handle empty data set pieces', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 0)
    })

    it('should handle invalid CID in response', async () => {
      const invalidCidBytes = bytesToHex(new TextEncoder().encode('invalid-cid-format'))
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => [[{ data: invalidCidBytes }], [101n], false],
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      // The new implementation should throw an error when trying to decode invalid CID data
      try {
        await service.getDataSetPieces()
        assert.fail('Expected an error to be thrown for invalid CID data')
      } catch (error: any) {
        // The error occurs during CID.decode(), not during PieceCID validation
        assert.include(error.message, 'Invalid CID version')
      }
    })

    it('should handle PDP server errors', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: Mocks.mockServiceProviderRegistry([Mocks.PROVIDERS.provider1]),
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => {
              throw new Error('Data set not found: 999')
            },
          },
        }),
        Mocks.PING({
          baseUrl: Mocks.PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })
      // Mock getActivePieces to throw an error

      try {
        await service.getDataSetPieces()
        assert.fail('Should have thrown error for contract call error')
      } catch (error: any) {
        assert.include(error.message, 'Data set not found: 999')
      }
    })
  })

  describe('pieceStatus()', () => {
    const mockPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
    it('should return exists=false when piece not found on provider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [],
            nextChallengeEpoch: 5000,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.text('Piece not found or does not belong to service', {
            status: 404,
          })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isFalse(status.exists)
      assert.isNull(status.retrievalUrl)
      assert.isNull(status.dataSetLastProven)
      assert.isNull(status.dataSetNextProofDue)
    })

    it('should return piece status with proof timing when piece exists', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(4000n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 5000,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: mockPieceCID })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.equal(status.retrievalUrl, `https://pdp.example.com/piece/${mockPieceCID}`)
      assert.isNotNull(status.dataSetLastProven)
      assert.isNotNull(status.dataSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when in challenge window', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(5030n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 5000,
          })
        }),
        Mocks.pdp.findPieceHandler(mockPieceCID, true, pdpOptions)
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })
      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      // During challenge window
      assert.isTrue(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when proof is overdue', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 5000,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: mockPieceCID })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isTrue(status.isProofOverdue)
    })

    it('should handle data set with nextChallengeEpoch=0', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 0,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: mockPieceCID })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isNull(status.dataSetLastProven) // No challenge means no proof data
      assert.isNull(status.dataSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
    })

    it('should handle trailing slash in retrieval URL', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 0,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: mockPieceCID })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      // Should not have double slash
      assert.equal(status.retrievalUrl, `https://pdp.example.com/piece/${mockPieceCID}`)
      // Check that the URL doesn't contain double slashes after the protocol
      const urlWithoutProtocol = (status.retrievalUrl ?? '').substring(8) // Remove 'https://'
      assert.notInclude(urlWithoutProtocol, '//')
    })

    it('should handle invalid PieceCID', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
        }),
        Mocks.PING()
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      try {
        await service.pieceStatus('invalid-pieceCid')
        assert.fail('Should have thrown error for invalid PieceCID')
      } catch (error: any) {
        assert.include(error.message, 'Invalid PieceCID provided')
      }
    })

    it('should calculate hours until challenge window', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(4880n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.json({
            id: 1,
            pieces: [
              {
                pieceId: 1,
                pieceCid: mockPieceCID,
              },
            ],
            nextChallengeEpoch: 5000,
          })
        }),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: mockPieceCID })
        })
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isFalse(status.inChallengeWindow) // Not yet in challenge window
      assert.isTrue((status.hoursUntilChallengeWindow ?? 0) > 0)
    })

    it('should handle data set data fetch failure gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          eth_blockNumber: numberToHex(4880n),
        }),
        Mocks.PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.error()
        }),
        Mocks.pdp.findPieceHandler(mockPieceCID, true, pdpOptions)
      )
      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const status = await service.pieceStatus(mockPieceCID)

      // Should still return basic status even if data set data fails
      assert.isTrue(status.exists)
      assert.isNotNull(status.retrievalUrl)
      assert.isNull(status.dataSetLastProven)
      assert.isNull(status.dataSetNextProofDue)
      assert.isUndefined(status.pieceId)
    })
  })

  describe('getScheduledRemovals', () => {
    it('should return scheduled removals for the data set', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getScheduledRemovals: () => [[1n, 2n, 5n]],
          },
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const scheduledRemovals = await context.getScheduledRemovals()

      assert.deepEqual(scheduledRemovals, [1n, 2n, 5n])
    })

    it('should return an empty array when no data set is configured', async () => {
      server.use(Mocks.JSONRPC({ ...Mocks.presets.basic }), Mocks.PING())

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      ;(context as any)._dataSetId = undefined

      const scheduledRemovals = await context.getScheduledRemovals()

      assert.deepEqual(scheduledRemovals, [])
    })
  })

  describe('getPieces', () => {
    it('should get all active pieces with pagination', async () => {
      // Use actual valid PieceCIDs from test data
      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))
      const piece2Cid = calculatePieceCID(new Uint8Array(256).fill(2))
      const piece3Cid = calculatePieceCID(new Uint8Array(512).fill(3))

      // Mock getActivePieces to return paginated results
      server.use(
        Mocks.PING(),
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page: return 2 pieces with hasMore=true
              if (offset === 0) {
                return [[{ data: bytesToHex(piece1Cid.bytes) }, { data: bytesToHex(piece2Cid.bytes) }], [1n, 2n], true]
              }
              // Second page: return 1 piece with hasMore=false
              if (offset === 2) {
                return [[{ data: bytesToHex(piece3Cid.bytes) }], [3n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      // Test getPieces - should collect all pages
      const allPieces = []
      for await (const piece of context.getPieces({ batchSize: 2n })) {
        allPieces.push(piece)
      }

      assert.equal(allPieces.length, 3, 'Should return all 3 pieces across pages')
      assert.equal(allPieces[0].pieceId, 1n)
      assert.equal(allPieces[0].pieceCid.toString(), piece1Cid.toString())

      assert.equal(allPieces[1].pieceId, 2n)
      assert.equal(allPieces[1].pieceCid.toString(), piece2Cid.toString())

      assert.equal(allPieces[2].pieceId, 3n)
      assert.equal(allPieces[2].pieceCid.toString(), piece3Cid.toString())
    })

    it('should handle empty results', async () => {
      // Mock getActivePieces to return no pieces
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      const allPieces = []
      for await (const piece of context.getPieces()) {
        allPieces.push(piece)
      }
      assert.equal(allPieces.length, 0, 'Should return empty array for data set with no pieces')
    })

    it('should handle AbortSignal in getPieces', async () => {
      const controller = new AbortController()

      server.use(Mocks.JSONRPC(Mocks.presets.basic))

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      // Abort before making the call
      controller.abort()

      try {
        for await (const _piece of context.getPieces({ signal: controller.signal })) {
          // Should not reach here
        }
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.equal(error.message, 'StorageContext getPieces failed: Operation aborted')
      }
    })

    it('should work with getPieces generator', async () => {
      // Use actual valid PieceCIDs from test data
      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))
      const piece2Cid = calculatePieceCID(new Uint8Array(256).fill(2))

      // Mock getActivePieces to return paginated results
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page
              if (offset === 0) {
                return [[{ data: bytesToHex(piece1Cid.bytes) }], [1n], true]
              }
              // Second page
              if (offset === 1) {
                return [[{ data: bytesToHex(piece2Cid.bytes) }], [2n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      // Test the async generator
      const pieces = []
      for await (const piece of context.getPieces({ batchSize: 1n })) {
        pieces.push(piece)
      }

      assert.equal(pieces.length, 2, 'Should yield 2 pieces')
      assert.equal(pieces[0].pieceId, 1n)
      assert.equal(pieces[0].pieceCid.toString(), piece1Cid.toString())
      assert.equal(pieces[1].pieceId, 2n)
      assert.equal(pieces[1].pieceCid.toString(), piece2Cid.toString())
    })

    it('should handle AbortSignal in getPieces generator during iteration', async () => {
      const controller = new AbortController()

      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))

      // Mock getActivePieces to return a result that triggers pagination
      let callCount = 0
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          pdpVerifier: {
            ...Mocks.presets.basic.pdpVerifier,
            getActivePieces: () => {
              callCount++
              // Only return data on first call, then abort
              if (callCount === 1) {
                setTimeout(() => controller.abort(), 0)
                return [[{ data: bytesToHex(piece1Cid.bytes) }], [1n], true]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = new Synapse({ client })
      const warmStorageService = new WarmStorageService(client)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1n,
      })

      try {
        const pieces = []
        for await (const piece of context.getPieces({
          batchSize: 1n,
          signal: controller.signal,
        })) {
          pieces.push(piece)
          // Give the abort a chance to trigger
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        assert.fail('Should have thrown an error')
      } catch (error: any) {
        assert.equal(error.message, 'StorageContext getPieces failed: Operation aborted')
      }
    })
  })
})
