import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { PDPProviderUnavailableError } from '../src/errors/warm-storage.ts'
import { ADDRESSES, JSONRPC, PROVIDERS, presets } from '../src/mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry } from '../src/mocks/jsonrpc/service-registry.ts'
import { resolveProviderLocations } from '../src/warm-storage/resolve-provider-locations.ts'

describe('resolveProviderLocations', () => {
  const server = setup()
  const client = createPublicClient({ chain: calibration, transport: http() })

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  let metadataReads = 0

  function useChain(options: { endorsedIds?: bigint[]; approvedIds?: bigint[] } = {}) {
    metadataReads = 0
    server.use(
      JSONRPC({
        ...presets.basic,
        serviceRegistry: mockServiceProviderRegistry([PROVIDERS.provider1, PROVIDERS.provider2]),
        endorsements: { getProviderIds: () => [options.endorsedIds ?? []] },
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getAllDataSetMetadata: () => {
            metadataReads++
            return [[], []]
          },
          ...(options.approvedIds == null ? {} : { getApprovedProviders: () => [options.approvedIds ?? []] }),
        },
      })
    )
  }

  beforeEach(() => {
    server.resetHandlers()
  })

  it("returns the provider's matching data set", async () => {
    useChain()
    const [location] = await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [1n] })
    assert.equal(location.provider.id, 1n)
    assert.equal(location.dataSetId, 1n)
    assert.equal(location.clientDataSetId, 0n)
    assert.equal(location.endorsed, false)
  })

  it('returns a new data set location when no data set matches the metadata', async () => {
    useChain()
    const [location] = await resolveProviderLocations(client, {
      address: ADDRESSES.client1,
      providerIds: [1n],
      metadata: { source: 'app' },
    })
    assert.equal(location.provider.id, 1n)
    assert.equal(location.dataSetId, null)
    assert.equal(location.clientDataSetId, null)
    assert.deepEqual(location.dataSetMetadata, { source: 'app' })
  })

  it("ignores other providers' data sets", async () => {
    useChain()
    const [location] = await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [2n] })
    assert.equal(location.provider.id, 2n)
    assert.equal(location.dataSetId, null)
  })

  it('resolves a provider that is not approved', async () => {
    useChain({ approvedIds: [1n] })
    const [location] = await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [2n] })
    assert.equal(location.provider.id, 2n)
  })

  it('flags an endorsed provider', async () => {
    useChain({ endorsedIds: [1n] })
    const [location] = await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [1n] })
    assert.equal(location.endorsed, true)
  })

  it('resolves several providers in order from one data set read', async () => {
    useChain()
    const locations = await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [2n, 1n] })
    assert.deepEqual(
      locations.map((l) => [l.provider.id, l.dataSetId]),
      [
        [2n, null],
        [1n, 1n],
      ]
    )
    assert.equal(metadataReads, 1)
  })

  it('returns no locations for no provider IDs', async () => {
    useChain()
    assert.deepEqual(await resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [] }), [])
  })

  it('throws PDPProviderUnavailableError for an unknown provider', async () => {
    useChain()
    await assert.rejects(
      resolveProviderLocations(client, { address: ADDRESSES.client1, providerIds: [1n, 999n] }),
      (error: unknown) => {
        assert.ok(PDPProviderUnavailableError.is(error))
        assert.equal(error.providerId, 999n)
        return true
      }
    )
  })
})
