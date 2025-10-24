// telemetry/shutdown.ts
import { removeGlobalFetchWrapper } from './fetch-wrapper.ts'
import type { Sentry as SentryType } from './get-sentry.js'

export function setupShutdownHooks(sentry: SentryType, opts: { timeoutMs?: number } = {}) {
  const g = globalThis as any
  const timeout = opts.timeoutMs ?? 2000
  let shuttingDown = false

  // NOTE: sentry handles uncaughtException and unhandledRejection. see https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries

  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    // -------- Browser runtime --------
    const flush = () => {
      // Don’t block; Sentry will use sendBeacon/fetch keepalive under the hood.
      void sentry.flush(timeout)
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
      void sentry.close(timeout).finally(() => {
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
