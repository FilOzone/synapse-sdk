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

import type { BrowserOptions, ErrorEvent, EventHint } from '@sentry/browser'
import type { NodeOptions } from '@sentry/node'
import type { FilecoinNetworkType } from '../types.ts'
import { SDK_VERSION } from '../utils/sdk-version.ts'
import { getSentry, isBrowser, type SentryBrowserType, type SentryType } from './utils.ts'

type SentryInitOptions = BrowserOptions | NodeOptions
type SentrySetTags = Parameters<SentryType['setTags']>[0]

export interface TelemetryConfig {
  /**
   * Additional options to pass to the Sentry SDK's init method.
   * See https://docs.sentry.io/platforms/javascript/configuration/options/
   */
  sentryInitOptions?: SentryInitOptions
  /**
   * Additional tags to set on the Sentry SDK.
   */
  sentrySetTags?: SentrySetTags
}

/**
 * Configuration for runtime detection and context
 */
export interface TelemetryRuntimeContext {
  filecoinNetwork: FilecoinNetworkType
}

export interface DebugDump {
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
    const Sentry = await getSentry()
    this.sentry = Sentry

    const integrations = []
    let runtime: 'browser' | 'node'
    if (isBrowser) {
      runtime = 'browser'
      integrations.push(
        (Sentry as SentryBrowserType).browserTracingIntegration({
          // Disable telemetry on static asset retrieval. It's noisy and potentially more identifiable information.
          ignoreResourceSpans: ['resource.script', 'resource.img', 'resource.css', 'resource.link'],
        })
      )
    } else {
      runtime = 'node'
      // no integrations are needed for nodejs
    }

    this.sentry.init({
      dsn: 'https://3ed2ca5ff7067e58362dca65bcabd69c@o4510235322023936.ingest.us.sentry.io/4510235328184320',
      // Setting this option to false will prevent the SDK from sending default PII data to Sentry.
      // For example, automatic IP address collection on events
      sendDefaultPii: false,
      // Enable tracing/performance monitoring
      tracesSampleRate: 1.0, // Capture 100% of transactions for development (adjust in production)
      integrations,
      ...this.config.sentryInitOptions,
      beforeSend: this.onBeforeSend.bind(this),
      release: `@filoz/synapse-sdk@v${SDK_VERSION}`,
    })

    // things that we don't need to search for in sentry UI, but may be useful for debugging should be set as context
    this.sentry.setContext('runtime', {
      type: runtime,
      // userAgent may not be useful for searching, but will be useful for debugging
      userAgent: isBrowser && 'navigator' in globalThis ? (globalThis as any).navigator.userAgent : undefined,
    })

    // things that we can search in the sentry UI (i.e. not millions of unique potential values, like userAgent would have) should be set as tags
    this.sentry.setTags({
      // appName is set to 'synapse-sdk' by default in DEFAULT_TELEMETRY_CONFIG, but consumers can set `sentrySetTags.appName` to override it.
      ...this.config.sentrySetTags, // get any tags consumers want to set

      // things that consumers should not need, nor be able, to override
      filecoinNetwork: this.context.filecoinNetwork, // The network (mainnet/calibration) that the synapse-sdk is being used in.
      synapseSdkVersion: `@filoz/synapse-sdk@v${SDK_VERSION}`, // The version of the synapse-sdk that is being used.
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
  protected async onBeforeSend(event: ErrorEvent, hint: EventHint): Promise<ErrorEvent | null> {
    this.addToEventBuffer(event)

    if (this.config.sentryInitOptions?.beforeSend != null) {
      return await this.config.sentryInitOptions.beforeSend(event, hint)
    }

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
      events: this.eventBuffer.slice(-limit),
    }
  }

  /**
   * Add event to circular buffer
   * @internal
   */
  private addToEventBuffer(event: any): void {
    this.eventBuffer.push(event)
    if (this.eventBuffer.length > this.maxBufferSize) {
      this.eventBuffer.shift()
    }
  }
}
