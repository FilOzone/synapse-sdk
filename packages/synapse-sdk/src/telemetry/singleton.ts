/**
 * Telemetry singleton manager.
 * Sets up and provides a single global telemetry instance that can be used by all telemetry components:
 * - fetch wrapping via fetch-wrapper.ts
 * - error wrapping via errors.ts
 * - shutdown handling via shutdown-utils.ts
 * Synapse SDK consumers (e.g., filecoin-pin) via #getGlobalTelemetry.
 *
 * #setupGlobalTelemetry is the entry point and #getGlobalTelemetry is the expected access point within Synapse and beyond.
 *
 * Setting up the fetch wrapper is managed here.
 * Wrapping of error handling is wired in by `src/utils/index.ts` exporting `src/telemetry/errors.ts#createError()`, which wraps `src/utilts/errors.ts`
 * Setting up the shutdown handling is managed here.
 */

import { type TelemetryConfig, type TelemetryRuntimeContext, TelemetryService } from './service.ts'

// Global telemetry instance
let telemetryInstance: TelemetryService | null = null

const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  sentryInitOptions: { enabled: true },
  sentrySetTags: { appName: 'synapse-sdk' },
}

/**
 * Initialize the global telemetry instance
 *
 * @param telemetry - TelemetryService instance
 */
export function initGlobalTelemetry(telemetryContext: TelemetryRuntimeContext, config?: TelemetryConfig): void {
  const telemetryConfig: TelemetryConfig = config ?? DEFAULT_TELEMETRY_CONFIG
  if (!shouldEnableTelemetry(telemetryConfig)) {
    return
  }

  telemetryInstance = new TelemetryService(telemetryConfig, telemetryContext)
  initGlobalFetchWrapper()
  setupShutdownHooks()
}

/**
 * Get the global telemetry instance
 *
 * @returns The global telemetry instance or null if not initialized
 */
export function getGlobalTelemetry(): TelemetryService | null {
  if (isGlobalTelemetryEnabled()) {
    return telemetryInstance
  }
  return null
}

/**
 * Remove the global telemetry instance
 *
 * Useful for testing or when telemetry should be disabled.
 */
export function removeGlobalTelemetry(): void {
  telemetryInstance = null
  removeGlobalFetchWrapper()
}

/**
 * Check if global telemetry is enabled
 *
 * @returns True if telemetry is initialized and enabled
 */
export function isGlobalTelemetryEnabled(): boolean {
  return telemetryInstance?.sentry?.isInitialized() ?? false
}

function setupShutdownHooks(opts: { timeoutMs?: number } = {}) {
  const g = globalThis as any
  const timeout = opts.timeoutMs ?? 2000
  let shuttingDown = false

  // NOTE: sentry handles uncaughtException and unhandledRejection. see https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries

  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    // -------- Browser runtime --------
    const flush = () => {
      // Don’t block; Sentry will use sendBeacon/fetch keepalive under the hood.
      void telemetryInstance?.sentry?.flush(timeout)
      removeGlobalFetchWrapper() // Remove the fetch wrapper to prevent further instrumentation
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
    // For Node.js, we only handle explicit termination signals.

    const handleSignal = () => {
      if (shuttingDown) return
      shuttingDown = true

      // Close the sentry to release resources
      void telemetryInstance?.sentry?.close(timeout).finally(() => {
        shuttingDown = false
        removeGlobalFetchWrapper() // Remove the fetch wrapper to prevent further instrumentation
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
 * - If a Synapse-using application has accessed the synapse singleton telemetry Sentry instance and started a span.
 *
 * Example cases where there won't be an active span:
 * - Directly invoking HTTP-inducing Synpase SDK functions from a node context.
 * In these cases, this wrapper creates a span before making the `fetch` call.
 */
function initGlobalFetchWrapper(): void {
  if (isFetchWrapped) {
    return // Already wrapped
  }

  isFetchWrapped = true

  ;(globalThis as any).fetch = async function wrappedFetch(
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> {
    // If telemetry disabled, use the original fetch
    // OR, we have an active span, and fetch calls will be instrumented by Sentry automatically
    const sentry = getGlobalTelemetry()?.sentry
    if (!sentry || sentry.getActiveSpan() != null) {
      return originalFetch(input, init)
    }
    const url = input instanceof Request ? new URL(input.url) : new URL(input.toString())
    const method = input instanceof Request ? input.method : init?.method || 'GET'

    // currently showing up as TWO items in the sentry UI..you can filter these out in the sentry Trace explorer with `!span.op:http.wrapper`
    return sentry.startSpan(
      {
        name: `${method} ${url.toString()}`, // Children span (including automatic Sentry instrumentation) inherit this name.
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
function removeGlobalFetchWrapper(): void {
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

/**
 * Determine if telemetry should be enabled based on configuration and environment
 *
 * @param config - User-provided telemetry configuration
 * @returns True if telemetry should be enabled
 */
function shouldEnableTelemetry(config?: TelemetryConfig): boolean {
  // If explicitly disabled by user config, respect that
  if (config?.sentryInitOptions?.enabled === false) {
    return false
  }

  // If disabled by environment variable, respect that
  if (isTelemetryDisabledByEnv()) {
    return false
  }

  // If in test environment, disable telemetry
  if (globalThis.process?.env?.NODE_ENV === 'test') {
    return false
  }

  // Default to enabled (unless explicitly disabled above)
  return true
}
