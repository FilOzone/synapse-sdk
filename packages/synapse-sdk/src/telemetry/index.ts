/**
 * Telemetry module exports
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 */

export { type DebugDump, type TelemetryConfig, TelemetryService } from './service.ts'
export { getGlobalTelemetry, initGlobalTelemetry } from './singleton.ts'
