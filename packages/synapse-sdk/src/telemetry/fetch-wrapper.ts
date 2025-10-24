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
    // If telemetry disabled, use original fetch
    const sentry = getGlobalTelemetry()?.sentry
    if (!sentry) {
      return originalFetch(input, init)
    }

    // Create a more specific span name
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const method = init?.method || 'GET'
    const spanName = `${method} ${url}`

    // currently showing up as TWO items in the sentry UI.. but without this global fetch wrapper, there are NO items in the sentry UI for HTTP requests...
    return sentry.startSpan(
      {
        name: spanName,
        op: 'http.client',
      },
      async (span) => {
        const response = await originalFetch(input, init)

        span.setAttribute('http.method', method)
        span.setAttribute('http.url', url)
        span.setAttribute('http.status', response.status)
        span.setAttribute('http.statusText', response.statusText)

        return response
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
