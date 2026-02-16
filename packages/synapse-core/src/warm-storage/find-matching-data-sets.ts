import type { MetadataObject } from '../utils/metadata.ts'
import type { SelectionDataSet } from './location-types.ts'

/**
 * Check if a dataset's metadata exactly matches the requested metadata.
 *
 * Both sets must have identical keys and values. Order does not matter.
 * An empty requested metadata matches only datasets with empty metadata.
 *
 * @param dataSetMetadata - The metadata from the dataset
 * @param requestedMetadata - The metadata to match against
 * @returns true if metadata sets are exactly equal
 */
export function metadataMatches(dataSetMetadata: MetadataObject, requestedMetadata: MetadataObject): boolean {
  const dataSetKeys = Object.keys(dataSetMetadata)
  const requestedKeys = Object.keys(requestedMetadata)

  if (dataSetKeys.length !== requestedKeys.length) {
    return false
  }

  if (requestedKeys.length === 0) {
    return true
  }

  for (const key of requestedKeys) {
    if (dataSetMetadata[key] !== requestedMetadata[key]) {
      return false
    }
  }

  return true
}

/**
 * Find datasets matching the given metadata, sorted by preference.
 *
 * Matching is exact: a dataset matches only if its metadata keys and
 * values are identical to the requested metadata.
 *
 * Only active datasets are considered (live, managed, pdpEndEpoch === 0n).
 *
 * Sort order:
 *   1. Datasets with pieces (activePieceCount > 0) before empty datasets
 *   2. Within each group, older datasets (lower ID) first
 *
 * @param dataSets - Datasets to search (typically filtered to a single provider)
 * @param metadata - Desired metadata keys and values
 * @returns Matching datasets in preference order
 */
export function findMatchingDataSets(dataSets: SelectionDataSet[], metadata: MetadataObject): SelectionDataSet[] {
  const matching = dataSets.filter(
    (ds) => ds.live && ds.managed && ds.pdpEndEpoch === 0n && metadataMatches(ds.metadata, metadata)
  )

  return matching.sort((a, b) => {
    // Datasets with pieces sort before empty ones
    if (a.activePieceCount > 0n && b.activePieceCount === 0n) return -1
    if (b.activePieceCount > 0n && a.activePieceCount === 0n) return 1
    // Within same group, oldest dataset first (lower ID)
    return Number(a.dataSetId - b.dataSetId)
  })
}
