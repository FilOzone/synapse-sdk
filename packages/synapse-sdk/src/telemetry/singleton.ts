/**
 * TelemetryService singleton manager used within Synapse SDK.
 * Sets up and provides a single global TelemetryService instance.
 * #initGlobalTelemetry is the entry point.
 * #getGlobalTelemetry is the expected access point within Synapse.
 * (Consumers outside of Synapse should use `synapse.telemetry`.)
 *
 * This class handles:
 * - Instantiating the TelemetryService instance.
 * - Hooking telemetry into `fetch` by wrapping it.
 * - Flushing/closing telemetry at shutdown or loss of browser focus.
 *
 * Notes:
 * - The underlying Sentry instance handles uncaught exceptions and unhandled promise rejections.
 *   No special setup is done here.
 *   See https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries
 * - Synapse-special error handling done in `src/utils/index.ts` is made "telemetry aware" by exporting `src/telemetry/utils.ts#createError()`,
 *   which wraps `src/utils/errors.ts`.
 *   `src/telemetry/utils.ts` accesses the global TelemetryService instance.
 * - A TelemetryService instance is managed as a singleton with static accessors
 *   rather than as an instance of the Synapse class,
 *   because there are cases where telemetry is needed but there is no Synapse instance available.
 *   `src/utils/errors.ts` is one such case.
 */

import { type TelemetryConfig, type TelemetryRuntimeContext, TelemetryService } from './service.ts'
import { isBrowser } from './utils.ts'

// Global telemetry instance
let telemetryInstance: TelemetryService | null = null

/**
 * @returns The global TelemetryService instance or null if not initialized
 */
export function getGlobalTelemetry(): TelemetryService | null {
  return telemetryInstance
}

/**
 * Initialize the global TelemetryService instance if telemetry isn't disabled.
 * @param telemetryContext
 * @param telemetryConfig
 */
export async function initGlobalTelemetry(
  telemetryConfig: TelemetryConfig,
  telemetryContext: TelemetryRuntimeContext
): Promise<void> {
  if (!shouldEnableTelemetry(telemetryConfig, telemetryContext)) {
    return
  }

  telemetryInstance = new TelemetryService()
  await telemetryInstance.initSentry(telemetryConfig, telemetryContext)
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
    void telemetryInstance?.sentry?.flush().catch(() => {
      // Silently ignore telemetry flush errors
    })
  }
  unwrapFetch()
  telemetryInstance = null
}

/**
 * Determine if telemetry should be enabled based on configuration and environment settings.
 * Disablement takes precedence over enablement.
 * The ways to disable include setting any of the following:
 * - synapseConfig.telemetry.sentryInitOptions.enabled = false
 * - global.SYNAPSE_TELEMETRY_DISABLED = true
 * - process.env.SYNAPSE_TELEMETRY_DISABLED = true
 * We also disable if process.env.NODE_ENV == 'test', unless enablement was explicitly requested in config.
 * We only enable by default if not otherwise disabled above AND we're on the calibration network.
 * @param telemetryConfig - User-provided telemetry configuration
 * @param telemetryContext - Runtime context for telemetry, including network info.
 * @returns True if telemetry should be enabled
 */
function shouldEnableTelemetry(telemetryConfig: TelemetryConfig, telemetryContext: TelemetryRuntimeContext): boolean {
  // If explicitly disabled by user config, respect that
  if (telemetryConfig?.sentryInitOptions?.enabled === false) {
    return false
  }

  // If disabled by `SYNAPSE_TELEMETRY_DISABLED` environment/global variable, respect that
  if (isTelemetryDisabledByEnv()) {
    return false
  }

  // If in test environment, disable telemetry unless explicitly enabled by user config
  if (telemetryConfig?.sentryInitOptions?.enabled === undefined) {
    // we use playwright-test, which sets globalThis.PW_TEST in browser, and NODE_ENV in node
    if (globalThis.process?.env?.NODE_ENV === 'test' || (globalThis as any).PW_TEST != null) {
      return false
    }
  }

  // If explicitly enabled by user config, respect that
  if (telemetryConfig?.sentryInitOptions?.enabled === true) {
    return true
  }

  // At this point we haven't been given a clear signal to enable or disable.
  // In this case, we enable telemetry if we're on the calibration network.
  return telemetryContext.filecoinNetwork === 'calibration'
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

function setupShutdownHooks(opts: { timeoutMs?: number } = {}) {
  const g = globalThis as any
  const timeout = opts.timeoutMs ?? 2000
  let shuttingDown = false

  if (isBrowser) {
    /**
     * We `flush` in the browser instead of `close` because users might come back to this page later, and we don't want to add
     * "pageShow" event handlers and re-instantiation logic.
     */
    const flush = () => {
      // Don't block; Sentry will use sendBeacon/fetch keepalive under the hood.
      void telemetryInstance?.sentry?.flush(timeout).catch(() => {
        // Silently ignore telemetry flush errors
      })
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
    // Node runtime
    /**
     * For Node.js, we only handle explicit termination signals.
     * We `close` in Node.js instead of `flush` because the process is actually exiting and we don't need to worry about handling the "users coming back" situation like we do in the browser.
     */
    const handleSignal = () => {
      if (shuttingDown) return
      shuttingDown = true

      // Close the sentry to release resources
      void telemetryInstance?.sentry
        ?.close(timeout)
        .finally(() => {
          shuttingDown = false
          removeGlobalTelemetry(false) // Remove the global telemetry instance to prevent further telemetry
        })
        .catch(() => {
          // silently ignore error
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
 * Patches `globalThis.fetch` to add manual telemetry tracking for all HTTP requests.
 * This wrapper is safe to call multiple times as it will only wrap once.
 *
 * Implementation: This function explicitly creates a [Sentry span](https://docs.sentry.io/platforms/javascript/tracing/span-metrics/)
 * for every `fetch` call by wrapping each request in `sentry.startSpan()`. The span captures HTTP metadata
 * including method, URL, status code, and content length.
 *
 * Behavior:
 * - If telemetry is disabled or not initialized, the wrapper immediately delegates to the original `fetch`
 * - If telemetry is enabled, creates a new span with op="http.client" and name="${METHOD} ${URL}"
 * - Captures request attributes (URL, method, hostname, port) before the fetch
 * - Captures response attributes (status code, content length) after the fetch
 * - Returns the original fetch response unchanged
 *
 * Why this is needed: We have explicitly disabled Sentry's automatic fetch instrumentation
 * (by limiting enabled integrations in service.ts). This manual wrapper gives us full control
 * over which HTTP requests are tracked and what attributes are captured for each span.
 *
 * See: https://docs.sentry.io/platforms/javascript/tracing/instrumentation/requests-module/#wrap-http-requests-in-a-span
 * See: https://docs.sentry.io/platforms/javascript/guides/node/tracing/instrumentation/requests-module/#wrap-http-requests-in-a-span
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
    // Short circuit to the original fetch if telemetry is disabled
    const sentry = getGlobalTelemetry()?.sentry
    if (!sentry) {
      return originalFetch(input, init)
    }
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
    const method = input instanceof Request ? input.method : init?.method || 'GET'
    return await sentry.startSpan({ op: 'http.client', name: `${method} ${url}` }, async (span) => {
      span.setAttributes({
        'url.path': url.pathname,
        'url.full': url.toString(),
        'server.address': url.hostname,
        'http.request.method': method,
        'server.port': url.port || undefined,
        'location.origin': isBrowser ? (globalThis as any).location?.origin : undefined,
      })
      const response = await originalFetch(input, init)
      span.setAttributes({
        'http.response.status_code': response.status,
        'http.response_content_length': response.headers.get('content-length')
          ? Number(response.headers.get('content-length'))
          : undefined,
      })
      return response
    })
  }
}

/**
 * Unwrap what was done in `wrapFetch()`.
 * Useful for testing or when telemetry should be disabled.
 */
function unwrapFetch(): void {
  if (!isFetchWrapped) {
    return
  }

  ;(globalThis as any).fetch = originalFetch
  isFetchWrapped = false
}
