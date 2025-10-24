import { getGlobalTelemetry } from './singleton.ts'

let isWrapped = false
const originalFetch = (globalThis as any).fetch as typeof fetch

/**
 * Initialize global fetch wrapper with telemetry
 *
 * This patches globalThis.fetch to add telemetry tracking.
 * Safe to call multiple times - will only wrap once.
 */
export function initGlobalFetchWrapper(): void {
  if (isWrapped) {
    return // Already wrapped
  }

  isWrapped = true

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
        op: 'http.wrapper'
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
export function removeGlobalFetchWrapper(): void {
  if (!isWrapped) {
    return
  }

  ;(globalThis as any).fetch = originalFetch
  isWrapped = false
}
