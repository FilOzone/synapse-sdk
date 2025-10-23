/**
 * TelemetryService - Main telemetry service for Synapse SDK
 *
 * ## Timing Operations with Multiple HTTP Calls
 *
 * Wrap method bodies with `trackOperation()` to time entire operations:
 *
 * ```typescript
 * async getAllProviders() {
 *   return this.telemetry.trackOperation('subgraph.getAllProviders', async () => {
 *     // Wrap your implementation
 *     const page1 = await this.fetch(...)
 *     const page2 = await this.fetch(...)
 *     const page3 = await this.fetch(...)
 *     return combined
 *   })
 * }
 * ```
 *
 * This captures the total operation timing plus individual HTTP calls:
 * - Operation breadcrumb: "subgraph.getAllProviders" (total: 2.5s, success/failure)
 * - HTTP breadcrumb: "POST /subgraph" (500ms, status: 200)
 * - HTTP breadcrumb: "POST /subgraph" (600ms, status: 200)
 * - HTTP breadcrumb: "POST /subgraph" (timeout, error)
 *
 * ## Correlating Related Operations
 *
 * For app-level tracking of related operations:
 *
 * ```typescript
 * // Mark the start of a user flow
 * synapse.telemetry.captureCustomEvent('user-upload-started', { fileSize: 1024 })
 * await synapse.storage.upload(data)
 * synapse.telemetry.captureCustomEvent('user-upload-completed', { cid })
 * ```
 *
 * ## Debug Dumps
 *
 * Get recent events for support tickets:
 *
 * ```typescript
 * const dump = synapse.telemetry.debugDump()
 * console.log(JSON.stringify(dump, null, 2))
 * ```
 */

import { resolveTelemetryConfig } from './config.ts'
import type {
  CustomEvent,
  DebugDump,
  ErrorEvent,
  HTTPEvent,
  OperationEvent,
  OperationType,
  TelemetryAdapter,
  TelemetryConfig,
} from './types.ts'

/**
 * Configuration for runtime detection and context
 */
interface RuntimeContext {
  sdkVersion: string
  runtime: 'browser' | 'node'
  network: 'mainnet' | 'calibration'
  ua?: string
  appName?: string
}

/**
 * Main telemetry service that manages the adapter and provides high-level APIs
 */
export class TelemetryService {
  private adapter: TelemetryAdapter
  private enabled: boolean
  private context: RuntimeContext
  private eventBuffer: Array<ErrorEvent | HTTPEvent | OperationEvent | CustomEvent> = []
  private readonly maxBufferSize = 50

  constructor(adapter: TelemetryAdapter, config: TelemetryConfig, context: RuntimeContext) {
    this.adapter = adapter

    // Resolve configuration with environment detection
    const resolvedConfig = resolveTelemetryConfig(config)
    this.enabled = resolvedConfig.enabled
    this.context = context

    if (this.enabled) {
      this.adapter.init(config, {
        sdkVersion: context.sdkVersion,
        runtime: context.runtime,
        network: context.network,
        ua: context.ua || '',
        appName: context.appName || '',
      })
    }
  }

  /**
   * Track an entire operation with timing and error handling
   *
   * This is the primary way to instrument SDK methods. Wrap your method body:
   *
   * @example
   * ```typescript
   * async myMethod() {
   *   return this.telemetry.trackOperation('service.myMethod', async () => {
   *     const result = await doWork()
   *     return result
   *   })
   * }
   * ```
   *
   * @param operation - Operation type `${string}.${string}`
   * @param fn - Async function to execute and track
   * @param params - Optional allowlisted parameters (no secrets!)
   * @returns Result from the function
   */
  async trackOperation<T>(operation: OperationType, fn: () => Promise<T>, params?: Record<string, any>): Promise<T> {
    if (!this.enabled) {
      return fn()
    }

    const startTime = Date.now()
    const requestId = this.generateRequestId()

    try {
      const result = await fn()

      const event: OperationEvent = {
        type: 'operation',
        operation,
        params: params ? this.sanitizeParams(params) : {},
        success: true,
        durationMs: Date.now() - startTime,
        requestId,
        ts: new Date().toISOString(),
      }

      this.addToBuffer(event)
      this.adapter.captureOperation(event)

      return result
    } catch (error) {
      const event: OperationEvent = {
        type: 'operation',
        operation,
        params: params ? this.sanitizeParams(params) : {},
        success: false,
        durationMs: Date.now() - startTime,
        requestId,
        ts: new Date().toISOString(),
      }

      this.addToBuffer(event)
      this.adapter.captureOperation(event)

      // Also capture the error
      if (error instanceof Error) {
        this.captureError(error, { operation })
      }

      throw error
    }
  }

  /**
   * Capture an error with context
   *
   * Generally called automatically by trackOperation(), but can be used manually:
   *
   * @example
   * ```typescript
   * try {
   *   await riskyOperation()
   * } catch (error) {
   *   this.telemetry.captureError(error, { operation: 'custom.operation' })
   *   throw error
   * }
   * ```
   */
  captureError(error: Error, context?: Record<string, unknown>): void {
    if (!this.enabled) return

    const event: ErrorEvent = {
      type: 'error',
      name: error.name,
      message: error.message,
      stack: error.stack,
      operation: context?.operation as OperationType | undefined,
      requestId: this.generateRequestId(),
      ts: new Date().toISOString(),
    }

    this.addToBuffer(event)
    this.adapter.captureError(error, context)
  }

  /**
   * Capture HTTP event (called by fetch wrapper)
   *
   * @internal - Typically called automatically by HTTP wrapper
   */
  captureHTTP(event: HTTPEvent): void {
    if (!this.enabled) return

    this.addToBuffer(event)
    this.adapter.captureHTTP(event)
  }

  /**
   * Capture custom event for app-level tracking
   *
   * Allows consumer apps to add custom breadcrumbs:
   *
   * @example
   * ```typescript
   * synapse.telemetry.captureCustomEvent({
   *   name: 'user-action',
   *   data: { action: 'clicked-upload', fileSize: 1024 },
   *   level: 'info'
   * })
   * ```
   */
  captureCustomEvent(name: string, data: Record<string, any>, level: 'info' | 'warning' | 'error' = 'info'): void {
    if (!this.enabled) return

    const event: CustomEvent = {
      type: 'custom',
      name,
      data,
      level,
      requestId: this.generateRequestId(),
      ts: new Date().toISOString(),
    }

    this.addToBuffer(event)
    this.adapter.captureCustomEvent(event)
  }

  /**
   * Set additional context tags
   *
   * Useful for adding context that changes during runtime:
   *
   * @example
   * ```typescript
   * synapse.telemetry.setContext({ datasetId: '123', providerId: '1' })
   * ```
   */
  setContext(tags: Record<string, string>): void {
    if (!this.enabled) return
    this.adapter.setContext(tags)
  }

  /**
   * Get debug dump for support tickets
   *
   * Returns last N events and context. User can copy/paste into issue:
   *
   * @example
   * ```typescript
   * const dump = synapse.telemetry.debugDump()
   * console.log(JSON.stringify(dump, null, 2))
   * ```
   */
  debugDump(limit = 50): DebugDump {
    return {
      events: this.eventBuffer.slice(-limit),
      context: {
        sdkVersion: this.context.sdkVersion,
        runtime: this.context.runtime,
        network: this.context.network,
        enabled: this.enabled,
      },
      timestamp: new Date().toISOString(),
    }
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.enabled
  }

  /**
   * Enable telemetry explicitly (even if disabled by environment)
   * Useful for testing or when you need to force telemetry on
   */
  enable(): void {
    if (!this.enabled) {
      this.enabled = true
      this.adapter.init(
        {
          enabled: true,
          environment: this.context.runtime === 'browser' ? 'development' : 'production',
          appName: this.context.appName || 'synapse-sdk',
        },
        {
          sdkVersion: this.context.sdkVersion,
          runtime: this.context.runtime,
          network: this.context.network,
          ua: this.context.ua || '',
          appName: this.context.appName || '',
        }
      )
    }
  }

  /**
   * Disable telemetry explicitly (even if enabled by environment)
   * Useful for testing or when you need to force telemetry off
   */
  disable(): void {
    if (this.enabled) {
      this.enabled = false
      this.adapter.init(
        {
          enabled: false,
        },
        {
          sdkVersion: this.context.sdkVersion,
          runtime: this.context.runtime,
          network: this.context.network,
          ua: this.context.ua || '',
          appName: this.context.appName || '',
        }
      )
    }
  }

  /**
   * Flush pending telemetry events
   *
   * Call this before process exit to ensure all events are sent.
   * Returns a promise that resolves when flushing is complete.
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
   * @returns Promise that resolves to true if all events were flushed
   *
   * @example
   * ```typescript
   * // Before exiting
   * await synapse.telemetry.flush()
   * process.exit(0)
   * ```
   */
  async flush(timeout = 2000): Promise<boolean> {
    if (!this.enabled) {
      return true
    }

    // Delegate to adapter's flush method
    if (this.adapter && 'flush' in this.adapter && typeof (this.adapter as any).flush === 'function') {
      return (this.adapter as any).flush(timeout)
    }

    return true
  }

  /**
   * Generate unique request ID
   * @internal
   */
  private generateRequestId(): string {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * Sanitize parameters to remove secrets
   * @internal
   */
  private sanitizeParams(params: Record<string, any>): Record<string, any> {
    // Allow-list of safe parameters
    const allowedParams = [
      'size',
      'providerId',
      'withCDN',
      'dataSetId',
      'amount',
      'token',
      'pieceId',
      'status',
      'page',
      'limit',
      'offset',
    ]

    const sanitized: Record<string, any> = {}

    for (const [key, value] of Object.entries(params)) {
      if (allowedParams.includes(key)) {
        // Convert bigints and other non-serializable types
        if (typeof value === 'bigint') {
          sanitized[key] = value.toString()
        } else if (value != null && typeof value === 'object') {
          // Skip complex objects
          sanitized[key] = '[object]'
        } else {
          sanitized[key] = value
        }
      }
    }

    return sanitized
  }

  /**
   * Add event to circular buffer
   * @internal
   */
  private addToBuffer(event: ErrorEvent | HTTPEvent | OperationEvent | CustomEvent): void {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift()
    }
  }
}
