/**
 * TelemetryService - Main telemetry service for Synapse SDK.
 * Per [issue #328](https://github.com/FilOzone/synapse-sdk/issues/328) this is primarily a thin wrapper around sentry.io.
 * It allows a caller to pass through [Sentry configuration options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/), where Synapse will apply some defaults if they aren't otherwise set.
 * (See the constructor for more information.)
 * The underlying Sentry instance can be accessed via `.sentry` for invoking any other [Sentry APIs](https://docs.sentry.io/platforms/javascript/apis/).
 *
 * In addition, to help with support tickets, the TelemetryService can be queried to get recent events:
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

type SentryBeforeSendFunction = (event: ErrorEvent, hint: EventHint) => Promise<ErrorEvent | null>

export interface TelemetryConfig {
  /**
   * Additional options to pass to the Sentry SDK's init method.
   * See https://docs.sentry.io/platforms/javascript/configuration/options/
   */
  sentryInitOptions?: SentryInitOptions
  /**
   * Additional tags to set on the Sentry SDK.
   * See https://docs.sentry.io/platforms/javascript/apis/#setTags
   */
  sentrySetTags?: SentrySetTags
}

/**
 * Configuration about the "runtime environment" for Synapse that needs Synapse-specific knowledge.
 * This isn't to be confused with [Sentry's Runtime context](https://develop.sentry.dev/sdk/data-model/event-payloads/contexts/#runtime-context).
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
  private eventBuffer: any[] = []
  private readonly maxBufferSize = 15

  sentry: SentryType | null = null

  /**
   * The provided TelemetryConfig will be passed to Sentry basically as is.
   * Default values that make sense for synapse-sdk will be set for some [Sentry configuration options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/) if they aren't otherwise specified.
   * See the source for the specific defaults.
   */
  constructor(config: TelemetryConfig, context: TelemetryRuntimeContext) {
    // Initialize sentry always.. singleton.ts will not construct this service if telemetry is disabled.
    void this.initSentry(config, context).catch(() => {
      // Silently ignore telemetry initialization errors
    })
  }

  /**
   * This is a separate function rather than being in the constructor because it is async.
   * This does means that a TelemetryService instance can be accessible without the sentry object being instantiated.
   * We are fine with this in practice because in the worst case it means some initial telemetry events get missed.
   * Consuming code of the Synapse telemetry module should be fine because it already protects against a null sentry instance in case telemetry is disabled.
   */
  private async initSentry(config: TelemetryConfig, context: TelemetryRuntimeContext): Promise<void> {
    const Sentry = await getSentry()
    if (!Sentry) {
      // Sentry dependencies not available, telemetry will be disabled
      return
    }
    this.sentry = Sentry

    const integrations = []
    let runtime: 'browser' | 'node'
    if (isBrowser) {
      runtime = 'browser'
      integrations.push(
        (Sentry as SentryBrowserType).browserTracingIntegration({
          // Disable telemetry on static asset retrieval. It's noisy (distracting from backend RPC/SP calls) and potentially leaks unnecessary identifiable information.
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
      ...config.sentryInitOptions,
      beforeSend: this.createBeforeSend(config),
      release: `@filoz/synapse-sdk@v${SDK_VERSION}`,
    })

    // Things that we don't need to search for in sentry UI, but may be useful for debugging should be set as context.
    // See https://docs.sentry.io/platforms/javascript/guides/nextjs/apis/#setContext
    // In this case, we're using the "common context" of "runtime" as its the closest match.
    // See https://develop.sentry.dev/sdk/data-model/event-payloads/contexts/#runtime-context
    this.sentry.setContext('runtime', {
      type: runtime,
      // userAgent may not be useful for searching, but will be useful for debugging
      userAgent: isBrowser && 'navigator' in globalThis ? (globalThis as any).navigator.userAgent : undefined,
    })

    // Things that we can search in the sentry UI (i.e. not millions of unique potential values, like userAgent would have) should be set as tags
    this.sentry.setTags({
      appName: 'synapse-sdk', // overridable by consumers
      ...config.sentrySetTags, // get any tags consumers want to set

      // things that consumers should not need, nor be able, to override
      filecoinNetwork: context.filecoinNetwork, // The network (mainnet/calibration) that the synapse-sdk is being used in.
      synapseSdkVersion: `@filoz/synapse-sdk@v${SDK_VERSION}`, // The version of the synapse-sdk that is being used.
    })
  }

  /**
   * Create a function that stores any events before Sentry sends to help with local debugging via `debugDump`.
   * This function is intended to be set to [Sentry's `beforeSend` option](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/#beforeSend).
   * If the TelemetryConfig specified a `beforeSend` function, that function will be called after storing the event locally.
   * The created `beforeSend` function is not [currently doing any filtering](https://docs.sentry.io/platforms/javascript/configuration/filtering/#using-before-send).
   * @param config
   * @returns Function that can be set for `beforeSend` Sentry option.
   */
  protected createBeforeSend(config: TelemetryConfig): SentryBeforeSendFunction {
    return (async (event, hint) => {
      this.addToEventBuffer(event)

      if (config.sentryInitOptions?.beforeSend != null) {
        return await config.sentryInitOptions.beforeSend(event, hint)
      }

      return event
    }) satisfies SentryBeforeSendFunction
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
