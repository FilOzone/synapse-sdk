/**
 * Telemetry singleton manager
 *
 * Provides a single global telemetry instance that can be used by all telemetry
 * components (fetch wrapper, error tracking, etc.).
 */

import { initGlobalFetchWrapper } from './fetch-wrapper.ts'
import type { TelemetryService } from './service.ts'

// Global telemetry instance
let telemetryInstance: TelemetryService | null = null

/**
 * Initialize the global telemetry instance
 *
 * @param telemetry - TelemetryService instance
 */
export function initGlobalTelemetry(telemetry: TelemetryService): void {
  telemetryInstance = telemetry
  initGlobalFetchWrapper()
}

/**
 * Get the global telemetry instance
 *
 * @returns The global telemetry instance or null if not initialized
 */
export function getGlobalTelemetry(): TelemetryService | null {
  if (isGlobalTelemetryEnabled()) {
    return telemetryInstance
  }
  return null
}

/**
 * Remove the global telemetry instance
 *
 * Useful for testing or when telemetry should be disabled.
 */
export function removeGlobalTelemetry(): void {
  telemetryInstance = null
}

/**
 * Check if global telemetry is enabled
 *
 * @returns True if telemetry is initialized and enabled
 */
export function isGlobalTelemetryEnabled(): boolean {
  return telemetryInstance?.isEnabled() ?? false
}
