import type {
  CustomEvent,
  HTTPEvent,
  OperationEvent,
  OperationType,
  TelemetryAdapter,
  TelemetryConfig,
} from '../types.ts'

export abstract class BaseTelemetryAdapter implements TelemetryAdapter {
  abstract init(config: TelemetryConfig, tags: Record<string, string>): void
  abstract captureError(error: Error, context?: Record<string, unknown>): void
  abstract captureHTTP(event: HTTPEvent): void
  abstract captureOperation(event: OperationEvent): void
  abstract captureCustomEvent(event: CustomEvent): void
  abstract setContext(tags: Record<string, string>): void
  abstract startSpan(
    name: string,
    op: OperationType,
    context?: Record<string, unknown>
  ): {
    spanId: string
    end(error?: Error): void
  }

  /**
   * Flush pending events (optional, implemented by adapters that need it)
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
   * @returns Promise that resolves to true if all events were flushed
   */
  async flush?(timeout: number): Promise<boolean>

  /**
   * Shut down the telemetry adapter, flushing any pending events
   *
   * @param timeout - Maximum time to wait in milliseconds (default: 2000ms)
   * @returns Promise that resolves to true if all events were flushed
   */
  async close?(timeout: number): Promise<boolean>

  protected sanitizeEvent(event: any): any {
    // Allowlist approach: only include safe fields we explicitly want
    // Create a shallow copy to avoid mutating the original event
    const sanitized = { ...event }

    // Allowlist for request headers (only safe, non-sensitive headers)
    const allowedHeaders = ['content-type', 'accept', 'user-agent', 'content-length']
    if (sanitized.request?.headers) {
      const sanitizedHeaders: Record<string, string> = {}
      for (const header of allowedHeaders) {
        if (sanitized.request.headers[header]) {
          sanitizedHeaders[header] = sanitized.request.headers[header]
        }
      }
      sanitized.request = { ...sanitized.request, headers: sanitizedHeaders }
    }

    // Strip query strings from URL (keep only protocol, host, pathname)
    if (sanitized.request?.url) {
      const url = new URL(sanitized.request.url)
      sanitized.request = {
        ...sanitized.request,
        url: `${url.protocol}//${url.host}${url.pathname}`,
      }
    }

    // Allowlist for breadcrumb data fields
    const allowedBreadcrumbFields = [
      'status',
      'duration',
      'method',
      'requestId',
      'operation',
      'success',
      'params',
      'sp_hostname',
      'sp_path',
      'sp_operation',
      'http_method',
      'http_status',
      'operation_type',
      'operation_success',
      'sdk_operation',
      'custom_event',
      'event_name',
    ]

    if (sanitized.breadcrumbs) {
      sanitized.breadcrumbs = sanitized.breadcrumbs.map((crumb: any) => {
        const sanitizedCrumb = { ...crumb }
        if (sanitizedCrumb.data) {
          const sanitizedData: Record<string, any> = {}
          for (const field of allowedBreadcrumbFields) {
            if (sanitizedCrumb.data[field] !== undefined) {
              sanitizedData[field] = sanitizedCrumb.data[field]
            }
          }
          sanitizedCrumb.data = sanitizedData
        }
        return sanitizedCrumb
      })
    }

    return sanitized
  }

  protected generateSpanId(): string {
    return Array.from(crypto.getRandomValues(new Uint8Array(8)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }
}
