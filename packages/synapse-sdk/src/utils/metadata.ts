import { METADATA_KEYS } from './constants.ts'

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
