import * as Piece from '@filoz/synapse-core/piece'
import { calculate } from '@filoz/synapse-core/piece'
import * as SP from '@filoz/synapse-core/sp'
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { CID } from 'multiformats/cid'
import { numberToHex } from 'viem'
import { calculate as calculatePieceCID } from '../piece/index.ts'
import { StorageContext } from '../storage/context.ts'
import { Synapse } from '../synapse.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { WarmStorageService } from '../warm-storage/index.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, PROVIDERS, presets } from './mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry } from './mocks/jsonrpc/service-registry.ts'
import {
  createAndAddPiecesHandler,
  findPieceHandler,
  postPieceHandler,
  uploadPieceHandler,
} from './mocks/pdp/handlers.ts'
import { PING } from './mocks/ping.ts'

// MSW server for JSONRPC mocking
const server = setup([])

function cidBytesToContractHex(bytes: Uint8Array): `0x${string}` {
  return ethers.hexlify(bytes) as `0x${string}`
}

const pdpOptions = {
  baseUrl: 'https://pdp.example.com',
}

describe('StorageService', () => {
  let signer: ethers.Signer
  let provider: ethers.Provider
  // MSW lifecycle hooks
  before(async () => {
    // Set timeout to 100ms for testing
    SP.setTimeout(100)
    await server.start({ quiet: true })
  })

  after(() => {
    server.stop()
  })

  beforeEach(async () => {
    server.resetHandlers()
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
  })

  describe('create() factory method', () => {
    it('should select a random provider when no providerId specified', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Should have selected one of the providers
      assert.isTrue(
        service.serviceProvider === PROVIDERS.provider1.providerInfo.serviceProvider ||
          service.serviceProvider === PROVIDERS.provider2.providerInfo.serviceProvider
      )
    })

    it('should select a random provider but filter allow IPNI providers', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.providerIPNI]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.providerIPNI.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      // Create storage service without specifying providerId
      const service = await StorageContext.create(synapse, warmStorageService, {
        withIpni: true,
      })

      // Should have selected one of the providers
      assert.isTrue(service.serviceProvider === PROVIDERS.providerIPNI.providerInfo.serviceProvider)
    })

    it.skip('should never select a dev provider by default', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Create storage service without specifying providerId
      // dev defaults to false, so dev providers should be filtered out
      const service = await StorageContext.create(synapse, warmStorageService, {
        dev: false,
      })

      // Should have selected provider2 (non-dev), never provider1 (dev)
      assert.equal(service.serviceProvider, PROVIDERS.provider2.providerInfo.serviceProvider)
      assert.notEqual(
        service.serviceProvider,
        PROVIDERS.provider1.providerInfo.serviceProvider,
        'Should not select dev provider'
      )
    })

    it.skip('should include dev providers when dev option is true', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Create storage service with dev: true
      const service = await StorageContext.create(synapse, warmStorageService, {
        dev: true,
      })

      // Should be able to select from either provider, including the dev one
      assert.isTrue(
        service.serviceProvider === PROVIDERS.provider1.providerInfo.serviceProvider ||
          service.serviceProvider === PROVIDERS.provider2.providerInfo.serviceProvider
      )
    })

    it.skip('should filter providers with serviceStatus=dev when dev option is false', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Create storage service with dev: false (default)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dev: false,
      })

      // Should only select the production provider, not the dev one
      assert.equal(
        service.serviceProvider.toLowerCase(),
        PROVIDERS.provider2.providerInfo.serviceProvider.toLowerCase(),
        'Should select production provider, not dev provider'
      )
      assert.notEqual(
        service.serviceProvider.toLowerCase(),
        PROVIDERS.provider1.providerInfo.serviceProvider.toLowerCase(),
        'Should NOT select dev provider'
      )
    })

    it('should use specific provider when providerId specified', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Create storage service with specific providerId
      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: Number(PROVIDERS.provider1.providerId),
      })

      assert.equal(service.serviceProvider, PROVIDERS.provider1.providerInfo.serviceProvider)
    })

    it('should skip existing datasets and return -1 with providerId when forceCreateDataSet is true', async () => {
      let fetchedDataSets = false
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              fetchedDataSets = true
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        providerId: Number(PROVIDERS.provider1.providerId),
        forceCreateDataSet: true,
      })

      assert.equal(
        context.serviceProvider,
        PROVIDERS.provider1.providerInfo.serviceProvider,
        'Should select the requested provider'
      )
      assert.equal(context.dataSetId, undefined, 'Should not have a data set id when forceCreateDataSet is true')
      assert.isFalse(fetchedDataSets, 'Should not have fetched existing data sets when forceCreateDataSet is true')
    })

    it('should skip existing datasets and return -1 with providerAddress when forceCreateDataSet is true', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        providerAddress: PROVIDERS.provider1.providerInfo.serviceProvider,
        forceCreateDataSet: true,
      })

      assert.equal(
        context.serviceProvider,
        PROVIDERS.provider1.providerInfo.serviceProvider,
        'Should select the requested provider'
      )
      assert.equal(context.dataSetId, undefined, 'Should not have a data set id when forceCreateDataSet is true')
    })

    it('should reuse existing data set with providerId when forceCreateDataSet is not set', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        providerId: Number(PROVIDERS.provider1.providerId),
      })

      // Should have reused existing data set (not created new one)
      assert.equal(context.serviceProvider, PROVIDERS.provider1.providerInfo.serviceProvider)
      assert.equal(context.dataSetId, 1, 'Should not have a data set id when forceCreateDataSet is true')
    })

    it('should throw when no approved providers available', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders() {
              return [[]]
            },
          },
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      try {
        await StorageContext.create(synapse, warmStorageService)
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'No approved service providers available')
      }
    })

    it('should throw when specified provider not found', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          providerId: 999,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Provider ID 999 not found in registry')
      }
    })

    it('should select existing data set when available', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: Number(PROVIDERS.provider1.providerId),
      })

      // Should use existing data set
      assert.equal(service.dataSetId, 1)
    })

    it.skip('should create new data set when none exist', async () => {
      // Skip: Requires real PDPServer for createDataSet
      // This would need mocking of PDPServer which is created internally
      // TODO: Implement PDPServer mocking and get this working
    })

    it('should prefer data sets with existing pieces', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getNextPieceId: (args) => {
              const [dataSetId] = args
              if (dataSetId === 2n) {
                return [2n]
              } else {
                return [0n]
              }
            },
          },
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 1n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 2n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
                  },
                ]
              }
            },
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerId: 1,
      })

      // Should select the data set with pieces
      assert.equal(service.dataSetId, 2)
    })

    it('should handle provider selection callbacks', async () => {
      let providerCallbackFired = false
      let dataSetCallbackFired = false
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      await StorageContext.create(synapse, warmStorageService, {
        providerId: Number(PROVIDERS.provider1.providerId),
        callbacks: {
          onProviderSelected: (provider) => {
            assert.equal(provider.serviceProvider, PROVIDERS.provider1.providerInfo.serviceProvider)
            providerCallbackFired = true
          },
          onDataSetResolved: (info) => {
            assert.isTrue(info.isExisting)
            assert.equal(info.dataSetId, 1)
            dataSetCallbackFired = true
          },
        },
      })

      assert.isTrue(providerCallbackFired, 'onProviderSelected should have been called')
      assert.isTrue(dataSetCallbackFired, 'onDataSetResolved should have been called')
    })

    it('should select by explicit dataSetId', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 1n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 2n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
                  },
                ]
              }
            },
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 2,
      })
      assert.equal(service.dataSetId, 2)
      assert.equal(service.serviceProvider, PROVIDERS.provider1.providerInfo.serviceProvider)
    })

    it('should select by providerAddress', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      const service = await StorageContext.create(synapse, warmStorageService, {
        providerAddress: PROVIDERS.provider2.providerInfo.serviceProvider,
      })

      assert.equal(service.serviceProvider, PROVIDERS.provider2.providerInfo.serviceProvider)
    })

    it('should throw when dataSetId not found', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 999,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 999 not found')
      }
    })

    it('should throw when dataSetId conflicts with providerId', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getAllDataSetMetadata() {
              return [[], []]
            },
          },
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        }),
        PING({
          baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1,
          providerId: 2, // Conflicts with actual owner
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider ID 1')
        assert.include(error.message, 'but provider ID 2 was requested')
      }
    })

    it('should throw when providerAddress not approved', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          providerAddress: '0x6666666666666666666666666666666666666666',
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'not found in registry')
      }
    })

    it('should filter by CDN setting in smart selection', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 1n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
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
                    payee: ADDRESSES.serviceProvider1,
                    payer: ADDRESSES.client1,
                    pdpEndEpoch: 0n,
                    pdpRailId: 2n,
                    providerId: 1n,
                    serviceProvider: ADDRESSES.serviceProvider1,
                  },
                ]
              }
            },
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Test with CDN = false
      const serviceNoCDN = await StorageContext.create(synapse, warmStorageService, {
        withCDN: false,
      })
      assert.equal(serviceNoCDN.dataSetId, 1, 'Should select non-CDN data set')

      // Test with CDN = true
      const serviceWithCDN = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })
      assert.equal(serviceWithCDN.dataSetId, 2, 'Should select CDN data set')
    })

    it.skip('should handle data sets not managed by current WarmStorage', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      // Should create new data set since existing one is not managed
      const service = await StorageContext.create(synapse, warmStorageService, {})

      // Should have selected a provider but no existing data set
      assert.exists(service.serviceProvider)
      assert.notEqual(service.serviceProvider, PROVIDERS.provider1.providerInfo.serviceProvider)
    })

    it('should throw when data set belongs to non-approved provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                  payee: ADDRESSES.serviceProvider1,
                  payer: ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 3n,
                  serviceProvider: ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        // Provider 999 is not in the registry, so we'll get a "not found in registry" error
        assert.include(error.message, 'not found in registry')
      }
    })

    it('should handle data set not live', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            dataSetLive: () => [false],
          },
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                  payee: ADDRESSES.serviceProvider1,
                  payer: ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  serviceProvider: ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1,
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'Data set 1 not found')
      }
    })

    it('should handle conflict between dataSetId and providerAddress', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                  payee: ADDRESSES.serviceProvider1,
                  payer: ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  serviceProvider: ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      try {
        await StorageContext.create(synapse, warmStorageService, {
          dataSetId: 1,
          providerAddress: '0x9999888877776666555544443333222211110000', // Different address
        })
        assert.fail('Should have thrown error')
      } catch (error: any) {
        assert.include(error.message, 'belongs to provider')
        assert.include(error.message, 'but provider')
        assert.include(error.message, 'was requested')
      }
    })

    it.skip('should retry transaction fetch for up to 180 seconds', async () => {
      // This test validates that the transaction retry logic is implemented
      // The implementation retries getTransaction() for up to 180 seconds (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS)
      // with a 2-second interval (TIMING_CONSTANTS.TRANSACTION_PROPAGATION_POLL_INTERVAL_MS)
      // before throwing an error if the transaction is not found
    })

    it.skip('should fail after 180 seconds if transaction never appears', async () => {
      // This test validates that the transaction retry logic times out after 180 seconds
      // If a transaction is not found after TIMING_CONSTANTS.TRANSACTION_PROPAGATION_TIMEOUT_MS (180 seconds),
      // the implementation throws an error indicating the transaction was not found
    })

    it('should match providers by ID even when payee differs from serviceProvider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          warmStorageView: {
            ...presets.basic.warmStorageView,
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
                  payee: ADDRESSES.serviceProvider2,
                  payer: ADDRESSES.client1,
                  pdpEndEpoch: 0n,
                  pdpRailId: 1n,
                  providerId: 1n,
                  serviceProvider: ADDRESSES.serviceProvider1,
                },
              ]
            },
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

      const service = await StorageContext.create(synapse, warmStorageService, {})

      // Should successfully match by provider ID despite different payee
      assert.equal(service.dataSetId, 1)
      assert.equal(service.provider.id, 1)
      assert.equal(service.provider.serviceProvider, ADDRESSES.serviceProvider1)
    })
  })

  describe('preflightUpload', () => {
    it('should calculate costs without CDN', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            operatorApprovals: () => [true, 2207579500n, 220757940000000n, 220757n, 220757n, 86400n],
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
          payments: {
            ...presets.basic.payments,
            operatorApprovals: () => [true, 2207579500n, 220757940000000n, 220757n, 220757n, 86400n],
          },
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      const preflight = await service.preflightUpload(Number(100n * SIZE_CONSTANTS.MiB)) // 100 MiB

      assert.isFalse(preflight.allowanceCheck.sufficient)
      assert.include(preflight.allowanceCheck.message, 'Insufficient rate and lockup allowances')
    })

    it('should enforce minimum size limit in preflightUpload', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        withCDN: true,
      })

      try {
        await service.preflightUpload(Number(210n * SIZE_CONSTANTS.MiB)) // 210 MiB
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, '220200960') // 210 * 1024 * 1024
        assert.include(error.message, '209715200') // 200 * 1024 * 1024
      }
    })
  })

  describe('download', () => {
    it('should download and verify a piece', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      const testPieceCID = calculate(testData).toString()
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        http.get(`https://${ADDRESSES.client1}.calibration.filbeam.io/:cid`, async () => {
          return HttpResponse.text('Not Found', {
            status: 404,
          })
        }),
        findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        findPieceHandler(testPieceCID, true, pdpOptions),
        http.get('https://pdp.example.com/piece/:pieceCid', async () => {
          return HttpResponse.arrayBuffer(testData.buffer)
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
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
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        http.post<Record<string, never>, { pieceCid: string }>('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Create 3 uploads
      const uploads = [
        service.upload(new Uint8Array(127).fill(1)),
        service.upload(new Uint8Array(128).fill(2)),
        service.upload(new Uint8Array(129).fill(3)),
      ]

      // All uploads in the batch should fail with the same error
      const results = await Promise.allSettled(uploads)

      // First two should fail together (same batch)
      assert.equal(results[0].status, 'rejected')
      assert.equal(results[1].status, 'rejected')

      if (results[0].status === 'rejected' && results[1].status === 'rejected') {
        assert.include(results[0].reason.message, 'Failed to upload piece to service provider')
        assert.include(results[1].reason.message, 'Failed to upload piece to service provider')
        // They should have the same error message (same batch)
        assert.equal(results[0].reason.message, results[1].reason.message)
      }

      // Third upload might succeed or fail depending on timing
      if (results[2].status === 'rejected') {
        assert.include(results[2].reason.message, 'Failed to upload piece to service provider')
      }
    })

    it('should enforce 200 MiB size limit', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      // Create data that exceeds the limit
      const oversizedData = new Uint8Array(Number(210n * SIZE_CONSTANTS.MiB)) // 210 MiB

      try {
        await service.upload(oversizedData)
        assert.fail('Should have thrown size limit error')
      } catch (error: any) {
        assert.include(error.message, 'exceeds maximum allowed size')
        assert.include(error.message, '220200960') // 210 * 1024 * 1024
        assert.include(error.message, '209715200') // 200 * 1024 * 1024
      }
    })

    it.skip('should fail if new server verification fails', async () => {
      const testData = new Uint8Array(127).fill(42) // 127 bytes to meet minimum
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        http.post<Record<string, never>, { pieceCid: string }>('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for verification failure')
      } catch (error: any) {
        // The error is wrapped by createError
        assert.include(error.message, 'StorageContext addPieces failed:')
        assert.include(error.message, 'Failed to verify piece addition')
        assert.include(error.message, 'The transaction was confirmed on-chain but the server failed to acknowledge it')
      }
    })

    it.skip('should handle transaction failure on-chain', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        http.post('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.text('Created', {
            status: 201,
            headers: {
              Location: `/pdp/piece/upload/${mockUuid}`,
            },
          })
        }),
        uploadPieceHandler(mockUuid, pdpOptions),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: testPieceCID })
        }),
        createAndAddPiecesHandler(mockTxHash, pdpOptions),
        http.get('https://pdp.example.com/pdp/data-sets/created/:tx', async () => {
          return HttpResponse.json(
            {
              createMessageHash: mockTxHash,
              dataSetCreated: true,
              service: 'test-service',
              txStatus: 'confirmed',
              ok: false,
              dataSetId: 123,
            },
            {
              status: 200,
            }
          )
        }),
        http.get('https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash', () => {
          return HttpResponse.json(
            {
              txHash: mockTxHash,
              txStatus: 'confirmed',
              dataSetId: 1,
              pieceCount: 2,
              addMessageOk: false,
              confirmedPieceIds: [101, 102],
            },
            {
              status: 200,
            }
          )
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.upload(testData)
        assert.fail('Should have thrown error for failed transaction')
      } catch (error: any) {
        // The error is wrapped twice - first by the specific throw, then by the outer catch
        assert.include(error.message, 'StorageContext addPieces failed:')
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })

    it.skip('should handle piece parking timeout', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = 'bafkzcibeqcad6efnpwn62p5vvs5x3nh3j7xkzfgb3xtitcdm2hulmty3xx4tl3wace'
      const mockTxHash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        http.post('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.text('Created', {
            status: 201,
            headers: {
              Location: `/pdp/piece/upload/${mockUuid}`,
            },
          })
        }),
        uploadPieceHandler(mockUuid, pdpOptions),
        http.get('https://pdp.example.com/pdp/piece', async () => {
          return HttpResponse.json({ pieceCid: testPieceCID })
        }),
        createAndAddPiecesHandler(mockTxHash, pdpOptions),
        http.get('https://pdp.example.com/pdp/data-sets/created/:tx', async () => {
          return HttpResponse.json(
            {
              createMessageHash: mockTxHash,
              dataSetCreated: true,
              service: 'test-service',
              txStatus: 'confirmed',
              ok: false,
              dataSetId: 123,
            },
            {
              status: 200,
            }
          )
        }),
        http.get('https://pdp.example.com/pdp/data-sets/:id/pieces/added/:txHash', () => {
          return HttpResponse.json(
            {
              txHash: mockTxHash,
              txStatus: 'confirmed',
              dataSetId: 1,
              pieceCount: 2,
              addMessageOk: false,
              confirmedPieceIds: [101, 102],
            },
            {
              status: 200,
            }
          )
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.upload(testData)
        assert.fail('Should have thrown timeout error')
      } catch (error: any) {
        assert.include(error.message, 'Timeout waiting for piece to be parked')
      }
    })

    it('should handle upload piece failure', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = Piece.calculate(testData).toString()
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        postPieceHandler(testPieceCID, mockUuid, pdpOptions),
        http.put('https://pdp.example.com/pdp/piece/upload/:uuid', async () => {
          return HttpResponse.error()
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      try {
        await service.upload(testData)
        assert.fail('Should have thrown upload error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to upload piece to service provider')
      }
    })

    it('should handle add pieces failure', async () => {
      const testData = new Uint8Array(127).fill(42)
      const testPieceCID = Piece.calculate(testData).toString()
      const mockUuid = '12345678-90ab-cdef-1234-567890abcdef'
      server.use(
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
        postPieceHandler(testPieceCID, mockUuid, pdpOptions),
        uploadPieceHandler(mockUuid, pdpOptions),
        findPieceHandler(testPieceCID, true, pdpOptions),
        http.post('https://pdp.example.com/pdp/data-sets/:id/pieces', () => {
          return HttpResponse.error()
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      try {
        await service.upload(testData)
        assert.fail('Should have thrown add pieces error')
      } catch (error: any) {
        assert.include(error.message, 'Failed to add piece to data set')
      }
    })
  })

  describe('Provider Ping Validation', () => {
    describe('selectRandomProvider with ping validation', () => {
      it('should select first provider that responds to ping', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
            serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
          }),
          http.get(`${PROVIDERS.provider1.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          }),
          PING({
            baseUrl: PROVIDERS.provider2.products[0].offering.serviceURL,
          })
        )
        const synapse = await Synapse.create({ signer })
        const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
        const service = await StorageContext.create(synapse, warmStorageService)
        // Should have selected the second provider (first one failed ping)
        assert.equal(service.serviceProvider, PROVIDERS.provider2.providerInfo.serviceProvider)
      })

      // Test removed: selectRandomProvider no longer supports exclusion functionality

      it('should throw error when all providers fail ping', async () => {
        server.use(
          JSONRPC({
            ...presets.basic,
            serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
          }),
          http.get(`${PROVIDERS.provider1.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          }),
          http.get(`${PROVIDERS.provider2.products[0].offering.serviceURL}/pdp/ping`, async () => {
            return HttpResponse.error()
          })
        )
        const synapse = await Synapse.create({ signer })
        const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)

        try {
          await StorageContext.create(synapse, warmStorageService)
          assert.fail('Should have thrown error')
        } catch (error: any) {
          assert.include(error.message, 'StorageContext selectProviderWithPing failed')
          assert.include(error.message, 'All 2 providers failed health check')
        }
      })
    })
  })

  describe('getProviderInfo', () => {
    it('should return provider info through WarmStorageService', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService)

      const providerInfo = await service.getProviderInfo()

      assert.deepEqual(providerInfo, {
        id: 1,
        serviceProvider: '0x0000000000000000000000000000000000000001',
        payee: '0x1000000000000000000000000000000000000001',
        name: 'Provider 1',
        description: 'Test provider 1',
        active: true,
        products: {
          PDP: {
            type: 'PDP',
            isActive: true,
            capabilities: {
              serviceURL: '0x68747470733a2f2f70726f7669646572312e6578616d706c652e636f6d',
              minPieceSizeInBytes: '0x0400',
              maxPieceSizeInBytes: '0x0800000000',
              storagePricePerTibPerDay: '0x0f4240',
              minProvingPeriodInEpochs: '0x1e',
              location: '0x75732d65617374',
              paymentTokenAddress: '0xb3042734b608a1b16e9e86b374a3f3e389b4cdf0',
            },
            data: {
              serviceURL: 'https://provider1.example.com',
              minPieceSizeInBytes: 1024n,
              maxPieceSizeInBytes: 34359738368n,
              ipniPiece: false,
              ipniIpfs: false,
              storagePricePerTibPerDay: 1000000n,
              minProvingPeriodInEpochs: 30n,
              location: 'us-east',
              paymentTokenAddress: '0xb3042734b608a1b16e9e86b374a3f3e389b4cdf0',
            },
          },
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
        return { data: cidBytesToContractHex(cid.bytes) }
      })
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [piecesData, [101n, 102n], false],
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 2)
      assert.equal(result[0].toString(), mockDataSetData.pieces[0].pieceCid)
      assert.equal(result[1].toString(), mockDataSetData.pieces[1].pieceCid)
    })

    it('should handle empty data set pieces', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const result = await service.getDataSetPieces()

      assert.isArray(result)
      assert.equal(result.length, 0)
    })

    it('should handle invalid CID in response', async () => {
      const invalidCidBytes = cidBytesToContractHex(ethers.toUtf8Bytes('invalid-cid-format'))
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[{ data: invalidCidBytes }], [101n], false],
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1]),
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => {
              throw new Error('Data set not found: 999')
            },
          },
        }),
        PING({
          baseUrl: PROVIDERS.provider1.products[0].offering.serviceURL,
        })
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isFalse(status.exists)
      assert.isNull(status.retrievalUrl)
      assert.isNull(status.dataSetLastProven)
      assert.isNull(status.dataSetNextProofDue)
    })

    it('should return piece status with proof timing when piece exists', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(4000n),
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(5030n),
        }),
        PING(),
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
        findPieceHandler(mockPieceCID, true, pdpOptions)
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })
      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      // During challenge window
      assert.isTrue(status.inChallengeWindow)
      assert.isFalse(status.isProofOverdue)
    })

    it('should detect when proof is overdue', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isTrue(status.isProofOverdue)
    })

    it('should handle data set with nextChallengeEpoch=0', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isNull(status.dataSetLastProven) // No challenge means no proof data
      assert.isNull(status.dataSetNextProofDue)
      assert.isFalse(status.inChallengeWindow)
    })

    it('should handle trailing slash in retrieval URL', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(5100n),
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
        }),
        PING()
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(4880n),
        }),
        PING(),
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
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const status = await service.pieceStatus(mockPieceCID)

      assert.isTrue(status.exists)
      assert.isFalse(status.inChallengeWindow) // Not yet in challenge window
      assert.isTrue((status.hoursUntilChallengeWindow ?? 0) > 0)
    })

    it('should handle data set data fetch failure gracefully', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          eth_blockNumber: numberToHex(4880n),
        }),
        PING(),
        http.get('https://pdp.example.com/pdp/data-sets/:id', async () => {
          return HttpResponse.error()
        }),
        findPieceHandler(mockPieceCID, true, pdpOptions)
      )
      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const service = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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

  describe('getPieces', () => {
    it('should get all active pieces with pagination', async () => {
      // Use actual valid PieceCIDs from test data
      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))
      const piece2Cid = calculatePieceCID(new Uint8Array(256).fill(2))
      const piece3Cid = calculatePieceCID(new Uint8Array(512).fill(3))

      // Mock getActivePieces to return paginated results
      server.use(
        PING(),
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page: return 2 pieces with hasMore=true
              if (offset === 0) {
                return [
                  [{ data: cidBytesToContractHex(piece1Cid.bytes) }, { data: cidBytesToContractHex(piece2Cid.bytes) }],
                  [1n, 2n],
                  true,
                ]
              }
              // Second page: return 1 piece with hasMore=false
              if (offset === 2) {
                return [[{ data: cidBytesToContractHex(piece3Cid.bytes) }], [3n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      // Test getPieces - should collect all pages
      const allPieces = []
      for await (const piece of context.getPieces({ batchSize: 2 })) {
        allPieces.push(piece)
      }

      assert.equal(allPieces.length, 3, 'Should return all 3 pieces across pages')
      assert.equal(allPieces[0].pieceId, 1)
      assert.equal(allPieces[0].pieceCid.toString(), piece1Cid.toString())

      assert.equal(allPieces[1].pieceId, 2)
      assert.equal(allPieces[1].pieceCid.toString(), piece2Cid.toString())

      assert.equal(allPieces[2].pieceId, 3)
      assert.equal(allPieces[2].pieceCid.toString(), piece3Cid.toString())
    })

    it('should handle empty results', async () => {
      // Mock getActivePieces to return no pieces
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => [[], [], false],
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      const allPieces = []
      for await (const piece of context.getPieces()) {
        allPieces.push(piece)
      }
      assert.equal(allPieces.length, 0, 'Should return empty array for data set with no pieces')
    })

    it('should handle AbortSignal in getPieces', async () => {
      const controller = new AbortController()

      server.use(JSONRPC(presets.basic))

      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
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
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: (args) => {
              const offset = Number(args[1])

              // First page
              if (offset === 0) {
                return [[{ data: cidBytesToContractHex(piece1Cid.bytes) }], [1n], true]
              }
              // Second page
              if (offset === 1) {
                return [[{ data: cidBytesToContractHex(piece2Cid.bytes) }], [2n], false]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      // Test the async generator
      const pieces = []
      for await (const piece of context.getPieces({ batchSize: 1 })) {
        pieces.push(piece)
      }

      assert.equal(pieces.length, 2, 'Should yield 2 pieces')
      assert.equal(pieces[0].pieceId, 1)
      assert.equal(pieces[0].pieceCid.toString(), piece1Cid.toString())
      assert.equal(pieces[1].pieceId, 2)
      assert.equal(pieces[1].pieceCid.toString(), piece2Cid.toString())
    })

    it('should handle AbortSignal in getPieces generator during iteration', async () => {
      const controller = new AbortController()

      const piece1Cid = calculatePieceCID(new Uint8Array(128).fill(1))

      // Mock getActivePieces to return a result that triggers pagination
      let callCount = 0
      server.use(
        JSONRPC({
          ...presets.basic,
          pdpVerifier: {
            ...presets.basic.pdpVerifier,
            getActivePieces: () => {
              callCount++
              // Only return data on first call, then abort
              if (callCount === 1) {
                setTimeout(() => controller.abort(), 0)
                return [[{ data: cidBytesToContractHex(piece1Cid.bytes) }], [1n], true]
              }
              return [[], [], false]
            },
          },
        })
      )

      const synapse = await Synapse.create({ signer })
      const warmStorageService = await WarmStorageService.create(provider, ADDRESSES.calibration.warmStorage)
      const context = await StorageContext.create(synapse, warmStorageService, {
        dataSetId: 1,
      })

      try {
        const pieces = []
        for await (const piece of context.getPieces({
          batchSize: 1,
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
