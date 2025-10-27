/**
 * Telemetry-aware wrapper around `../utils/errors.ts`
 * Provides the same error creation functions, but also automatically capture errors to telemetry when telemetry is enabled. 
 * Uses the global telemetry singleton.
 * Generic error handling of uncaught errors is [configured automatically by Sentry](https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries).
 */

import { createError as originalCreateError } from '../utils/errors.ts'
import { getGlobalTelemetry, isGlobalTelemetryEnabled } from './singleton.ts'

/**
 * Create an error with automatic telemetry capture
 *
 * This function wraps the original createError() and automatically captures
 * the error to telemetry if telemetry is enabled.
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
  if (isGlobalTelemetryEnabled()) {
    getGlobalTelemetry()?.sentry?.captureException(error, {
      tags: { operation: `${prefix}.${operation}` },
      extra: {
        synapseErrorPrefix: prefix,
        synapseErrorOperation: operation,
        synapseErrorDetails: details,
        originalError,
      },
    })
  }

  return error
}
