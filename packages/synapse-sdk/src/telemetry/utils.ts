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
