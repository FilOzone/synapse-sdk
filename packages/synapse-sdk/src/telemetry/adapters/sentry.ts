import type { CustomEvent, HTTPEvent, OperationEvent, OperationType, TelemetryConfig } from '../types.ts'
import { BaseTelemetryAdapter } from './base-adapter.ts'
import { integrations, Sentry } from './sentry-dep.ts'

/**
 * Sentry telemetry adapter
 * Works in both Node.js and browser - sentry-dep.js is swapped via package.json "browser" field
 */
export class SentryAdapter extends BaseTelemetryAdapter {
  init(config: TelemetryConfig, tags: Record<string, string>): void {
    Sentry.init({
      dsn: 'https://3ed2ca5ff7067e58362dca65bcabd69c@o4510235322023936.ingest.us.sentry.io/4510235328184320',
      // Setting this option to false will prevent the SDK from sending default PII data to Sentry.
      // For example, automatic IP address collection on events
      sendDefaultPii: false,
      environment: config.environment || 'production',
      beforeSend: this.sanitizeEvent,
      // Enable tracing/performance monitoring
      tracesSampleRate: 1.0, // Capture 100% of transactions for development (adjust in production)
      // Integrations configured per-runtime in sentry-dep files
      integrations,
      debug: true, // Enable debug logging
    })

    Sentry.setContext('environment', {
      sdkVersion: tags.sdkVersion,
      runtime: tags.runtime,
      network: tags.network,
      ua: tags.ua,
      appName: tags.appName,
    })

    // Set global tags
    Sentry.setTag('sdk_version', tags.sdkVersion)
    Sentry.setTag('runtime', tags.runtime)
    Sentry.setTag('network', tags.network)

    if (tags.appName) {
      Sentry.setTag('app_name', tags.appName)
    }
  }

  captureError(error: Error, context?: Record<string, unknown>): void {
    Sentry.captureException(error, {
      tags: context?.operation ? { operation: String(context.operation) } : undefined,
      extra: context,
    })
  }

  captureHTTP(event: HTTPEvent): void {
    const startTime = new Date(event.ts).getTime()

    const span = Sentry.startInactiveSpan({
      name: `${event.method} ${event.urlTemplate}`,
      op: event.spOperation,
      startTime: startTime,
      attributes: {
        // Use standard searchable properties
        action: event.method, // HTTP method (GET, POST, etc.)
        domain: event.spHostname, // Hostname for searching
        description: `${event.method} ${event.urlTemplate}`, // Full description
        status_code: event.status?.toString(), // HTTP status code
        // Custom attributes for detailed info (not searchable)
        'http.url': event.urlTemplate,
        'http.request_id': event.requestId,
        'sp.path': event.spPath,
        'sp.operation': event.spOperation,
      },
    })
    span.setStatus(event.ok ? { code: 1 } : { code: 2, message: event.status?.toString() || 'Unknown error' })
    span.end()

    Sentry.addBreadcrumb({
      category: 'http',
      message: `${event.method} ${event.urlTemplate}`,
      data: {
        status: event.status,
        duration: event.durationMs,
        requestId: event.requestId,
        sp_hostname: event.spHostname,
        sp_path: event.spPath,
        sp_operation: event.spOperation,
        http_method: event.method,
        http_status: event.status?.toString(),
      },
      level: event.ok ? 'info' : 'error',
    })
  }

  captureOperation(event: OperationEvent): void {
    Sentry.addBreadcrumb({
      category: 'operation',
      message: event.operation,
      data: {
        params: event.params,
        success: event.success,
        duration: event.durationMs,
        requestId: event.requestId,
        operation_type: event.operation,
        operation_success: event.success.toString(),
        sdk_operation: 'true',
      },
      level: event.success ? 'info' : 'error',
    })
  }

  captureCustomEvent(event: CustomEvent): void {
    Sentry.addBreadcrumb({
      category: 'custom',
      message: event.name,
      data: {
        ...event.data,
        custom_event: 'true',
        event_name: event.name,
      },
      level: event.level,
    })
  }

  setContext(tags: Record<string, string>): void {
    Object.entries(tags).forEach(([key, value]) => {
      Sentry.setTag(key, value)
    })
  }

  startSpan(
    name: string,
    op: OperationType,
    context?: Record<string, unknown>
  ): {
    spanId: string
    end(error?: Error): void
  } {
    const span = Sentry.startInactiveSpan({
      name,
      op,
    })

    // Set context attributes if provided
    if (context && span) {
      Object.entries(context).forEach(([key, value]) => {
        span.setAttribute(key, String(value))
      })
    }

    const spanId = (span as any)?.spanContext?.()?.spanId || this.generateSpanId()

    return {
      spanId,
      end: (error?: Error) => {
        if (span) {
          if (error) {
            span.setStatus({ code: 2, message: error.message }) // 2 = ERROR
          } else {
            span.setStatus({ code: 1 }) // 1 = OK
          }
          span.end()
        }
      },
    }
  }

  /**
   * Flush pending Sentry events
   *
   * This ensures all queued events are sent before the process exits.
   */
  override async flush(timeout = 2000): Promise<boolean> {
    return await Sentry.close(timeout)
  }
}
