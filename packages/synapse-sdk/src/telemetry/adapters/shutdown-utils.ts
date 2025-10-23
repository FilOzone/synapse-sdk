// telemetry/shutdown.ts
type Flushable = { flush: (timeoutMs?: number) => Promise<boolean> }

export function setupShutdownHooks(adapter: Flushable, opts: { timeoutMs?: number } = {}) {
  const g = globalThis as any
  const timeout = opts.timeoutMs ?? 2000
  let shuttingDown = false

  const once = () => () => {
    if (shuttingDown) return
    shuttingDown = true
    // fire and forget; don't call close()
    void adapter.flush(timeout).finally(() => {
      // In Node we may want to exit explicitly for fatal cases;
      // in browser do nothing—let navigation proceed.
      shuttingDown = false
    })
  }

  // NOTE: sentry (our only adapter at the moment) handles uncaughtException and unhandledRejection. see https://docs.sentry.io/platforms/javascript/troubleshooting/#third-party-promise-libraries

  if (typeof g.window !== 'undefined' && typeof g.document !== 'undefined') {
    // -------- Browser runtime --------
    const flush = () => {
      // Don’t block; Sentry will use sendBeacon/fetch keepalive under the hood.
      void adapter.flush(timeout)
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
    process.on('beforeExit', once())
    process.on('SIGINT', once())
    process.on('SIGTERM', once())
    process.on('SIGQUIT', once())
  }
}
