/**
 * Telemetry module exports
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 */

export { TelemetryService } from './service.ts'
// telemetry/errors.ts is exported from ../utils/errors.ts
export { initGlobalTelemetry, getGlobalTelemetry, removeGlobalTelemetry, isGlobalTelemetryEnabled } from './singleton.ts'
export { initGlobalFetchWrapper, removeGlobalFetchWrapper } from './fetch-wrapper.ts'
export type {
  DebugDump,
  Environment,
  OperationType,
  TelemetryConfig,
} from './types.ts'
export { OPERATIONS } from './types.ts'
