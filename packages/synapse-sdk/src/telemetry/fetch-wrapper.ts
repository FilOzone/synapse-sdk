/**
 * Global fetch wrapper for automatic HTTP telemetry
 *
 * ## Design Decision: Global Wrapper vs Dependency Injection
 *
 * This implementation uses a global fetch wrapper rather than passing a wrapped
 * fetch function through constructor parameters. This approach was chosen for:
 *
 * **Maintainability:**
 * - Avoids modifying constructors across multiple classes (PDPServer, SubgraphService,
 *   FilBeamRetriever, retriever utilities, etc.)
 * - New services automatically get telemetry without code changes
 * - Reduces risk of breaking existing code
 *
 * **Easy Removal:**
 * - Single line to enable: `initGlobalFetchWrapper(telemetry)`
 * - Single line to disable: simply don't call it
 * - To remove entirely: delete telemetry folder and the init call
 * - No need to refactor constructors or thread dependencies
 *
 * **Scope Isolation:**
 * - PDPServer is created deep in the call chain (Synapse → StorageManager →
 *   StorageContext → PDPServer), so dependency injection would require threading
 *   fetch through 4+ classes
 * - Global wrapper keeps telemetry concerns separate from business logic
 *
 * **Trade-offs:**
 * - Global state means multiple Synapse instances share the same wrapper
 * - Testing requires cleanup via removeGlobalFetchWrapper()
 * - Less "pure" than dependency injection but more pragmatic for this codebase
 *
 * The wrapper is idempotent and safe to call multiple times.
 *
 * ## Functionality
 *
 * Automatically adds to every fetch call:
 * - Correlation headers (traceparent, x-synapse-request-id, x-synapse-sdk-version)
 * - HTTP timing and status tracking
 * - Storage provider identification for filtering
 */

import type { HTTPEvent } from './types.ts'
import { getGlobalTelemetry, isGlobalTelemetryEnabled } from './singleton.ts'

let isWrapped = false
const originalFetch = globalThis.fetch

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

  globalThis.fetch = async function wrappedFetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    // If telemetry disabled, use original fetch
    if (!isGlobalTelemetryEnabled()) {
      return originalFetch(input, init)
    }

    const startTime = Date.now()
    const requestId = generateRequestId()
    const traceId = generateTraceId()
    const spanId = generateSpanId()

    // Parse URL for tracking
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const parsedUrl = new URL(url)

    // Inject correlation headers
    const headers = new Headers(init?.headers)
    headers.set('traceparent', `00-${traceId}-${spanId}-01`)
    headers.set('x-synapse-request-id', requestId)
    headers.set('x-synapse-sdk-version', '0.34.0') // TODO: Get from package.json

    const ts = new Date().toISOString()
    try {
      const response = await originalFetch(input, {
        ...init,
        headers,
      })

      const durationMs = Date.now() - startTime

      // Extract SP information from URL
      const spInfo = extractSPInfo(parsedUrl, init?.method || 'GET')

      const httpEvent: HTTPEvent = {
        type: 'http',
        method: init?.method || 'GET',
        urlTemplate: `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`,
        status: response.status,
        ok: response.ok,
        durationMs,
        spHostname: spInfo.hostname,
        spPath: spInfo.path,
        spOperation: spInfo.operation,
        requestId,
        ts,
      }

      getGlobalTelemetry()?.captureHTTP(httpEvent)

      return response
    } catch (error) {
      const durationMs = Date.now() - startTime

      // Extract SP information from URL
      const spInfo = extractSPInfo(parsedUrl, init?.method || 'GET')

      const httpEvent: HTTPEvent = {
        type: 'http',
        method: init?.method || 'GET',
        urlTemplate: `${parsedUrl.protocol}//${parsedUrl.host}${parsedUrl.pathname}`,
        status: 500,
        ok: false,
        durationMs,
        spHostname: spInfo.hostname,
        spPath: spInfo.path,
        spOperation: spInfo.operation,
        requestId,
        ts,
      }

      getGlobalTelemetry()?.captureHTTP(httpEvent)

      throw error
    }
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

  globalThis.fetch = originalFetch
  isWrapped = false
}

/**
 * Extract storage provider information from URL
 *
 * Helps identify which SP and operation is being called
 */
function extractSPInfo(
  url: URL,
  method: string
): {
  hostname: string
  path: string
  operation: string
} {
  const hostname = url.hostname
  const path = url.pathname

  // Infer operation from URL path patterns
  let operation = 'unknown'

  if (path.includes('/pdp/data-sets')) {
    if (method === 'POST') {
      operation = 'create-dataset'
    } else if (method === 'GET') {
      operation = 'get-dataset'
    }
  } else if (path.includes('/pdp/pieces')) {
    if (method === 'POST') {
      operation = 'add-piece'
    } else if (method === 'DELETE') {
      operation = 'delete-piece'
    }
  } else if (path.includes('/pdp/piece')) {
    if (method === 'POST') {
      operation = 'create-upload-session'
    } else if (method === 'PUT') {
      operation = 'upload-piece'
    } else if (method === 'GET') {
      // Distinguish between find-pieces and get-piece
      if (path === '/pdp/piece' || path === '/pdp/piece/') {
        operation = 'find-pieces'
      } else {
        operation = 'get-piece'
      }
    }
  } else if (path.includes('/graphql') || hostname.includes('subgraph')) {
    operation = 'subgraph-query'
  } else if (hostname.includes('filbeam')) {
    operation = 'cdn-retrieval'
  }

  return {
    hostname,
    path,
    operation,
  }
}

/**
 * Generate unique request ID
 */
function generateRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
}

/**
 * Generate W3C trace ID (32 hex chars)
 */
function generateTraceId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * Generate W3C span ID (16 hex chars)
 */
function generateSpanId(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
