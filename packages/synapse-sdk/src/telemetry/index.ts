/**
 * Telemetry components
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 *
 * @module Telemetry
 * @example
 * ```ts
 * import { getGlobalTelemetry, initGlobalTelemetry } from '@filoz/synapse-sdk/telemetry'
 * ```
 */

export { type DebugDump, type TelemetryConfig, TelemetryService } from './service.ts'
export { getGlobalTelemetry, initGlobalTelemetry } from './singleton.ts'
