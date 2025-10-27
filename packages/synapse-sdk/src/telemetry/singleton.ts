/**
 * Telemetry singleton manager.
 * Sets up and provides a single global TelemetryService instance. 
 * #initGlobalTelemetry is the entry point.
 * #getGlobalTelemetry is the expected access point within Synapse and beyond.
 *
 * This class handles:
 * - Instantiating the TelemetryService instance.
 * - Managing the "fetch wrapper".
 * - Managing shutdown handling from a telemetry regard.
 *
 * Note: error handling is wired in by `src/utils/index.ts` exporting `src/telemetry/utils.ts#createError()`, which wraps `src/utilts/errors.ts`.  
 * `src/telemetry/utils.ts` accesses the global TelemetryService instance.
 */

import { type TelemetryConfig, type TelemetryRuntimeContext, TelemetryService } from './service.ts'
import { isBrowser } from './utils.ts'

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  sentryInitOptions: {},
  sentrySetTags: { appName: 'synapse-sdk' },
}

// Global telemetry instance
let telemetryInstance: TelemetryService | null = null

/**
 * Get the global telemetry instance
 *
 * @returns The global telemetry instance or null if not initialized
 */
export function getGlobalTelemetry(): TelemetryService | null {
  return telemetryInstance
}

/**
 * Initialize the global telemetry instance
 *
 * @param telemetry - TelemetryService instance
 */
export function initGlobalTelemetry(telemetryContext: TelemetryRuntimeContext, config?: TelemetryConfig): void {
  let telemetryConfig: TelemetryConfig
  if (!shouldEnableTelemetry(config)) {
    return
  }
  if (config == null) {
    telemetryConfig = DEFAULT_TELEMETRY_CONFIG
  } else {
    telemetryConfig = {
      sentryInitOptions: config.sentryInitOptions,
      sentrySetTags: { ...DEFAULT_TELEMETRY_CONFIG.sentrySetTags, ...config.sentrySetTags },
    }
  }

  telemetryInstance = new TelemetryService(telemetryConfig, telemetryContext)
  wrapFetch()
  setupShutdownHooks()
}

/**
 * Remove the global telemetry instance
 * This should handle all cleanup of telemetry resources.
 */
export function removeGlobalTelemetry(flush: boolean = true): void {
  if (telemetryInstance == null) {
    return
  }
  if (flush) {
    void telemetryInstance?.sentry?.flush()
  }
  unwrapFetch()
  telemetryInstance = null
}

/**
 * Determine if telemetry should be enabled based on configuration and environment.
 * The ways to disable include setting any of the following:
 * - synapseConfig.telemetry.sentryInitOptions.enabled = false
 * - global.SYNAPSE_TELEMETRY_DISABLED = true
 * - process.env.SYNAPSE_TELEMETRY_DISABLED = true
 * We also disable if process.env.NODE_ENV == 'test'.
 *
 * @param config - User-provided telemetry configuration
 * @returns True if telemetry should be enabled
 */
function shouldEnableTelemetry(config?: TelemetryConfig): boolean {
  // If explicitly disabled by user config, respect that
  if (config?.sentryInitOptions?.enabled === false) {
    return false
  }

  // If disabled by `SYNAPSE_TELEMETRY_DISABLED` environment/global variable, respect that
  if (isTelemetryDisabledByEnv()) {
    return false
  }

  // If in test environment, disable telemetry unless explicitly enabled by user config
  if (config?.sentryInitOptions?.enabled === undefined) {
    // we use playwright-test, which sets globalThis.PW_TEST in browser, and NODE_ENV in node
    if (globalThis.process?.env?.NODE_ENV === 'test' || (globalThis as any).PW_TEST != null) {
      return false
    }
  }

  // Default to isEnabled (unless explicitly disabled above)
  return true
}

function setupShutdownHooks(opts: { timeoutMs?: number } = {}) {
  const g = globalThis as any
  const timeout = opts.timeoutMs ?? 2000
  let shuttingDown = false

  // NOTE: sentry handles uncaughtException and unhandledRejection. see https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries

  if (isBrowser) {
    // -------- Browser runtime --------
    /**
     * We `flush` in the browser instead of `close` because users might come back to this page later, and we don't want to add
     * "pageShow" event handlers and re-instantiation logic.
     */
    const flush = () => {
      // Don’t block; Sentry will use sendBeacon/fetch keepalive under the hood.
      void telemetryInstance?.sentry?.flush(timeout)
    }

    // Most reliable on modern browsers & iOS Safari:
    g.window.addEventListener('pagehide', flush, { capture: true })
    g.document.addEventListener(
      'visibilitychange',
      () => {
        if (g.document.visibilityState === 'hidden') flush()
      },
      { capture: true }
    )

    // Fallbacks for older browsers:
    g.window.addEventListener('beforeunload', flush, { capture: true })
    g.window.addEventListener('unload', flush, { capture: true })
  } else {
    // -------- Node runtime --------
    /**
     * For Node.js, we only handle explicit termination signals.
     * We `close` in Node.js instead of `flush` because the process is actually exiting and we don't need to worry about handling the "users coming back" situation like we do in the browser.
     */

    const handleSignal = () => {
      if (shuttingDown) return
      shuttingDown = true

      // Close the sentry to release resources
      void telemetryInstance?.sentry?.close(timeout).finally(() => {
        shuttingDown = false
        removeGlobalTelemetry(false) // Remove the global telemetry instance to prevent further telemetry
      })
    }

    process.on('exit', handleSignal)
    process.on('beforeExit', handleSignal)
    process.on('SIGINT', handleSignal)
    process.on('SIGTERM', handleSignal)
    process.on('SIGQUIT', handleSignal)
  }
}

const originalFetch = (globalThis as any).fetch as typeof fetch
let isFetchWrapped = false
/**
 * This patches `globalThis.fetch` to add telemetry tracking.
 * It is safe to call multiple times as it will only wrap once.
 *
 * Problem to solve: ensure a [Sentry span](https://docs.sentry.io/platforms/javascript/tracing/span-metrics/) is created and published for every `fetch` call.
 * Sentry automatically creates a span for every `fetch`, but those spans require that there is already an active span.
 * This is implied in https://docs.sentry.io/platforms/javascript/tracing/instrumentation/requests-module/ and we have observed it empirically in testing.
 * The logic of this `fetch` wrapper is then to ensure that we have an active span, and if not, to create one so that the auto-instrumented http requests get collected.
 *
 * Example cases where there will already be an active span:
 * - If [browser auto instrumentation](https://docs.sentry.io/platforms/javascript/tracing/instrumentation/automatic-instrumentation/) is enabled and the `pageload` or `navigation` spans are still active (i.e., haven't been closed)
 * - If a Synapse-using application has accessed the TelemetryInstance singleton and started a span.
 *
 * Example cases where there won't be an active span:
 * - Directly invoking HTTP-inducing Synpase SDK functions from a node context.
 * In these cases, this wrapper creates a span before making the `fetch` call.
 */
function wrapFetch(): void {
  if (isFetchWrapped) {
    return // Already wrapped
  }

  isFetchWrapped = true

  ;(globalThis as any).fetch = async function wrappedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    // Short circuit to the original fetch if
    // - telemetry is disabled OR
    // - we have an active span (since fetch calls will be instrumented by Sentry automatically and become a child span)
    const sentry = getGlobalTelemetry()?.sentry
    if (!sentry || sentry.getActiveSpan() != null) {
      return originalFetch(input, init)
    }
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
    const method = input instanceof Request ? input.method : init?.method || 'GET'

    /**
     * For this case, since there isn't an active span already, we will create one.
     * This root wrapper span will effectively have the same duration as the child auto-instrumented-by-Sentry HTTP request span.
     * These wrapper spans can be filtered out in the [Sentry Trace explorer](https://filoz.sentry.io/explore/traces) with `!span.op:http.wrapper`
     */
    return sentry.startSpan(
      {
        name: `${method} ${url.toString()} Wrapper`, // Children spans (including automatic Sentry instrumentation) inherit this name.
        op: 'http.wrapper',
      },
      async () => {
        return originalFetch(input, init)
      }
    )
  }
}

/**
 * Remove the global fetch wrapper
 *
 * Useful for testing or when telemetry should be disabled.
 */
function unwrapFetch(): void {
  if (!isFetchWrapped) {
    return
  }

  ;(globalThis as any).fetch = originalFetch
  isFetchWrapped = false
}

/**
 * Check if telemetry is explicitly disabled via global variable or environment
 * Uses globalThis for consistent cross-platform access
 */
function isTelemetryDisabledByEnv(): boolean {
  // Check for global disable flag (universal)
  if (typeof globalThis !== 'undefined') {
    // Check for explicit disable flag
    if ((globalThis as any).SYNAPSE_TELEMETRY_DISABLED === true) {
      return true
    }

    // Check environment variable in Node.js
    if ('process' in globalThis) {
      const process = (globalThis as any).process
      if (process?.env) {
        const disabled = process.env.SYNAPSE_TELEMETRY_DISABLED
        if (typeof disabled === 'string' && disabled.trim().toLowerCase() === 'true') {
          return true
        }
      }
    }
  }

  return false
}
