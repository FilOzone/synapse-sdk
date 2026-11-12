import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http as mswHttp } from 'msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, PROVIDERS, presets } from '../src/mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry, type ProviderDecoded } from '../src/mocks/jsonrpc/service-registry.ts'
import { getApprovedPDPProviders, getPDPProviders, getPDPProvidersByIds } from '../src/sp-registry/get-pdp-providers.ts'

function hasCause(error: unknown, name: string): boolean {
  let cause = error
  while (cause instanceof Error) {
    if (cause.name === name) {
      return true
    }
    cause = cause.cause
  }
  return false
}

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

      assert.equal(result.items.length, 2)
      assert.equal(result.nextCursor, undefined)
      assert.equal(result.items[0].id, 1n)
      assert.equal(result.items[0].pdp.serviceURL, 'https://pdp.example.com')
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

    it('should skip provider IDs that do not exist', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => {
              if (providerId === 2n) {
                throw new Error('Provider does not exist')
              }
              if (providerId === 3n) {
                throw new Error('Provider not found')
              }
              return presets.basic.serviceRegistry.getProviderWithProduct([providerId, productType])
            },
          },
        })
      )

      const client = createPublicClient({ chain: calibration, transport: http() })
      const providers = await getPDPProvidersByIds(client, { providerIds: [1n, 2n, 3n] })

      assert.deepEqual(
        providers.map(({ id }) => id),
        [1n]
      )
    })

    it('should reject when a provider read reverts unexpectedly', async () => {
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: {
            ...presets.basic.serviceRegistry,
            getProviderWithProduct: ([providerId, productType]) => {
              if (providerId === 2n) {
                throw new Error('Something else broke')
              }
              return presets.basic.serviceRegistry.getProviderWithProduct([providerId, productType])
            },
          },
        })
      )

      const client = createPublicClient({ chain: calibration, transport: http() })

      await assert.rejects(getPDPProvidersByIds(client, { providerIds: [1n, 2n] }), /Something else broke/)
    })

    it('should reject when the RPC request fails', async () => {
      server.use(
        mswHttp.post('https://api.calibration.node.glif.io/rpc/v1', () =>
          HttpResponse.json({ error: 'upstream unavailable' }, { status: 503 })
        )
      )

      const client = createPublicClient({ chain: calibration, transport: http(undefined, { retryCount: 0 }) })

      await assert.rejects(getPDPProvidersByIds(client, { providerIds: [1n, 2n] }), (error: Error) => {
        assert.ok(hasCause(error, 'HttpRequestError'), `expected HttpRequestError in cause chain, got ${error}`)
        return true
      })
    })

    it('should reject with the AbortError in the cause chain when the signal is aborted', async () => {
      server.use(JSONRPC(presets.basic))

      const controller = new AbortController()
      controller.abort()
      const client = createPublicClient({
        chain: calibration,
        transport: http(undefined, { retryCount: 0, fetchOptions: { signal: controller.signal } }),
      })

      await assert.rejects(getPDPProvidersByIds(client, { providerIds: [1n, 2n] }), (error: Error) => {
        assert.ok(hasCause(error, 'AbortError'), `expected AbortError in cause chain, got ${error}`)
        return true
      })
    })
  })

  describe('getApprovedPDPProviders (with mocked RPC)', () => {
    it('traverses multiple provider and approved-ID pages before intersecting them', async () => {
      const providers: ProviderDecoded[] = Array.from({ length: 101 }, (_, index) => ({
        ...PROVIDERS.provider1,
        providerId: BigInt(index + 1),
        providerInfo: {
          ...PROVIDERS.provider1.providerInfo,
          name: `Provider ${index + 1}`,
        },
      }))
      const approvedIds = providers.map(({ providerId }) => providerId)
      server.use(
        JSONRPC({
          ...presets.basic,
          serviceRegistry: mockServiceProviderRegistry(providers),
          warmStorageView: {
            ...presets.basic.warmStorageView,
            getApprovedProviders: ([offset, limit]) => [approvedIds.slice(Number(offset), Number(offset + limit))],
          },
        })
      )

      const client = createPublicClient({ chain: calibration, transport: http() })
      const result = await getApprovedPDPProviders(client)

      assert.equal(result.length, 101)
      assert.deepEqual(
        result.map(({ id }) => id),
        approvedIds
      )
    })
  })
})
