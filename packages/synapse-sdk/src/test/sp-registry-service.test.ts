/* globals describe it beforeEach */
import { assert } from 'chai'
import { ethers } from 'ethers'
import { setup } from 'iso-web/msw'
import { SPRegistryService } from '../sp-registry/service.ts'
import { PRODUCTS } from '../sp-registry/types.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { ADDRESSES, JSONRPC, PRIVATE_KEYS, PROVIDERS, presets } from './mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry } from './mocks/jsonrpc/service-registry.ts'

// mock server for testing
const server = setup()

describe('SPRegistryService', () => {
  let provider: ethers.Provider
  let signer: ethers.Signer
  let service: SPRegistryService

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    provider = new ethers.JsonRpcProvider('https://api.calibration.node.glif.io/rpc/v1')
    signer = new ethers.Wallet(PRIVATE_KEYS.key1, provider)
    service = new SPRegistryService(provider, ADDRESSES.calibration.spRegistry)
  })

  describe('Constructor', () => {
    it('should create instance with provider and address', () => {
      server.use(JSONRPC(presets.basic))
      const instance = new SPRegistryService(provider, ADDRESSES.calibration.spRegistry)
      assert.exists(instance)
    })
  })

  describe('Provider Read Operations', () => {
    it('should get provider by ID', async () => {
      server.use(JSONRPC(presets.basic))
      const provider = await service.getProvider(1)
      assert.exists(provider)
      assert.equal(provider?.id, 1)
      assert.equal(provider?.serviceProvider, ADDRESSES.serviceProvider1)
      assert.equal(provider?.name, 'Test Provider')
      assert.equal(provider?.description, 'Test Provider')
      assert.isTrue(provider?.active)
    })

    it('should return null for non-existent provider', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProvider: () => [
              {
                providerId: 0n,
                info: {
                  serviceProvider: ADDRESSES.zero,
                  payee: ADDRESSES.zero,
                  isActive: false,
                  name: '',
                  description: '',
                },
              },
            ],
          },
        })
      )
      const provider = await service.getProvider(999)
      assert.isNull(provider)
    })

    it('should get provider by address', async () => {
      server.use(JSONRPC(presets.basic))
      const provider = await service.getProviderByAddress(ADDRESSES.serviceProvider1)
      assert.exists(provider)
      assert.equal(provider.id, 1)
      assert.equal(provider.serviceProvider, ADDRESSES.serviceProvider1)
    })

    it('should return null for unregistered address', async () => {
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
                  isActive: false,
                  name: '',
                  description: '',
                },
              },
            ],
          },
        })
      )
      const provider = await service.getProviderByAddress(ADDRESSES.zero)
      assert.isNull(provider)
    })

    it('should get provider ID by address', async () => {
      server.use(JSONRPC(presets.basic))
      const id = await service.getProviderIdByAddress(ADDRESSES.serviceProvider1)
      assert.equal(id, 1)
    })

    it('should return 0 for unregistered address', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderIdByAddress: () => [0n],
          },
        })
      )
      const id = await service.getProviderIdByAddress(ADDRESSES.zero)
      assert.equal(id, 0)
    })

    it('should check if provider is active', async () => {
      server.use(JSONRPC(presets.basic))
      const isActive = await service.isProviderActive(1)
      assert.isTrue(isActive)

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            isProviderActive: () => [false],
          },
        })
      )
      const isInactive = await service.isProviderActive(999)
      assert.isFalse(isInactive)
    })

    it('should check if address is registered provider', async () => {
      server.use(JSONRPC(presets.basic))
      const isRegistered = await service.isRegisteredProvider(ADDRESSES.serviceProvider1)
      assert.isTrue(isRegistered)

      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            isRegisteredProvider: () => [false],
          },
        })
      )
      const isNotRegistered = await service.isRegisteredProvider(ADDRESSES.zero)
      assert.isFalse(isNotRegistered)
    })

    it('should get provider count', async () => {
      server.use(JSONRPC(presets.basic))
      const count = await service.getProviderCount()
      assert.equal(count, 2)
    })
  })

  describe('Provider Write Operations', () => {
    it('should register new provider', async () => {
      server.use(JSONRPC(presets.basic))
      const tx = await service.registerProvider(signer, {
        payee: await signer.getAddress(),
        name: 'New Provider',
        description: 'Description',
        pdpOffering: {
          serviceURL: 'https://new-provider.example.com',
          minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
          maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
          ipniPiece: true,
          ipniIpfs: false,
          storagePricePerTibPerDay: BigInt(1000000),
          minProvingPeriodInEpochs: 2880n,
          location: 'US-EAST',
          paymentTokenAddress: '0x0000000000000000000000000000000000000000',
        },
      })
      assert.exists(tx, 'Transaction should exist')
      assert.exists(tx.hash, 'Transaction should have a hash')
    })

    it('should update provider info', async () => {
      server.use(JSONRPC(presets.basic))
      const tx = await service.updateProviderInfo(signer, 'Updated Name', 'Updated Description')
      assert.exists(tx)
      assert.exists(tx.hash)
    })

    it('should remove provider', async () => {
      server.use(JSONRPC(presets.basic))
      const tx = await service.removeProvider(signer)
      assert.exists(tx)
      assert.exists(tx.hash)
    })
  })

  describe('Product Operations', () => {
    it('should get provider products', async () => {
      server.use(JSONRPC(presets.basic))
      const provider = await service.getProvider(1)
      assert.exists(provider)
      assert.exists(provider?.products)
      assert.exists(provider?.products.PDP)

      const product = provider?.products.PDP
      assert.exists(product)
      assert.equal(product?.type, 'PDP')
      assert.isTrue(product?.isActive)
    })

    it('should decode PDP product data', async () => {
      server.use(JSONRPC(presets.basic))
      const provider = await service.getProvider(1)
      const product = provider?.products.PDP

      assert.exists(product)
      assert.equal(product?.type, 'PDP')

      if (product?.type === 'PDP') {
        assert.equal(product.data.serviceURL, 'https://pdp.example.com')
        assert.equal(product.data.minPieceSizeInBytes, SIZE_CONSTANTS.KiB)
        assert.equal(product.data.maxPieceSizeInBytes, SIZE_CONSTANTS.GiB)
        assert.isFalse(product.data.ipniPiece)
        assert.isFalse(product.data.ipniIpfs)
        assert.equal(product.data.location, 'US')
      }
    })

    it('should add new product', async () => {
      server.use(JSONRPC(presets.basic))
      const pdpData = {
        serviceURL: 'https://new.example.com',
        minPieceSizeInBytes: SIZE_CONSTANTS.KiB,
        maxPieceSizeInBytes: SIZE_CONSTANTS.GiB,
        ipniPiece: true,
        ipniIpfs: false,
        storagePricePerTibPerDay: BigInt(1000000),
        minProvingPeriodInEpochs: 2880n,
        location: 'US-WEST',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      } as const

      const tx = await service.addPDPProduct(signer, pdpData)
      assert.exists(tx)
      assert.exists(tx.hash)
    })

    it('should update existing product', async () => {
      server.use(JSONRPC(presets.basic))
      const pdpData = {
        serviceURL: 'https://updated.example.com',
        minPieceSizeInBytes: SIZE_CONSTANTS.KiB * 2n,
        maxPieceSizeInBytes: SIZE_CONSTANTS.GiB * 2n,
        ipniPiece: true,
        ipniIpfs: true,
        storagePricePerTibPerDay: BigInt(2000000),
        minProvingPeriodInEpochs: 2880n,
        location: 'EU-WEST',
        paymentTokenAddress: '0x0000000000000000000000000000000000000000',
      } as const

      const tx = await service.updatePDPProduct(signer, pdpData)
      assert.exists(tx)
      assert.exists(tx.hash)
    })

    it('should remove product', async () => {
      server.use(JSONRPC(presets.basic))
      const tx = await service.removeProduct(signer, PRODUCTS.PDP)
      assert.exists(tx)
      assert.exists(tx.hash)
    })
  })

  describe('Batch Operations', () => {
    it('should get multiple providers in batch', async () => {
      server.use(JSONRPC(presets.basic))
      const providers = await service.getProviders([1, 2, 3])
      assert.isArray(providers)
      assert.equal(providers.length, 2) // Only IDs 1 and 2 exist in our mock
      assert.exists(providers[0]) // ID 1 exists
      assert.equal(providers[0].id, 1)
      assert.exists(providers[1]) // ID 2 exists
      assert.equal(providers[1].id, 2)
    })

    it('should handle empty provider ID list', async () => {
      server.use(JSONRPC(presets.basic))
      const providers = await service.getProviders([])
      assert.isArray(providers)
      assert.equal(providers.length, 0)
    })
  })

  describe('Provider Info Conversion', () => {
    it('should extract serviceURL from first PDP product', async () => {
      server.use(JSONRPC(presets.basic))
      const provider = await service.getProvider(1)
      assert.exists(provider)
      assert.equal(provider?.products.PDP?.data.serviceURL, 'https://pdp.example.com')
    })

    it('should handle provider without PDP products', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry([PROVIDERS.providerNoPDP]),
        })
      )

      const provider = await service.getProvider(1)
      assert.exists(provider)
      assert.isUndefined(provider?.products.PDP)
    })
  })

  describe('Error Handling', () => {
    it('should handle contract call failures gracefully', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProvider: () => {
              throw new Error('Contract call failed')
            },
          },
        })
      )

      try {
        const provider = await service.getProvider(1)
        assert.isNull(provider)
      } catch (error: any) {
        assert.include((error as Error).message, 'Contract call failed')
      }
    })

    it('should handle invalid product data', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          debug: true,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: () => [
              {
                providerId: 1n,
                providerInfo: {
                  serviceProvider: ADDRESSES.serviceProvider1,
                  payee: ADDRESSES.payee1,
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
      const provider = await service.getProvider(1)
      assert.exists(provider)
      assert.exists(provider?.products)
      assert.isUndefined(provider?.products.PDP) // Product decoding failed, so no PDP product
    })
  })
})
