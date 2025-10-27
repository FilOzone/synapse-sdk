import type * as SentryBrowser from '@sentry/browser'
import type * as SentryNode from '@sentry/node'
import { createError as originalCreateError } from '../utils/errors.ts'
import { getGlobalTelemetry } from './singleton.ts'

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
 */
export async function getSentry(): Promise<SentryType> {
  if (isBrowser) {
    return (await import('@sentry/browser')) satisfies typeof SentryBrowser
  }
  return (await import('@sentry/node')) satisfies typeof SentryNode
}

/**
 * Create an error with automatic telemetry capture
 *
 * Telemetry-aware wrapper around `../utils/errors.ts`
 * Provides the same error creation functions, but also automatically capture errors to telemetry when telemetry is enabled.
 * Uses the global telemetry singleton.
 * Generic error handling of uncaught errors is [configured automatically by Sentry](https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries).
 *
 * @param prefix - Error prefix (e.g., 'StorageContext')
 * @param operation - Operation name (e.g., 'upload')
 * @param details - Error details
 * @param originalError - Optional original error that caused this error
 * @returns Error instance
 */
export function createError(prefix: string, operation: string, details: string, originalError?: unknown): Error {
  // Create the error using the original function
  const error = originalCreateError(prefix, operation, details, originalError)

  // Capture to telemetry if enabled
  getGlobalTelemetry()?.sentry?.captureException(error, {
    tags: { operation: `${prefix}.${operation}` },
    extra: {
      synapseErrorPrefix: prefix,
      synapseErrorOperation: operation,
      synapseErrorDetails: details,
      originalError,
    },
  })

  return error
}
