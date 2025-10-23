/**
 * Sentry dependency - Browser version
 * This file replaces sentry-dep.ts for browser builds via package.json "browser" field
 */
import * as SentryBrowser from '@sentry/browser'

export const Sentry = SentryBrowser

// Export browser-specific integrations as an array
export const integrations: any[] = [SentryBrowser.browserTracingIntegration()]
