/**
 * Telemetry module exports
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 */

export { type DebugDump, type TelemetryConfig, TelemetryService } from './service.ts'
export { getGlobalTelemetry, initGlobalTelemetry, removeGlobalTelemetry } from './singleton.ts'
// createError is exported from ../telemetry/utils.ts
