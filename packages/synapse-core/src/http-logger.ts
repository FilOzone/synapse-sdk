/**
 * Simple HTTP Logger interface for logging HTTP requests and responses
 *
 * Used to log HTTP requests made to PDP servers (Curio) for debugging and monitoring.
 * This is a minimal interface that can be implemented by higher-level packages.
 *
 * @example
 * ```typescript
 * const httpLogger: HTTPLogger = {
 *   logRequest: (method, url) => console.log(`HTTP ${method} ${url}`),
 *   logResponse: (method, url, statusCode) => console.log(`HTTP ${method} ${url} → ${statusCode}`)
 * }
 * ```
 */
export interface HTTPLogger {
  /**
   * Log an HTTP request before it is sent
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param url - Full URL of the request
   */
  logRequest(method: string, url: string): void

  /**
   * Log an HTTP response after it is received
   * @param method - HTTP method (GET, POST, PUT, DELETE, etc.)
   * @param url - Full URL of the request
   * @param statusCode - HTTP status code (200, 404, 500, etc.)
   */
  logResponse(method: string, url: string, statusCode: number): void
}
