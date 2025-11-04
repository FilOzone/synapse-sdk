import type * as SentryBrowser from '@sentry/browser'
import type * as SentryNode from '@sentry/node'

/**
 * The telemetry module here and elsewhere needs to know whether we're running in a browser context or not.
 * We determine this once here and export.
 * This presumably should be done somewhere more broadly scoped within Synapse,
 * but we're doing it here for now.
 */
export const isBrowser =
  typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).document !== 'undefined'

export type SentryBrowserType = typeof SentryBrowser.default
export type SentryNodeType = typeof SentryNode.default
export type SentryType = SentryNodeType | SentryBrowserType

/**
 * Dynamically import the correct Sentry package for whether we're running in a browser or Node.
 * Returns null if the Sentry dependencies are not available (optional peer dependencies).
 */
export async function getSentry(): Promise<SentryType | null> {
  try {
    if (isBrowser) {
      return (await import('@sentry/browser')) satisfies typeof SentryBrowser
    }
    return (await import('@sentry/node')) satisfies typeof SentryNode
  } catch {
    // Sentry dependencies not available (optional peer dependencies)
    return null
  }
}

/**
 * Map of regex patterns to their replacement strings for URL sanitization.
 * Order matters: more specific patterns should come before more general ones.
 */
const URL_SANITIZATION_PATTERNS: Array<[RegExp, string]> = [
  // Remove query parameters to reduce cardinality
  [/\?.+/, ''],

  // Replace UUIDs (format: 8-4-4-4-12 hex digits)
  [/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/gi, '/<UUID>'],

  // Replace CIDs (Content Identifiers - bafk, bafy, etc.)
  [/\/baf[a-z0-9]{50,}/g, '/<CID>'],

  // Replace transaction hashes (0x followed by 16+ hex chars)
  [/\/0x[a-f0-9]{16,}/gi, '/<txHash>'],

  // Replace numeric IDs in paths (e.g., dataset IDs)
  [/\/[0-9]+\b/g, '/<ID>'],
]

/**
 * Sanitizes a string representing a URL, METHOD + URL, or path for use in span names by replacing variable parts with placeholders.
 * This improves span grouping and reduces cardinality in telemetry data.
 *
 * Replacements:
 * - Query parameters → removed entirely
 * - UUIDs (8-4-4-4-12 format) → /<UUID>
 * - CIDs (bafk..., bafy...) → /<CID>
 * - Transaction hashes (0x + 16+ hex chars) → /<txHash>
 * - Numeric IDs → /<ID>
 *
 * @param url - The URL to sanitize
 * @returns Sanitized URL string suitable for span naming
 *
 * @example
 * sanitizeUrlForSpan('GET https://pdp.com/pdp/piece/bafkzcibf7pc.../status?foo=bar')
 * // Returns: 'GET https://pdp.com/pdp/piece/<CID>/status'
 *
 * @example
 * sanitizeUrlForSpan('POST https://pdp.com/pdp/data-sets/27/pieces/added/0xabc123...')
 * // Returns: 'POST https://pdp.com/pdp/data-sets/<ID>/pieces/added/<txHash>'
 */
export function sanitizeUrlForSpan(urlOrPath: string): string {
  let sanitized = urlOrPath

  for (const [pattern, replacement] of URL_SANITIZATION_PATTERNS) {
    sanitized = sanitized.replace(pattern, replacement)
  }

  return sanitized
}
