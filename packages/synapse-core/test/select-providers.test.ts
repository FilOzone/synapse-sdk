import assert from 'assert'
import type { Hex } from 'viem'
import type { PDPProvider } from '../src/sp-registry/types.ts'
import type { SelectionDataSet } from '../src/warm-storage/location-types.ts'
import { selectProviders } from '../src/warm-storage/select-providers.ts'

/** Create a minimal PDPProvider fixture */
function makeProvider(id: bigint, serviceURL = `https://sp${id}.example.com`): PDPProvider {
  return {
    id,
    serviceProvider: `0x000000000000000000000000000000000000000${id}` as `0x${string}`,
    payee: '0x1000000000000000000000000000000000000001' as `0x${string}`,
    name: `Provider ${id}`,
    description: `Test provider ${id}`,
    isActive: true,
    pdp: {
      serviceURL,
      minPieceSizeInBytes: 1024n,
      maxPieceSizeInBytes: 32n * 1024n * 1024n * 1024n,
      storagePricePerTibPerDay: 1000000n,
      minProvingPeriodInEpochs: 30n,
      location: 'us-east',
      paymentTokenAddress: '0x0000000000000000000000000000000000000000' as Hex,
      ipniPiece: false,
      ipniIpfs: false,
    },
  }
}

/** Create a SelectionDataSet fixture */
function makeDataSet(
  overrides: Partial<SelectionDataSet> & { dataSetId: bigint; providerId: bigint }
): SelectionDataSet {
  return {
    metadata: {},
    activePieceCount: 0n,
    pdpEndEpoch: 0n,
    live: true,
    managed: true,
    ...overrides,
  }
}

describe('selectProviders', () => {
  const provider1 = makeProvider(1n)
  const provider2 = makeProvider(2n)
  const provider3 = makeProvider(3n)

  describe('basic selection', () => {
    it('returns empty when no providers available', () => {
      const result = selectProviders({
        providers: [],
        endorsedIds: new Set(),
        clientDataSets: [],
        metadata: {},
      })
      assert.equal(result.length, 0)
    })

    it('returns empty when all providers are excluded', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { excludeProviderIds: new Set([1n, 2n]) }
      )
      assert.equal(result.length, 0)
    })

    it('selects provider with new dataset when no existing datasets', () => {
      const result = selectProviders({
        providers: [provider1],
        endorsedIds: new Set(),
        clientDataSets: [],
        metadata: { source: 'app' },
      })
      assert.equal(result.length, 1)
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].dataSetId, null)
      assert.equal(result[0].endorsed, false)
    })

    it('respects count option', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { count: 2 }
      )
      assert.equal(result.length, 2)
    })

    it('returns fewer than count if not enough providers', () => {
      const result = selectProviders(
        {
          providers: [provider1],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { count: 3 }
      )
      assert.equal(result.length, 1)
    })

    it('selects different providers for each result', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { count: 3 }
      )
      const ids = result.map((r) => r.provider.id)
      assert.equal(new Set(ids).size, 3)
    })
  })

  describe('endorsed pool restriction', () => {
    it('restricts to endorsed providers when endorsedIds is non-empty', () => {
      const result = selectProviders({
        providers: [provider1, provider2, provider3],
        endorsedIds: new Set([1n]),
        clientDataSets: [],
        metadata: {},
      })
      assert.equal(result.length, 1)
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].endorsed, true)
    })

    it('prefers existing dataset on endorsed provider', () => {
      const result = selectProviders({
        providers: [provider1, provider2],
        endorsedIds: new Set([1n]),
        clientDataSets: [
          makeDataSet({
            dataSetId: 10n,
            providerId: 1n,
            metadata: { source: 'app' },
            activePieceCount: 5n,
          }),
          makeDataSet({
            dataSetId: 20n,
            providerId: 2n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
        ],
        metadata: { source: 'app' },
      })
      assert.equal(result.length, 1)
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].dataSetId, 10n)
      assert.equal(result[0].endorsed, true)
    })

    it('creates new dataset when endorsed provider has no matching datasets', () => {
      const result = selectProviders({
        providers: [provider1, provider2],
        endorsedIds: new Set([1n]),
        clientDataSets: [
          makeDataSet({
            dataSetId: 20n,
            providerId: 2n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
        ],
        metadata: { source: 'app' },
      })
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].dataSetId, null)
      assert.equal(result[0].endorsed, true)
    })

    it('ignores non-endorsed providers when endorsedIds is non-empty', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set([1n]),
          clientDataSets: [
            makeDataSet({
              dataSetId: 20n,
              providerId: 2n,
              metadata: { source: 'app' },
              activePieceCount: 10n,
            }),
          ],
          metadata: { source: 'app' },
        },
        { count: 3 }
      )
      assert.equal(result.length, 1)
      assert.equal(result[0].provider.id, 1n)
    })

    it('uses all providers when endorsedIds is empty', () => {
      const result = selectProviders({
        providers: [provider1, provider2],
        endorsedIds: new Set(),
        clientDataSets: [
          makeDataSet({
            dataSetId: 20n,
            providerId: 2n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
        ],
        metadata: { source: 'app' },
      })
      assert.equal(result[0].provider.id, 2n)
      assert.equal(result[0].dataSetId, 20n)
      assert.equal(result[0].endorsed, false)
    })

    it('creates new dataset when pool is unrestricted and no matching datasets', () => {
      const result = selectProviders({
        providers: [provider1, provider2],
        endorsedIds: new Set(),
        clientDataSets: [],
        metadata: { source: 'app' },
      })
      assert.equal(result.length, 1)
      assert.equal(result[0].dataSetId, null)
      assert.equal(result[0].endorsed, false)
    })
  })

  describe('multi-provider selection', () => {
    it('selects multiple providers from the same pool', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: { source: 'app' },
        },
        { count: 2 }
      )
      assert.equal(result.length, 2)
      assert.notEqual(result[0].provider.id, result[1].provider.id)
    })

    it('reuses existing datasets across multiple providers', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2],
          endorsedIds: new Set(),
          clientDataSets: [
            makeDataSet({
              dataSetId: 10n,
              providerId: 1n,
              metadata: { source: 'app' },
              activePieceCount: 5n,
            }),
            makeDataSet({
              dataSetId: 20n,
              providerId: 2n,
              metadata: { source: 'app' },
              activePieceCount: 3n,
            }),
          ],
          metadata: { source: 'app' },
        },
        { count: 2 }
      )
      assert.equal(result.length, 2)
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].dataSetId, 10n)
      assert.equal(result[1].provider.id, 2n)
      assert.equal(result[1].dataSetId, 20n)
    })

    it('falls through to new dataset when existing datasets are exhausted', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2],
          endorsedIds: new Set(),
          clientDataSets: [
            makeDataSet({
              dataSetId: 10n,
              providerId: 1n,
              metadata: { source: 'app' },
              activePieceCount: 5n,
            }),
          ],
          metadata: { source: 'app' },
        },
        { count: 2 }
      )
      assert.equal(result.length, 2)
      // First: existing dataset
      assert.equal(result[0].dataSetId, 10n)
      // Second: new dataset
      assert.equal(result[1].provider.id, 2n)
      assert.equal(result[1].dataSetId, null)
    })
  })

  describe('dataset preference', () => {
    it('prefers dataset with pieces over empty dataset on same provider', () => {
      const result = selectProviders({
        providers: [provider1],
        endorsedIds: new Set(),
        clientDataSets: [
          makeDataSet({
            dataSetId: 5n,
            providerId: 1n,
            metadata: { source: 'app' },
            activePieceCount: 0n,
          }),
          makeDataSet({
            dataSetId: 10n,
            providerId: 1n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
        ],
        metadata: { source: 'app' },
      })
      assert.equal(result[0].dataSetId, 10n)
    })

    it('prefers older dataset when both have pieces', () => {
      const result = selectProviders({
        providers: [provider1],
        endorsedIds: new Set(),
        clientDataSets: [
          makeDataSet({
            dataSetId: 10n,
            providerId: 1n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
          makeDataSet({
            dataSetId: 5n,
            providerId: 1n,
            metadata: { source: 'app' },
            activePieceCount: 3n,
          }),
        ],
        metadata: { source: 'app' },
      })
      assert.equal(result[0].dataSetId, 5n)
    })
  })

  describe('metadata filtering', () => {
    it('only considers datasets matching requested metadata', () => {
      const result = selectProviders({
        providers: [provider1, provider2],
        endorsedIds: new Set(),
        clientDataSets: [
          makeDataSet({
            dataSetId: 10n,
            providerId: 1n,
            metadata: { env: 'prod' },
            activePieceCount: 5n,
          }),
          makeDataSet({
            dataSetId: 20n,
            providerId: 2n,
            metadata: { env: 'test' },
            activePieceCount: 5n,
          }),
        ],
        metadata: { env: 'test' },
      })
      assert.equal(result[0].provider.id, 2n)
      assert.equal(result[0].dataSetId, 20n)
    })

    it('creates new dataset when metadata does not match any existing', () => {
      const result = selectProviders({
        providers: [provider1],
        endorsedIds: new Set(),
        clientDataSets: [
          makeDataSet({
            dataSetId: 10n,
            providerId: 1n,
            metadata: { env: 'prod' },
          }),
        ],
        metadata: { env: 'test' },
      })
      assert.equal(result[0].provider.id, 1n)
      assert.equal(result[0].dataSetId, null)
    })
  })

  describe('exclusion', () => {
    it('excludes specified provider IDs', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { excludeProviderIds: new Set([1n]) }
      )
      assert.equal(result.length, 1)
      assert.notEqual(result[0].provider.id, 1n)
    })

    it('excludes endorsed provider when specified', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2],
          endorsedIds: new Set([1n]),
          clientDataSets: [],
          metadata: {},
        },
        { excludeProviderIds: new Set([1n]) }
      )
      // Provider 1 excluded, and endorsedIds restricts pool to only endorsed
      // So no providers are eligible
      assert.equal(result.length, 0)
    })
  })

  describe('endorsed flag on results', () => {
    it('marks endorsed providers correctly', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2, provider3],
          endorsedIds: new Set([2n]),
          clientDataSets: [],
          metadata: {},
        },
        { count: 3 }
      )
      // Only provider 2 is endorsed, and endorsedIds restricts the pool
      assert.equal(result.length, 1)
      assert.equal(result[0].provider.id, 2n)
      assert.equal(result[0].endorsed, true)
    })

    it('marks all as non-endorsed when endorsedIds is empty', () => {
      const result = selectProviders(
        {
          providers: [provider1, provider2],
          endorsedIds: new Set(),
          clientDataSets: [],
          metadata: {},
        },
        { count: 2 }
      )
      assert.ok(result.every((r) => !r.endorsed))
    })
  })
})
