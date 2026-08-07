import { METADATA_KEYS } from './constants.ts'

/**
 * Combines a metadata object with SDK-managed keys (withCDN, source).
 *
 * Each managed key is added only when its option is active AND the key is not already present
 * in the metadata (explicit user metadata takes precedence).
 *
 * The `withCDN` key carries a CDN group id as its value. FWSS keys the shared CDN bandwidth rail
 * by `keccak256(payer, value)`, so every data set that shares the same value joins one bandwidth
 * subscription instead of buying CDN once per data set. Callers pass `cdnGroup` to set this value;
 * when omitted, an empty string is used (today's behavior: one bandwidth rail per data set). The
 * value must be identical across all copies of the same logical upload so they resolve to the same
 * shared rail, and stable across re-uploads so exact-metadata reuse (`metadataMatches`) keeps
 * finding the existing data sets instead of churning new ones.
 *
 * @param metadata - Base metadata object (can be empty)
 * @param options - SDK-managed metadata options
 * @param options.withCDN - Whether to include the CDN flag
 * @param options.cdnGroup - CDN group id used as the `withCDN` value (empty string when omitted)
 * @param options.source - Application identifier for namespace isolation (null or empty string to skip)
 * @returns Combined metadata object
 */
export function combineMetadata(
  metadata: Record<string, string> = {},
  options?: { withCDN?: boolean; cdnGroup?: string; source?: string | null }
): Record<string, string> {
  let result = metadata

  if (options?.withCDN && !(METADATA_KEYS.WITH_CDN in result)) {
    result = { ...result, [METADATA_KEYS.WITH_CDN]: options.cdnGroup ?? '' }
  }

  if (options?.source && !(METADATA_KEYS.SOURCE in result)) {
    result = { ...result, [METADATA_KEYS.SOURCE]: options.source }
  }

  return result
}
