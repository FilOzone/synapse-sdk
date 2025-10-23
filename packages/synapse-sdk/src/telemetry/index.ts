/**
 * Telemetry module exports
 *
 * Provides types for configuring telemetry and working with debug dumps.
 * The TelemetryService is accessed via synapse.telemetry getter.
 */

export { TelemetryService } from './service.ts'
export type {
  DebugDump,
  Environment,
  OperationType,
  TelemetryConfig,
} from './types.ts'
export { OPERATIONS } from './types.ts'
