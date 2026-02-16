import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { fetchProviderSelectionInput } from '../src/warm-storage/fetch-provider-selection-input.ts'

describe('fetchProviderSelectionInput', () => {
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

  it('assembles ProviderSelectionInput from chain data', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await fetchProviderSelectionInput(client, {
      address: ADDRESSES.client1,
      metadata: { env: 'test' },
    })

    // Providers fetched from approved PDP providers
    assert.ok(result.providers.length > 0)
    assert.ok(result.providers.every((p) => p.pdp != null))

    // Endorsed IDs from endorsements contract (empty in basic preset)
    assert.ok(result.endorsedIds instanceof Set)

    // Metadata passed through
    assert.deepEqual(result.metadata, { env: 'test' })

    // Client datasets populated with piece counts
    assert.ok(Array.isArray(result.clientDataSets))
  })

  it('returns empty clientDataSets when client has no datasets', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        warmStorageView: {
          ...presets.basic.warmStorageView,
          getClientDataSets: () => [[]],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await fetchProviderSelectionInput(client, {
      address: ADDRESSES.client1,
      metadata: {},
    })

    assert.equal(result.clientDataSets.length, 0)
    // Providers and endorsedIds still populated
    assert.ok(result.providers.length > 0)
    assert.ok(result.endorsedIds instanceof Set)
  })

  it('populates endorsedIds from endorsements contract', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        endorsements: {
          ...presets.basic.endorsements,
          getProviderIds: () => [[1n, 2n]],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await fetchProviderSelectionInput(client, {
      address: ADDRESSES.client1,
      metadata: {},
    })

    assert.ok(result.endorsedIds.has(1n))
    assert.ok(result.endorsedIds.has(2n))
    assert.equal(result.endorsedIds.size, 2)
  })
})
