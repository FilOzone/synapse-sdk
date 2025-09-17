import type { MetadataEntry } from '../types.ts'
import { METADATA_KEYS } from './constants.ts'

/**
 * Checks if a data set's metadata matches the requested metadata.
 *
 * The data set must contain all requested metadata entries with matching values.
 * The data set may have additional metadata entries that are not in the requested set.
 * Order of entries does not matter.
 *
 * @param dataSetMetadata - The metadata from the data set
 * @param requestedMetadata - The metadata requirements to match
 * @returns true if all requested metadata entries are present with matching values
 */
export function metadataMatches(dataSetMetadata: MetadataEntry[], requestedMetadata: MetadataEntry[]): boolean {
  // If no metadata is requested, any data set matches
  if (requestedMetadata.length === 0) {
    return true
  }

  // For each requested metadata entry, check if it exists in dataSet with same value
  for (const requested of requestedMetadata) {
    const found = dataSetMetadata.find((m) => m.key === requested.key)
    if (found == null || found.value !== requested.value) {
      return false
    }
  }
  return true
}

/**
 * Converts a boolean withCDN flag to metadata format for backward compatibility.
 *
 * @param withCDN - Whether to request CDN support
 * @returns MetadataEntry array with withCDN key if true, empty array if false
 */
export function withCDNToMetadata(withCDN: boolean): MetadataEntry[] {
  if (withCDN) {
    return [{ key: METADATA_KEYS.WITH_CDN, value: '' }]
  }
  return []
}

/**
 * Checks if metadata contains the withCDN key.
 *
 * @param metadata - The metadata to check
 * @returns true if metadata contains withCDN key (regardless of value)
 */
export function hasWithCDN(metadata: MetadataEntry[]): boolean {
  return metadata.some((m) => m.key === METADATA_KEYS.WITH_CDN)
}
