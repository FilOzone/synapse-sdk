export type MetadataEntry = {
  readonly key: string
  readonly value: string
}

/**
 * The metadata array is a tuple of two arrays: the keys and the values.
 * Return type from the getAllDataSetMetadata function.
 *
 * @example ['key1', 'key2'], ['value1', 'value2']
 */
export type MetadataArray = readonly [readonly string[], readonly string[]]

export type MetadataObject = Record<string, string>

// Metadata size and count limits from the contract
export const METADATA_LIMITS = {
  MAX_KEY_LENGTH: 32,
  MAX_VALUE_LENGTH: 96,
  MAX_KEYS_PER_DATASET: 10,
  MAX_KEYS_PER_PIECE: 3,
}

export function metadataArrayToObject(metadataArray: MetadataArray): Record<string, string> {
  const [keys, values] = metadataArray
  const metadata: Record<string, string> = {} as Record<string, string>
  for (let i = 0; i < keys.length; i++) {
    metadata[keys[i]] = values[i]
  }
  return metadata
}

export interface MetadataDataSetInternal {
  cdn?: boolean
}

export interface MetadataPieceInternal {
  ipfsRootCID?: string
}
/**
 * Convert a dataset metadata object to an array of metadata entries to be signed.
 *
 * @param metadataObject
 * @param metadataInternal
 * @returns
 */
export function datasetMetadataObjectToEntry(
  metadataObject?: MetadataObject,
  metadataInternal?: MetadataDataSetInternal
): MetadataEntry[] {
  // When the cdn flag is set, ensure the withCDN key is present. Preserve any value already on the
  // incoming metadata (the CDN group id that FWSS keys the shared bandwidth rail by); only default
  // to an empty value when the key is absent, so the group id is not clobbered.
  const ensureWithCDN = metadataInternal?.cdn === true && (metadataObject == null || !('withCDN' in metadataObject))
  const obj = {
    ...(metadataObject ?? {}),
    ...(ensureWithCDN ? { withCDN: '' } : {}),
  }
  const entries = Object.entries(obj)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }))

  if (entries.length > METADATA_LIMITS.MAX_KEYS_PER_DATASET) {
    throw new Error('Metadata exceeds the maximum number of keys per data set')
  }

  for (const entry of entries) {
    if (entry.key.length > METADATA_LIMITS.MAX_KEY_LENGTH) {
      throw new Error('Metadata key exceeds the maximum length')
    }
    if (typeof entry.value !== 'string') {
      throw new Error(`Metadata value must be a string, got ${typeof entry.value} for key "${entry.key}"`)
    }
    if (entry.value.length > METADATA_LIMITS.MAX_VALUE_LENGTH) {
      throw new Error('Metadata value exceeds the maximum length')
    }
  }

  return entries
}

/**
 * Convert a dataset metadata object to an array of metadata entries to be signed.
 *
 * @param metadataObject
 * @param metadataInternal
 * @returns
 */
export function pieceMetadataObjectToEntry(
  metadataObject?: MetadataObject,
  metadataInternal?: MetadataPieceInternal
): MetadataEntry[] {
  const obj = {
    ...(metadataObject ?? {}),
    ...(metadataInternal?.ipfsRootCID ? { ipfsRootCID: metadataInternal.ipfsRootCID } : {}),
  }
  const entries = Object.entries(obj)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, value]) => ({ key, value }))

  if (entries.length > METADATA_LIMITS.MAX_KEYS_PER_PIECE) {
    throw new Error('Metadata exceeds the maximum number of keys per piece')
  }

  for (const entry of entries) {
    if (entry.key.length > METADATA_LIMITS.MAX_KEY_LENGTH) {
      throw new Error('Metadata key exceeds the maximum length')
    }
    if (typeof entry.value !== 'string') {
      throw new Error(`Metadata value must be a string, got ${typeof entry.value} for key "${entry.key}"`)
    }
    if (entry.value.length > METADATA_LIMITS.MAX_VALUE_LENGTH) {
      throw new Error('Metadata value exceeds the maximum length')
    }
  }

  return entries
}
