/* globals describe it beforeEach */

import { type Chain, calibration } from '@filoz/synapse-core/chains'
import { ZodValidationError } from '@filoz/synapse-core/errors'
import * as Mocks from '@filoz/synapse-core/mocks'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { type Client, createPublicClient, createWalletClient, type Transport, http as viemHttp } from 'viem'
import { type Account, privateKeyToAccount } from 'viem/accounts'
import { SPRegistryService } from '../sp-registry/service.ts'
import { PRODUCTS } from '../sp-registry/types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'

// mock server for testing
const server = setup()

describe('SPRegistryService', () => {
  let service: SPRegistryService
  let publicClient: Client<Transport, Chain>
  let walletClient: Client<Transport, Chain, Account>

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    publicClient = createPublicClient({
      chain: calibration,
      transport: viemHttp(),
    })
    walletClient = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    service = new SPRegistryService(publicClient)
  })

  describe('Constructor', () => {
    it('should create instance with provider and address', () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const instance = new SPRegistryService(publicClient)
      assert.exists(instance)
    })
  })

  describe('Provider Read Operations', () => {
    it('should get provider by ID', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const provider = await service.getProvider(1n)
      assert.exists(provider)
      assert.equal(provider?.id, 1n)
      assert.equal(provider?.serviceProvider, Mocks.ADDRESSES.serviceProvider1)
      assert.equal(provider?.name, 'Test Provider')
      assert.equal(provider?.description, 'Test Provider')
      assert.isTrue(provider?.isActive)
    })

    it('should return null for non-existent provider', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
          },
        })
      )
      const provider = await service.getProvider(999n)
      assert.isNull(provider)
    })

    it('should get provider by address', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const provider = await service.getProviderByAddress(Mocks.ADDRESSES.serviceProvider1)
      assert.exists(provider)
      assert.equal(provider.id, 1n)
      assert.equal(provider.serviceProvider, Mocks.ADDRESSES.serviceProvider1)
    })

    it('should return null for unregistered address', async () => {
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
                  isActive: false,
                  name: '',
                  description: '',
                },
              },
            ],
          },
        })
      )
      const provider = await service.getProviderByAddress(Mocks.ADDRESSES.zero)
      assert.isNull(provider)
    })

    it('should get provider ID by address', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const id = await service.getProviderIdByAddress(Mocks.ADDRESSES.serviceProvider1)
      assert.equal(id, 1n)
    })

    it('should return 0 for unregistered address', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderIdByAddress: () => [0n],
          },
        })
      )
      const id = await service.getProviderIdByAddress(Mocks.ADDRESSES.zero)
      assert.equal(id, 0n)
    })

    it('should check if provider is active', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const isActive = await service.isProviderActive(1n)
      assert.isTrue(isActive)

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            isProviderActive: () => [false],
          },
        })
      )
      const isInactive = await service.isProviderActive(999n)
      assert.isFalse(isInactive)
    })

    it('should check if address is registered provider', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const isRegistered = await service.isRegisteredProvider(Mocks.ADDRESSES.serviceProvider1)
      assert.isTrue(isRegistered)

      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            isRegisteredProvider: () => [false],
          },
        })
      )
      const isNotRegistered = await service.isRegisteredProvider(Mocks.ADDRESSES.zero)
      assert.isFalse(isNotRegistered)
    })

    it('should get provider count', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const count = await service.getProviderCount()
      assert.equal(count, 2n)
    })
  })

  describe('Provider Write Operations', () => {
    it('should register new provider', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const hash = await service.registerProvider(walletClient, {
        payee: walletClient.account.address,
        name: 'New Provider',
        description: 'Description',
        pdpOffering: {
          serviceURL: 'https://new-provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: true,
          ipniIpfs: false,
          ipniPeerId: '',
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US-EAST',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      })
      assert.exists(hash, 'Transaction should exist')
      assert.ok(hash.startsWith('0x'))
    })

    it('should update provider info', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const hash = await service.updateProviderInfo(walletClient, 'Updated Name', 'Updated Description')
      assert.exists(hash)
      assert.ok(hash.startsWith('0x'))
    })

    it('should remove provider', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const hash = await service.removeProvider(walletClient)
      assert.exists(hash)
      assert.ok(hash.startsWith('0x'))
    })
  })

  describe('Product Operations', () => {
    it('should get provider products', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const provider = await service.getProvider(1n)
      assert.exists(provider)
      assert.exists(provider.pdp)

      const product = provider.pdp
      assert.exists(product)
      assert.equal(product.serviceURL, 'https://pdp.example.com')
    })

    it('should decode PDP product data', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const provider = await service.getProvider(1n)
      const product = provider?.pdp

      assert.exists(product)
      assert.equal(product.serviceURL, 'https://pdp.example.com')
      assert.equal(product.minPieceSizeInBytes, SIZE_CONSTANTS.KiB)
      assert.equal(product.maxPieceSizeInBytes, SIZE_CONSTANTS.GiB)
      assert.isFalse(product.ipniPiece)
      assert.isFalse(product.ipniIpfs)
      assert.equal(product.location, 'US')
    })

    it('should add new product', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const pdpData = {
        serviceURL: 'https://new.example.com',
        minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
        maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
        ipniPiece: true,
        ipniIpfs: false,
        ipniPeerId: '',
        storagePricePerTibPerDay: BigInt(1000000),
        minProvingPeriodInEpochs: 2880n,
        location: 'US-WEST',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      } as const

      const hash = await service.addPDPProduct(walletClient, pdpData)
      assert.exists(hash)
      assert.ok(hash.startsWith('0x'))
    })

    it('should update existing product', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const pdpData = {
        serviceURL: 'https://updated.example.com',
        minPieceSizeInBytes: SIZE_CONSTANTS.KiB * 2n,
        maxPieceSizeInBytes: SIZE_CONSTANTS.GiB * 2n,
        ipniPiece: true,
        ipniIpfs: true,
        ipniPeerId: '',
        storagePricePerTibPerDay: BigInt(2000000),
        minProvingPeriodInEpochs: 2880n,
        location: 'EU-WEST',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      } as const

      const hash = await service.updatePDPProduct(walletClient, pdpData)
      assert.exists(hash)
      assert.ok(hash.startsWith('0x'))
    })

    it('should remove product', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const hash = await service.removeProduct(walletClient, PRODUCTS.PDP)
      assert.exists(hash)
      assert.ok(hash.startsWith('0x'))
    })
  })

  describe('Batch Operations', () => {
    it('should get multiple providers in batch', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const providers = await service.getProviders([1n, 2n, 3n])
      assert.isArray(providers)
      assert.equal(providers.length, 2) // Only IDs 1 and 2 exist in our mock
      assert.exists(providers[0]) // ID 1 exists
      assert.equal(providers[0].id, 1n)
      assert.exists(providers[1]) // ID 2 exists
      assert.equal(providers[1].id, 2n)
    })

    it('should handle empty provider ID list', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const providers = await service.getProviders([])
      assert.isArray(providers)
      assert.equal(providers.length, 0)
    })
  })

  describe('Provider Info Conversion', () => {
    it('should extract serviceURL from first PDP product', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))
      const provider = await service.getProvider(1n)
      assert.exists(provider)
      assert.equal(provider?.pdp?.serviceURL, 'https://pdp.example.com')
    })
  })

  describe('Error Handling', () => {
    it('should handle contract call failures gracefully', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderWithProduct: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )

      try {
        const provider = await service.getProvider(1n)
        assert.isNull(provider)
      } catch (error: any) {
        assert.include((error as Error).message, 'Contract call failed')
      }
    })

    it('should handle invalid product data', async () => {
      server.use(
        Mocks.JSONRPC({
          ...Mocks.presets.basic,
          debug: false,
          serviceRegistry: {
            ...Mocks.presets.basic.serviceRegistry,
            getProviderWithProduct: () => [
              {
                providerId: 1n,
                providerInfo: {
                  serviceProvider: Mocks.ADDRESSES.serviceProvider1,
                  payee: Mocks.ADDRESSES.payee1,
                  name: 'Test Provider',
                  description: 'Test Provider',
                  isActive: true,
                },
                product: {
                  productType: 0,
                  capabilityKeys: [],
                  isActive: false,
                },
                productCapabilityValues: [],
              },
            ],
          },
        })
      )
      try {
        await service.getProvider(1n)
      } catch (error: any) {
        assert.instanceOf(error, ZodValidationError)
        assert.include(error.details, 'Invalid hex value')
      }
    })
  })

  describe('Provider Filtering', () => {
    it('should filter providers by multiple criteria', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))

      // Test location filtering (case-insensitive partial match)
      const byLocation = await service.filterProviders({ location: 'US' })
      assert.equal(byLocation.length, 2) // Both providers have 'US' location

      const byPrice = await service.filterProviders({ maxStoragePricePerTibPerDay: 999999 })
      assert.equal(byPrice.length, 0)

      // Test piece size filtering
      const byPieceSize = await service.filterProviders({
        minPieceSizeInBytes: Number(SIZE_CONSTANTS.KiB),
        maxPieceSizeInBytes: Number(SIZE_CONSTANTS.GiB),
      })
      assert.equal(byPieceSize.length, 2) // Both providers support this range

      // Test no filters returns all
      const all = await service.filterProviders()
      assert.equal(all.length, 2)
    })

    it('should randomize results when requested', async () => {
      server.use(Mocks.JSONRPC(Mocks.presets.basic))

      const results = []
      for (let i = 0; i < 5; i++) {
        const filtered = await service.filterProviders({ randomize: true })
        results.push(filtered.map((p) => p.serviceProvider))
      }

      // At least one result should have different order (with high probability)
      const firstOrder = JSON.stringify(results[0])
      const hasDifferentOrder = results.some((r) => JSON.stringify(r) !== firstOrder)
      assert.isTrue(hasDifferentOrder || results[0].length === 1, 'Results should be randomized')
    })
  })
})
