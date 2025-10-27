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
   * Additional options to pass to the Sentry SDK's init method.
   */
  sentryInitOptions?: Parameters<SentryType['init']>[0]
  /**
   * Additional tags to set on the Sentry SDK.
   */
  sentrySetTags?: Parameters<SentryType['setTags']>[0]
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

    // Initialize sentry always.. singleton.ts will not construct this service if telemetry is disabled.
    void this.initSentry()
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
      ...this.config.sentryInitOptions,
    })

    const runtime: 'browser' | 'node' = (typeof globalThis !== 'undefined' && 'window' in globalThis ? 'browser' : 'node')

    // things that we don't need to search for in sentry UI, but may be useful for debugging should be set as context
    this.sentry.setContext('runtime', {
      type: runtime,
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
      appName: this.config.sentrySetTags?.appName ?? this.config.sentrySetTags?.app_name ?? 'synapse-sdk',
      /**
       * The version of the synapse-sdk that is being used.
       */
      synapseSdkVersion: `@filoz/synapse-sdk@v${SDK_VERSION}`,
      /**
       * The runtime (browser/node) that the synapse-sdk is being used in.
       */
      runtime,

      /**
       * The network (mainnet/calibration) that the synapse-sdk is being used in.
       */
      filecoinNetwork: this.context.filecoinNetwork,
      ...this.config.sentrySetTags,
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
