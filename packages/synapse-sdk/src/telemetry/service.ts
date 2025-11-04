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
import {
  getSentry,
  isBrowser,
  type SentryBrowserType,
  type SentryNodeType,
  type SentryType,
  sanitizeUrlForSpan,
} from './utils.ts'

type SentryInitOptions = BrowserOptions | NodeOptions
type SentrySetTags = Parameters<SentryType['setTags']>[0]

type SentryBeforeSendFunction = (event: ErrorEvent, hint: EventHint) => Promise<ErrorEvent | null>

/**
 * Extract the beforeSendSpan function type from both BrowserOptions and NodeOptions.
 * This ensures we match Sentry's expected signature exactly.
 */
type SentryBeforeSendSpanFunction = NonNullable<SentryInitOptions['beforeSendSpan']>

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
   * This is a separate function rather than being in the constructor because it is async. This is called by initGlobalTelemetry in singleton.ts, which is called by Synapse.create in synapse.ts.
   * Default values that make sense for synapse-sdk will be set for some [Sentry configuration options](https://docs.sentry.io/platforms/javascript/guides/nextjs/configuration/options/) if they aren't otherwise specified.
   * See the source for the specific defaults.
   */
  public async initSentry(config: TelemetryConfig, context: TelemetryRuntimeContext): Promise<void> {
    const Sentry = await getSentry()
    if (!Sentry) {
      // Sentry dependencies not available, telemetry will be disabled
      return
    }
    this.sentry = Sentry

    // sentry attempts to dedupe some duplicate errors, see https://docs.sentry.io/platforms/javascript/configuration/integrations/dedupe/
    const integrations = [Sentry.dedupeIntegration()]
    let runtime: 'browser' | 'node'
    if (isBrowser) {
      runtime = 'browser'
      integrations.push(
        // only error-handling integrations
        (Sentry as SentryBrowserType).globalHandlersIntegration({ onerror: true, onunhandledrejection: true })
      )
    } else {
      runtime = 'node'
      integrations.push(
        // only error-handling integrations
        (Sentry as SentryNodeType).onUncaughtExceptionIntegration(),
        (Sentry as SentryNodeType).onUnhandledRejectionIntegration()
      )
    }

    const globalTags = {
      ...config.sentrySetTags, // get any tags consumers want to set

      // things that consumers should not need, nor be able, to override
      filecoinNetwork: context.filecoinNetwork, // The network (mainnet/calibration) that the synapse-sdk is being used in.
      synapseSdkVersion: `@filoz/synapse-sdk@v${SDK_VERSION}`, // The version of the synapse-sdk that is being used.
    }

    this.sentry.init({
      // Maps to Sentry project "synapse-sdk-2" on the backend.
      dsn: 'https://7a07cc9e3b5bf5a8fada2f25dc76cd49@o4510235322023936.ingest.us.sentry.io/4510308233445376',
      // Setting this option to false will prevent the SDK from sending default PII data to Sentry.
      // For example, automatic IP address collection on events
      sendDefaultPii: false,
      // Enable tracing/performance monitoring
      tracesSampleRate: 1.0, // Capture 100% of transactions for development (adjust in production)
      integrations,
      defaultIntegrations: false,
      ...config.sentryInitOptions,
      beforeSend: this.createBeforeSend(config),
      beforeSendSpan: this.createBeforeSendSpan(config, globalTags),
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
    this.sentry.setTags(globalTags)
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
   * Create a function that sanitizes span descriptions before sending to Sentry.
   * This function is intended to be set to [Sentry's `beforeSendSpan` option](https://docs.sentry.io/platforms/javascript/configuration/options/#beforeSendSpan).
   * If the TelemetryConfig specified a `beforeSendSpan` function, that function will be called first, then sanitization will be applied.
   * The sanitization replaces variable parts (UUIDs, CIDs, transaction hashes, numeric IDs) with placeholders to improve span grouping and reduce cardinality.
   * Only applies to spans with descriptions that start with HTTP verbs (GET, POST, PUT, etc.).
   *
   * In addition, we ensure `op=http.client` spans get the tags that were set  with `sentry.setTags`.
   * Without this, `op=http.client` spans will miss tags like `synapseSdkVersion`.
   * We don't know why  `op=http.client` doesn't otherwise get "global tags", but this is our workaround.
   * We want this so we can group by `<server.address,url.sanitizedPath,http.response.status_code>` and still filter by `synapseSdkVersion`.
   * @param config
   * @returns Function that can be set for `beforeSendSpan` Sentry option.
   */
  protected createBeforeSendSpan(
    config: TelemetryConfig,
    globalTags: Record<string, string>
  ): SentryBeforeSendSpanFunction {
    const httpVerbPattern = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|TRACE|CONNECT)\s/i

    return ((span) => {
      // Call user-provided beforeSendSpan first, if it exists
      let modifiedSpan = span
      if (config.sentryInitOptions?.beforeSendSpan != null) {
        const userModifiedSpan = config.sentryInitOptions.beforeSendSpan(span)
        if (userModifiedSpan != null) {
          modifiedSpan = userModifiedSpan
        }
      }

      // Sanitize the span description to reduce cardinality (only for HTTP verb spans)
      // beforeSendSpan receives a plain JSON object with a description property
      if (modifiedSpan.description && httpVerbPattern.test(modifiedSpan.description)) {
        modifiedSpan.description = sanitizeUrlForSpan(modifiedSpan.description)

        // Ensure the url.* tags have a sanitized path as well
        if (modifiedSpan.op === 'http.client' || modifiedSpan.data['sentry.op'] === 'http.client') {
          modifiedSpan.data = {
            // Apply the "global tags" since `op=http.client` spans don't otherwise have them.
            ...globalTags,
            ...modifiedSpan.data,
            // We call sanitizeUrlForSpan again here because modifiedSpan.description has a HTTP verb and a domain name before the path.
            // The alternative is to remove the HTTP verb and domain name entirely.
            'url.sanitizedPath': sanitizeUrlForSpan(modifiedSpan.data?.['url.path']?.toString() ?? ''),
          }
        }
      }

      return modifiedSpan
    }) satisfies SentryBeforeSendSpanFunction
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
