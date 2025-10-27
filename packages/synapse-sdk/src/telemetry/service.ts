/**
 * TelemetryService - Main telemetry service for Synapse SDK
 *
 * You should use `synapse.telemetry.sentry` directly to capture events.
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

import type { FilecoinNetworkType } from '../types.ts'
import { SDK_VERSION } from '../utils/sdk-version.ts'
import { getSentry, type Sentry as SentryType } from './get-sentry.ts'

export interface TelemetryConfig {
  /**
   * Whether to enable telemetry.
   *
   * You can also control this via the environment variable `SYNAPSE_TELEMETRY_DISABLED` or the global variable `SYNAPSE_TELEMETRY_DISABLED`.
   *
   * This value will also be false if `NODE_ENV === 'test'`.
   *
   * @default true
   */
  enabled: boolean
  /**
   * The name of the application using synapse-sdk.
   * This is used to identify the application in the telemetry data.
   * This is optional and can be set by the user via the synapse.telemetry.sentry.setContext() method.
   * If not set, synapse-sdk will use 'synapse-sdk' as the default app name.
   */
  appName: string
  tags?: Record<string, string> // optional: custom tags
}

/**
 * Configuration for runtime detection and context
 */
export interface TelemetryRuntimeContext {
  filecoinNetwork: FilecoinNetworkType
}

export interface DebugDump {
  lastEventId: string | undefined
  events: any[]
}

/**
 * Main telemetry service that manages the adapter and provides high-level APIs
 */
export class TelemetryService {
  private config: TelemetryConfig
  private context: TelemetryRuntimeContext
  private eventBuffer: any[] = []
  private readonly maxBufferSize = 50

  sentry: SentryType | null = null

  constructor(config: TelemetryConfig, context: TelemetryRuntimeContext) {
    this.context = context
    this.config = config

    if (this.config.enabled) {
      void this.initSentry()
    }
  }

  private async initSentry(): Promise<void> {
    const { Sentry, integrations } = await getSentry()
    this.sentry = Sentry
    this.sentry.init({
      dsn: 'https://3ed2ca5ff7067e58362dca65bcabd69c@o4510235322023936.ingest.us.sentry.io/4510235328184320',
      // Setting this option to false will prevent the SDK from sending default PII data to Sentry.
      // For example, automatic IP address collection on events
      sendDefaultPii: false,
      release: `@filoz/synapse-sdk@v${SDK_VERSION}`,
      beforeSend: this.onBeforeSend.bind(this),
      // Enable tracing/performance monitoring
      tracesSampleRate: 1.0, // Capture 100% of transactions for development (adjust in production)
      // Integrations configured per-runtime in sentry-dep files
      integrations,
    })

    // things that we don't need to search for in sentry UI, but may be useful for debugging should be set as context
    this.sentry.setContext('environment', {
      // userAgent may not be useful for searching, but will be useful for debugging
      userAgent:
        typeof globalThis !== 'undefined' && 'navigator' in globalThis
          ? (globalThis as any).navigator.userAgent
          : undefined,
    })

    // things that we can search in the sentry UI (i.e. not millions of unique potential values, like userAgent would have) should be set as tags
    this.sentry.setTags({
      /**
       * The different app identifiers that can be set via the `appName` config option.
       */
      appName: this.config.appName,
      /**
       * The version of the synapse-sdk that is being used.
       */
      synapseSdkVersion: `@filoz/synapse-sdk@v${SDK_VERSION}`,
      /**
       * The runtime (browser/node) that the synapse-sdk is being used in.
       */
      runtime: (typeof globalThis !== 'undefined' && 'window' in globalThis ? 'browser' : 'node') as 'browser' | 'node',

      /**
       * The network (mainnet/calibration) that the synapse-sdk is being used in.
       */
      filecoinNetwork: this.context.filecoinNetwork,
    })
  }

  /**
   * Sentry allows us to view events/errors/spans/etc before sending them to their servers.
   * If an event should not be sent/tracked, this method should return null.
   *
   * Currently, we are only using this with [`beforeSend`](https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-before-send) to
   * add error events to our local buffer for use with `debugDump`.
   *
   * @param event - The event to be sent to Sentry.
   * @returns The event to be sent to Sentry, or null if the event should not be sent.
   */
  protected onBeforeSend<T>(event: T): T | null {
    this.addToBuffer(event)

    return event
  }

  /**
   * Get debug dump for support tickets
   *
   * Returns enough information for devs to dive into the data on filoz.sentry.io
   *
   * @example
   * ```typescript
   * const dump = synapse.telemetry.debugDump()
   * console.log(JSON.stringify(dump, null, 2))
   * ```
   */
  debugDump(limit = 50): DebugDump {
    return {
      lastEventId: this.sentry?.lastEventId(),
      events: this.eventBuffer.slice(-limit),
    }
  }

  /**
   * Check if telemetry is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled
  }

  /**
   * Enable telemetry explicitly (even if disabled by environment)
   * Useful for testing or when you need to force telemetry on
   */
  enable(): void {
    if (!this.config.enabled) {
      this.config.enabled = true
      this.initSentry()
    }
  }

  /**
   * Disable telemetry explicitly (even if enabled by environment)
   * Useful for testing or when you need to force telemetry off
   */
  disable(ms?: number): void {
    if (this.config.enabled) {
      this.config.enabled = false
      void this.sentry?.close(ms)
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
    if (!this.config.enabled) {
      return true
    }

    // Delegate to adapter's flush method if available
    return this.sentry?.flush(timeout) ?? true
  }

  /**
   * Close the telemetry service and shut down the adapter
   *
   * This flushes pending events and closes the telemetry connection.
   * Call this when your application is shutting down to ensure proper cleanup.
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
   * @returns Promise that resolves to true if shutdown was successful
   *
   * @example
   * ```typescript
   * // Before exiting
   * await synapse.telemetry.close()
   * process.exit(0)
   * ```
   */
  async close(timeout = 2000): Promise<boolean> {
    if (!this.config.enabled) {
      return true
    }

    return this.sentry?.close(timeout) ?? true
  }

  /**
   * Add event to circular buffer
   * @internal
   */
  private addToBuffer(event: any): void {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift()
    }
  }
}
