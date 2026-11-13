import assert from 'assert'
import { setup } from 'iso-web/msw'
import { HttpResponse, http } from 'msw'
import { createPublicClient, http as viemHttp } from 'viem'
import { calibration } from '../src/chains.ts'
import { NoEndorsedProviderError } from '../src/errors/warm-storage.ts'
import { PING } from '../src/mocks/common.ts'
import { ADDRESSES, JSONRPC, PROVIDERS, presets } from '../src/mocks/jsonrpc/index.ts'
import { mockServiceProviderRegistry } from '../src/mocks/jsonrpc/service-registry.ts'
import { selectReachableProviders } from '../src/warm-storage/select-reachable-providers.ts'

const providers = [PROVIDERS.provider1, PROVIDERS.provider2]
const url1 = PROVIDERS.provider1.products[0].offering.serviceURL
const url2 = PROVIDERS.provider2.products[0].offering.serviceURL

describe('selectReachableProviders', () => {
  const server = setup()
  const client = createPublicClient({ chain: calibration, transport: viemHttp() })
  let endorsedIds: bigint[] = []

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    endorsedIds = []
    server.resetHandlers()
    server.use(
      JSONRPC({
        ...presets.basic,
        serviceRegistry: mockServiceProviderRegistry(providers),
        endorsements: { getProviderIds: () => [endorsedIds] },
        warmStorageView: { ...presets.basic.warmStorageView, getClientDataSets: () => [[]] },
      }),
      PING({ baseUrl: url1 }),
      PING({ baseUrl: url2 })
    )
  })

  it('returns reachable providers up to count', async () => {
    const result = await selectReachableProviders(client, { address: ADDRESSES.client1, count: 2 })
    assert.deepEqual(
      result.map((r) => r.provider.id),
      [1n, 2n]
    )
    assert.ok(result.every((r) => r.dataSetId === null))
  })

  it('skips a provider that fails its ping', async () => {
    server.use(http.get(`${url1}/pdp/ping`, () => new HttpResponse(null, { status: 500 })))
    const result = await selectReachableProviders(client, { address: ADDRESSES.client1, count: 2 })
    assert.deepEqual(
      result.map((r) => r.provider.id),
      [2n]
    )
  })

  it('returns empty when every provider is unreachable', async () => {
    server.use(
      http.get(`${url1}/pdp/ping`, () => HttpResponse.error()),
      http.get(`${url2}/pdp/ping`, () => HttpResponse.error())
    )
    const result = await selectReachableProviders(client, { address: ADDRESSES.client1, count: 2 })
    assert.equal(result.length, 0)
  })

  it('honors excludeProviderIds', async () => {
    const result = await selectReachableProviders(client, {
      address: ADDRESSES.client1,
      count: 2,
      excludeProviderIds: [1n],
    })
    assert.deepEqual(
      result.map((r) => r.provider.id),
      [2n]
    )
  })

  it('puts an endorsed provider first with requireEndorsedPrimary', async () => {
    endorsedIds = [2n]
    const result = await selectReachableProviders(client, {
      address: ADDRESSES.client1,
      count: 2,
      requireEndorsedPrimary: true,
    })
    assert.deepEqual(
      result.map((r) => [r.provider.id, r.endorsed]),
      [
        [2n, true],
        [1n, false],
      ]
    )
  })

  it('flags endorsed providers selected for secondary slots', async () => {
    endorsedIds = [1n]
    const result = await selectReachableProviders(client, { address: ADDRESSES.client1, count: 2 })
    assert.deepEqual(
      result.map((r) => [r.provider.id, r.endorsed]),
      [
        [1n, true],
        [2n, false],
      ]
    )
  })

  it('keeps rank order when a lower-ranked endorsed provider answers first', async () => {
    endorsedIds = [1n, 2n]
    const { promise: firstPing, resolve: releaseFirst } = Promise.withResolvers<void>()
    server.use(
      http.get(`${url1}/pdp/ping`, async () => {
        await firstPing
        return new HttpResponse(null, { status: 200 })
      }),
      http.get(`${url2}/pdp/ping`, () => {
        releaseFirst()
        return new HttpResponse(null, { status: 200 })
      })
    )
    const result = await selectReachableProviders(client, {
      address: ADDRESSES.client1,
      requireEndorsedPrimary: true,
    })
    assert.equal(result[0].provider.id, 1n)
  })

  /** Holds pings to `baseUrl` open until the test ends, and records their request signals. */
  function holdPings(baseUrl: string) {
    const release = Promise.withResolvers<void>()
    const signals: AbortSignal[] = []
    const fetch = globalThis.fetch
    // MSW in the browser does not forward client aborts to the handler, so
    // read the signal from the client side.
    globalThis.fetch = (input, init) => {
      if (input instanceof Request && input.url.startsWith(baseUrl)) signals.push(input.signal)
      return fetch(input, init)
    }
    server.use(
      http.get(`${baseUrl}/pdp/ping`, async () => {
        await release.promise
        return new HttpResponse(null, { status: 200 })
      })
    )
    return {
      signals,
      [Symbol.dispose]() {
        globalThis.fetch = fetch
        release.resolve()
      },
    }
  }

  it('aborts lower-ranked endorsed pings once a winner answers', async () => {
    endorsedIds = [1n, 2n]
    using held = holdPings(url2)
    const result = await selectReachableProviders(client, {
      address: ADDRESSES.client1,
      requireEndorsedPrimary: true,
    })
    assert.equal(result[0].provider.id, 1n)
    assert.equal(held.signals.length, 1)
    assert.equal(held.signals[0].aborted, true)
  })

  it('passes the timeout to each ping', async () => {
    using held = holdPings(url1)
    const result = await selectReachableProviders(client, { address: ADDRESSES.client1, timeout: 50 })
    assert.equal(result[0].provider.id, 2n)
    assert.equal(held.signals[0]?.aborted, true)
  })

  it('throws NoEndorsedProviderError when no provider is endorsed', async () => {
    await assert.rejects(
      selectReachableProviders(client, { address: ADDRESSES.client1, requireEndorsedPrimary: true }),
      (error: unknown) => {
        assert.ok(NoEndorsedProviderError.is(error))
        assert.equal(error.failures.length, 0)
        assert.equal(error.shortMessage, 'No endorsed provider available')
        return true
      }
    )
  })

  it('throws NoEndorsedProviderError with ping failures, without falling back', async () => {
    endorsedIds = [1n]
    server.use(http.get(`${url1}/pdp/ping`, () => HttpResponse.error()))
    await assert.rejects(
      selectReachableProviders(client, { address: ADDRESSES.client1, requireEndorsedPrimary: true }),
      (error: unknown) => {
        assert.ok(NoEndorsedProviderError.is(error))
        assert.equal(error.failures.length, 1)
        assert.equal(error.failures[0].location.provider.id, 1n)
        assert.match(error.message, /failed health check/)
        assert.match(error.details ?? '', /\(ID: 1\)/)
        return true
      }
    )
  })

  it('throws when the signal is aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await assert.rejects(
      selectReachableProviders(client, { address: ADDRESSES.client1, signal: controller.signal }),
      (error: unknown) => error instanceof Error && error.name === 'AbortError'
    )
  })
})
