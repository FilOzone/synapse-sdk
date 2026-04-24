import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getPDPProviders, getPDPProvidersByIds } from '../src/sp-registry/get-pdp-providers.ts'

describe('getPDPProviders (actions)', () => {
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

  describe('getPDPProviders (with mocked RPC)', () => {
    it('should return paginated PDPProvider[] with defaults', async () => {
      server.use(JSONRPC(presets.basic))

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const result = await getPDPProviders(client, { onlyActive: true })

      assert.equal(result.providers.length, 2)
      assert.equal(result.hasMore, false)
      assert.equal(result.providers[0].id, 1n)
      assert.equal(result.providers[0].pdp.serviceURL, 'https://pdp.example.com')
    })
  })

  describe('getPDPProvidersByIds (with mocked RPC)', () => {
    it('should drop providers whose PDP product is inactive or empty', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => {
              // provider 1: active PDP product
              if (providerId === 1n) {
                return [
                  {
                    providerId,
                    providerInfo: {
                      serviceProvider: ADDRESSES.serviceProvider1,
                      payee: ADDRESSES.payee1,
                      isActive: true,
                      name: 'Provider 1',
                      description: 'Provider 1',
                    },
                    product: {
                      productType,
                      capabilityKeys: [
                        'serviceURL',
                        'minPieceSizeInBytes',
                        'maxPieceSizeInBytes',
                        'storagePricePerTibPerDay',
                        'minProvingPeriodInEpochs',
                        'location',
                        'paymentTokenAddress',
                      ],
                      isActive: true,
                    },
                    productCapabilityValues: presets.basic.serviceRegistry.getProviderWithProduct([
                      providerId,
                      productType,
                    ])[0].productCapabilityValues,
                  },
                ]
              }
              // provider 2: product exists but inactive
              if (providerId === 2n) {
                return [
                  {
                    providerId,
                    providerInfo: {
                      serviceProvider: ADDRESSES.serviceProvider2,
                      payee: ADDRESSES.payee1,
                      isActive: true,
                      name: 'Provider 2',
                      description: 'Provider 2',
                    },
                    product: {
                      productType,
                      capabilityKeys: ['serviceURL'],
                      isActive: false,
                    },
                    productCapabilityValues: ['0x'],
                  },
                ]
              }
              // provider 3: default-initialized product (empty capability keys)
              return [
                {
                  providerId,
                  providerInfo: {
                    serviceProvider: ADDRESSES.zero,
                    payee: ADDRESSES.zero,
                    isActive: false,
                    name: '',
                    description: '',
                  },
                  product: {
                    productType,
                    capabilityKeys: [],
                    isActive: false,
                  },
                  productCapabilityValues: [],
                },
              ]
            },
          },
        })
      )

      const client = createPublicClient({
        chain: calibration,
        transport: http(),
      })

      const providers = await getPDPProvidersByIds(client, { providerIds: [1n, 2n, 3n] })

      assert.equal(providers.length, 1)
      assert.equal(providers[0].id, 1n)
    })
  })
})
