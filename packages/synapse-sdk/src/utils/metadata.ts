import { METADATA_KEYS } from './constants.ts'

/**
 * Checks if a data set's metadata exactly matches the requested metadata.
 *
 * The data set must contain exactly the same keys and values as requested.
 * Order doesn't matter, but the sets must be identical.
 *
 * @param dataSetMetadata - The metadata from the data set
 * @param requestedMetadata - The metadata requirements to match
 * @returns true if metadata sets are exactly equal (same keys and values)
 */
export function metadataMatches(
  dataSetMetadata: Record<string, string>,
  requestedMetadata: Record<string, string>
): boolean {
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
 * Combines metadata object with withCDN flag, ensuring consistent behavior.
 * If withCDN is true, adds the withCDN key only if not already present.
 * If withCDN is false or undefined, returns metadata unchanged.
 *
 * @param metadata - Base metadata object (can be empty)
 * @param withCDN - Whether to include CDN flag
 * @returns Combined metadata object
 */
export function combineMetadata(metadata: Record<string, string> = {}, withCDN?: boolean): Record<string, string> {
  // If no CDN preference or already has withCDN key, return as-is
  if (withCDN == null || METADATA_KEYS.WITH_CDN in metadata) {
    return metadata
  }

  // Add withCDN key only if explicitly requested
  if (withCDN) {
    return { ...metadata, [METADATA_KEYS.WITH_CDN]: '' }
  }

  return metadata
}
