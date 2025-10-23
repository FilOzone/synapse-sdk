/**
 * Sentry dependency - Node.js version
 * This file is replaced with sentry-dep.browser.ts for browser builds via package.json "browser" field
 */
import * as SentryNode from '@sentry/node'

export const Sentry = SentryNode

// Export Node-specific integrations as an array
export const integrations: any[] = [
  SentryNode.httpIntegration(),
]
