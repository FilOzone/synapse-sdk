import { METADATA_KEYS } from './constants.ts'

/**
 * Combines a metadata object with SDK-managed keys (withCDN, source).
 *
 * Each managed key is added only when its option is active AND the key is not already present
 * in the metadata (explicit user metadata takes precedence).
 *
 * @param metadata - Base metadata object (can be empty)
 * @param options - SDK-managed metadata options
 * @param options.withCDN - Whether to include the CDN flag
 * @param options.source - Application identifier for namespace isolation (null or empty string to skip)
 * @returns Combined metadata object
 */
export function combineMetadata(
  metadata: Record<string, string> = {},
  options?: { withCDN?: boolean; source?: string | null }
): Record<string, string> {
  let result = metadata

  if (options?.withCDN && !(METADATA_KEYS.WITH_CDN in result)) {
    result = { ...result, [METADATA_KEYS.WITH_CDN]: '' }
  }

  if (options?.source && !(METADATA_KEYS.SOURCE in result)) {
    result = { ...result, [METADATA_KEYS.SOURCE]: options.source }
  }

  return result
}
