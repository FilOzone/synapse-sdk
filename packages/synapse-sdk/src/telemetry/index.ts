/**
 * Telemetry module exports
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 */

export { initGlobalFetchWrapper, removeGlobalFetchWrapper } from './fetch-wrapper.ts'
export { TelemetryService } from './service.ts'
// telemetry/errors.ts is exported from ../utils/errors.ts
export {
  getGlobalTelemetry,
  initGlobalTelemetry,
  isGlobalTelemetryEnabled,
  removeGlobalTelemetry,
} from './singleton.ts'
export type {
  DebugDump,
  Environment,
  OperationType,
  TelemetryConfig,
} from './types.ts'
export { OPERATIONS } from './types.ts'
