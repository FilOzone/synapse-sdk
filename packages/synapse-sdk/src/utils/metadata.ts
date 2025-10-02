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
 * Accepts both MetadataEntry[] and Record<string, string> formats.
 * Throws descriptive errors if validation fails.
 *
 * @param metadata - The metadata to validate (array or object)
 * @throws Error if metadata exceeds contract limits
 */
export function validateDataSetMetadata(metadata: MetadataEntry[] | Record<string, string>): void {
  // Convert to array format for validation
  const metadataArray = Array.isArray(metadata) ? metadata : objectToEntries(metadata)
  if (metadataArray.length > METADATA_LIMITS.MAX_KEYS_PER_DATASET) {
    throw new Error(
      `Too many metadata keys for data set: ${metadataArray.length} (max: ${METADATA_LIMITS.MAX_KEYS_PER_DATASET})`
    )
  }

  for (const { key, value } of metadataArray) {
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
 * Accepts both MetadataEntry[] and Record<string, string> formats.
 * Throws descriptive errors if validation fails.
 *
 * @param metadata - The metadata to validate (array or object)
 * @throws Error if metadata exceeds contract limits
 */
export function validatePieceMetadata(metadata: MetadataEntry[] | Record<string, string>): void {
  // Convert to array format for validation
  const metadataArray = Array.isArray(metadata) ? metadata : objectToEntries(metadata)
  if (metadataArray.length > METADATA_LIMITS.MAX_KEYS_PER_PIECE) {
    throw new Error(
      `Too many metadata keys for piece: ${metadataArray.length} (max: ${METADATA_LIMITS.MAX_KEYS_PER_PIECE})`
    )
  }

  for (const { key, value } of metadataArray) {
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
