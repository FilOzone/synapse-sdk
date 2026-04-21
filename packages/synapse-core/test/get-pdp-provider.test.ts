import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPDPProvider, getPDPProviderByAddress } from '../src/sp-registry/get-pdp-provider.ts'

describe('getPDPProvider', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  describe('getPDPProvider (with mocked RPC)', () => {
    it('should return PDPProvider for provider with active PDP product', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProvider(client, { providerId: 1n })

      assert.notEqual(provider, null)
      assert.equal(provider?.id, 1n)
      assert.equal(provider?.name, 'Test Provider')
      assert.equal(provider?.pdp.serviceURL, 'https://pdp.example.com')
    })

    it('should return null when PDP product has no capability keys', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => [
              {
                providerId,
                providerInfo: {
                  serviceProvider: ADDRESSES.serviceProvider1,
                  payee: ADDRESSES.payee1,
                  isActive: true,
                  name: 'Test Provider',
                  description: 'Test Provider',
                },
                product: {
                  productType,
                  capabilityKeys: [],
                  isActive: true,
                },
                productCapabilityValues: [],
              },
            ],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProvider(client, { providerId: 1n })
      assert.equal(provider, null)
    })

    it('should return null when PDP product is inactive', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => [
              {
                providerId,
                providerInfo: {
                  serviceProvider: ADDRESSES.serviceProvider1,
                  payee: ADDRESSES.payee1,
                  isActive: true,
                  name: 'Test Provider',
                  description: 'Test Provider',
                },
                product: {
                  productType,
                  capabilityKeys: ['serviceURL'],
                  isActive: false,
                },
                productCapabilityValues: ['0x'],
              },
            ],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProvider(client, { providerId: 1n })
      assert.equal(provider, null)
    })
  })

  describe('getPDPProviderByAddress (with mocked RPC)', () => {
    it('should return PDPProvider when address is registered and has active PDP product', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProviderByAddress(client, {
        address: ADDRESSES.serviceProvider1,
      })

      assert.notEqual(provider, null)
      assert.equal(provider?.id, 1n)
    })

    it('should return null for unregistered address (providerId 0n)', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProviderByAddress(client, {
        address: '0x9999999999999999999999999999999999999999',
      })

      assert.equal(provider, null)
    })

    it('should return null when provider exists but has no active PDP product', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => [
              {
                providerId,
                providerInfo: {
                  serviceProvider: ADDRESSES.serviceProvider1,
                  payee: ADDRESSES.payee1,
                  isActive: true,
                  name: 'Test Provider',
                  description: 'Test Provider',
                },
                product: {
                  productType,
                  capabilityKeys: [],
                  isActive: false,
                },
                productCapabilityValues: [],
              },
            ],
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const provider = await getPDPProviderByAddress(client, {
        address: ADDRESSES.serviceProvider1,
      })

      assert.equal(provider, null)
    })
  })
})
