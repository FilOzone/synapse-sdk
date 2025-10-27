import { getGlobalTelemetry } from './singleton.ts'

let isWrapped = false
const originalFetch = (globalThis as any).fetch as typeof fetch

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
export function removeGlobalFetchWrapper(): void {
  if (!isWrapped) {
    return
  }

  ;(globalThis as any).fetch = originalFetch
  isWrapped = false
}
