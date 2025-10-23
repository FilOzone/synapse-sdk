/**
 * Telemetry-aware error creation utilities
 *
 * Provides error creation functions that automatically capture errors to telemetry
 * when telemetry is enabled. Uses the global telemetry singleton.
 */

import { createError as originalCreateError } from '../utils/errors.ts'
import { getGlobalTelemetry, isGlobalTelemetryEnabled } from './singleton.ts'
import type { OperationType } from './types.ts'

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
export function createError(
  prefix: string,
  operation: string | OperationType,
  details: string,
  originalError?: unknown
): Error {
  // Create the error using the original function
  const error = originalCreateError(prefix, operation, details, originalError)

  // we need to convert the prefix + operation to a sentry.io operation type
  // TODO: better mapping of prefix across the board.. seems like we should use what already exists in createError() calls instead of what's defined in telemetry/types.ts `OPERATIONS` constant
  const operationType = `${prefix}.${operation}`

  // Capture to telemetry if enabled
  if (isGlobalTelemetryEnabled()) {
    getGlobalTelemetry()?.captureError(error, { operation: operationType })
  }

  return error
}
