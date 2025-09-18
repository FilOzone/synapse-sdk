import type { MetadataEntry } from '../types.ts'
import { METADATA_KEYS } from './constants.ts'

// Metadata size and count limits from the contract
export const METADATA_LIMITS = {
  MAX_KEY_LENGTH: 32,
  MAX_VALUE_LENGTH: 128,
  MAX_KEYS_PER_DATASET: 10,
  MAX_KEYS_PER_PIECE: 5,
}

/**
 * Converts a metadata object to an ordered array of MetadataEntry objects.
 * Keys are sorted alphabetically for deterministic ordering.
 *
 * @param metadata - The metadata object to convert
 * @returns Array of MetadataEntry objects with sorted keys
 */
export function objectToEntries(metadata: Record<string, string>): MetadataEntry[] {
  return Object.entries(metadata)
    .sort(([a], [b]) => a.localeCompare(b)) // Deterministic ordering for signing
    .map(([key, value]) => ({ key, value }))
}

/**
 * Converts an array of MetadataEntry objects to a prototype-safe object.
 * Uses Object.create(null) to avoid prototype pollution risks.
 *
 * @param entries - Array of MetadataEntry objects
 * @returns A prototype-safe Record<string, string>
 */
export function entriesToObject(entries: MetadataEntry[]): Record<string, string> {
  const obj: Record<string, string> = Object.create(null)
  for (const { key, value } of entries) {
    obj[key] = value
  }
  return obj
}

/**
 * Validates metadata for data set creation against contract limits.
 * Throws descriptive errors if validation fails.
 *
 * @param metadata - The metadata to validate
 * @throws Error if metadata exceeds contract limits
 */
export function validateDataSetMetadata(metadata: MetadataEntry[]): void {
  if (metadata.length > METADATA_LIMITS.MAX_KEYS_PER_DATASET) {
    throw new Error(
      `Too many metadata keys for data set: ${metadata.length} (max: ${METADATA_LIMITS.MAX_KEYS_PER_DATASET})`
    )
  }

  for (const { key, value } of metadata) {
    if (key.length > METADATA_LIMITS.MAX_KEY_LENGTH) {
      throw new Error(
        `Metadata key "${key}" exceeds max length: ${key.length} bytes (max: ${METADATA_LIMITS.MAX_KEY_LENGTH})`
      )
    }
    if (value.length > METADATA_LIMITS.MAX_VALUE_LENGTH) {
      throw new Error(
        `Metadata value for key "${key}" exceeds max length: ${value.length} bytes (max: ${METADATA_LIMITS.MAX_VALUE_LENGTH})`
      )
    }
  }
}

/**
 * Validates metadata for piece addition against contract limits.
 * Throws descriptive errors if validation fails.
 *
 * @param metadata - The metadata to validate
 * @throws Error if metadata exceeds contract limits
 */
export function validatePieceMetadata(metadata: MetadataEntry[]): void {
  if (metadata.length > METADATA_LIMITS.MAX_KEYS_PER_PIECE) {
    throw new Error(`Too many metadata keys for piece: ${metadata.length} (max: ${METADATA_LIMITS.MAX_KEYS_PER_PIECE})`)
  }

  for (const { key, value } of metadata) {
    if (key.length > METADATA_LIMITS.MAX_KEY_LENGTH) {
      throw new Error(
        `Metadata key "${key}" exceeds max length: ${key.length} bytes (max: ${METADATA_LIMITS.MAX_KEY_LENGTH})`
      )
    }
    if (value.length > METADATA_LIMITS.MAX_VALUE_LENGTH) {
      throw new Error(
        `Metadata value for key "${key}" exceeds max length: ${value.length} bytes (max: ${METADATA_LIMITS.MAX_VALUE_LENGTH})`
      )
    }
  }
}

/**
 * Checks if a data set's metadata matches the requested metadata.
 *
 * The data set must contain all requested metadata entries with matching values.
 * The data set may have additional metadata entries that are not in the requested set.
 *
 * @param dataSetMetadata - The metadata from the data set
 * @param requestedMetadata - The metadata requirements to match
 * @returns true if all requested metadata entries are present with matching values
 */
export function metadataMatches(
  dataSetMetadata: Record<string, string>,
  requestedMetadata: Record<string, string>
): boolean {
  // If no metadata is requested, any data set matches
  const requestedKeys = Object.keys(requestedMetadata)
  if (requestedKeys.length === 0) {
    return true
  }

  // For each requested metadata entry, check if it exists in dataSet with same value
  for (const key of requestedKeys) {
    if (dataSetMetadata[key] !== requestedMetadata[key]) {
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
