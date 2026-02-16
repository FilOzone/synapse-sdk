import assert from 'assert'
import { findMatchingDataSets, metadataMatches } from '../src/warm-storage/find-matching-data-sets.ts'
import type { SelectionDataSet } from '../src/warm-storage/location-types.ts'

/** Helper to create a SelectionDataSet with sensible defaults */
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

describe('metadataMatches', () => {
  it('matches identical metadata', () => {
    assert.equal(metadataMatches({ source: 'app', env: 'prod' }, { source: 'app', env: 'prod' }), true)
  })

  it('matches empty metadata', () => {
    assert.equal(metadataMatches({}, {}), true)
  })

  it('rejects different values', () => {
    assert.equal(metadataMatches({ source: 'app' }, { source: 'other' }), false)
  })

  it('rejects extra keys in dataset', () => {
    assert.equal(metadataMatches({ source: 'app', extra: 'val' }, { source: 'app' }), false)
  })

  it('rejects missing keys in dataset', () => {
    assert.equal(metadataMatches({ source: 'app' }, { source: 'app', extra: 'val' }), false)
  })

  it('rejects when dataset has keys but requested is empty', () => {
    assert.equal(metadataMatches({ source: 'app' }, {}), false)
  })

  it('rejects when requested has keys but dataset is empty', () => {
    assert.equal(metadataMatches({}, { source: 'app' }), false)
  })

  it('is order-independent', () => {
    assert.equal(metadataMatches({ b: '2', a: '1', c: '3' }, { c: '3', a: '1', b: '2' }), true)
  })
})

describe('findMatchingDataSets', () => {
  it('returns empty array when no datasets match metadata', () => {
    const dataSets = [makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'other' } })]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result.length, 0)
  })

  it('returns matching datasets', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'app' } }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'other' } }),
      makeDataSet({ dataSetId: 3n, providerId: 3n, metadata: { source: 'app' } }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result.length, 2)
    assert.equal(result[0].dataSetId, 1n)
    assert.equal(result[1].dataSetId, 3n)
  })

  it('sorts datasets with pieces before empty ones', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'app' }, activePieceCount: 0n }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'app' }, activePieceCount: 5n }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result[0].dataSetId, 2n)
    assert.equal(result[1].dataSetId, 1n)
  })

  it('sorts by ID ascending within same piece group', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 10n, providerId: 1n, metadata: { source: 'app' }, activePieceCount: 3n }),
      makeDataSet({ dataSetId: 5n, providerId: 2n, metadata: { source: 'app' }, activePieceCount: 3n }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result[0].dataSetId, 5n)
    assert.equal(result[1].dataSetId, 10n)
  })

  it('excludes terminated datasets (pdpEndEpoch > 0)', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'app' }, pdpEndEpoch: 100n }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'app' }, pdpEndEpoch: 0n }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result.length, 1)
    assert.equal(result[0].dataSetId, 2n)
  })

  it('excludes non-live datasets', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'app' }, live: false }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'app' }, live: true }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result.length, 1)
    assert.equal(result[0].dataSetId, 2n)
  })

  it('excludes non-managed datasets', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: { source: 'app' }, managed: false }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'app' }, managed: true }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    assert.equal(result.length, 1)
    assert.equal(result[0].dataSetId, 2n)
  })

  it('matches empty metadata against datasets with empty metadata', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 1n, providerId: 1n, metadata: {} }),
      makeDataSet({ dataSetId: 2n, providerId: 2n, metadata: { source: 'app' } }),
    ]
    const result = findMatchingDataSets(dataSets, {})
    assert.equal(result.length, 1)
    assert.equal(result[0].dataSetId, 1n)
  })

  it('returns empty array when input is empty', () => {
    const result = findMatchingDataSets([], { source: 'app' })
    assert.equal(result.length, 0)
  })

  it('full sorting: pieces first, then by ID within groups', () => {
    const dataSets = [
      makeDataSet({ dataSetId: 10n, providerId: 1n, metadata: { source: 'app' }, activePieceCount: 0n }),
      makeDataSet({ dataSetId: 5n, providerId: 2n, metadata: { source: 'app' }, activePieceCount: 3n }),
      makeDataSet({ dataSetId: 3n, providerId: 3n, metadata: { source: 'app' }, activePieceCount: 0n }),
      makeDataSet({ dataSetId: 8n, providerId: 4n, metadata: { source: 'app' }, activePieceCount: 7n }),
    ]
    const result = findMatchingDataSets(dataSets, { source: 'app' })
    // Pieces first (5n, 8n by ID ascending), then empty (3n, 10n by ID ascending)
    assert.deepEqual(
      result.map((ds) => ds.dataSetId),
      [5n, 8n, 3n, 10n]
    )
  })
})
