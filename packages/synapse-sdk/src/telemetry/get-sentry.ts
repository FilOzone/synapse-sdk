import type * as SentryBrowser from '@sentry/browser'
import type * as SentryNode from '@sentry/node'

// Dynamically import the correct Sentry package based on environment
const isBrowser =
  typeof (globalThis as any).window !== 'undefined' && typeof (globalThis as any).document !== 'undefined'

export type Sentry = typeof SentryNode.default | typeof SentryBrowser.default

export async function getSentry(): Promise<{ Sentry: Sentry; integrations: any[] }> {
  if (isBrowser) {
    const SentryBrowser = await import('@sentry/browser')
    return {
      Sentry: SentryBrowser,
      integrations: [
        SentryBrowser.browserTracingIntegration({
          ignoreResourceSpans: ['resource.script', 'resource.img', 'resource.css', 'resource.link'],
        }),
      ],
    }
  }
  const SentryNode = await import('@sentry/node')
  return {
    Sentry: SentryNode,
    integrations: [SentryNode.httpIntegration()],
  }
}
