/**
 * Type guard to check if a value is a ReadableStream
 * @param value - The value to check
 * @returns True if it's a ReadableStream
 */
export function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    'getReader' in value &&
    typeof (value as ReadableStream<Uint8Array>).getReader === 'function'
  )
}

/**
 * Type guard to check if a value is an AsyncIterable
 * @param value - The value to check
 * @returns True if it's an AsyncIterable
 */
export function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] === 'function'
  )
}

/**
 * Check if value is Uint8Array
 *
 * @param value - The value to check
 * @returns True if it's a Uint8Array
 */
export function isUint8Array(value: unknown): value is Uint8Array {
  return value instanceof Uint8Array || (ArrayBuffer.isView(value) && value.constructor.name === 'Uint8Array')
}

let _supportsStreamBody: boolean | undefined

/**
 * Detect whether the current environment supports ReadableStream as a fetch
 * request body. Firefox stringifies the stream to "[object ReadableStream]"
 * instead of consuming it, and Safari silently ignores the stream body and
 * the duplex option. This check catches both: a browser that stringifies will
 * set Content-Type to text/plain (string body), and one that ignores duplex
 * will fail the duplexAccessed gate. The try/catch handles any future browser
 * that throws on the Request constructor.
 *
 * Result is memoized after the first call.
 *
 * @see https://developer.chrome.com/docs/capabilities/web-apis/fetch-streaming-requests
 * @see https://bugzilla.mozilla.org/show_bug.cgi?id=1387483
 */
export function supportsStreamingFetchBody(): boolean {
  if (_supportsStreamBody !== undefined) return _supportsStreamBody
  try {
    let duplexAccessed = false
    // Absolute URL required: Node throws on `''` (no base URL).
    const hasContentType = new Request('http://x', {
      body: new ReadableStream(),
      method: 'POST',
      get duplex() {
        duplexAccessed = true
        return 'half'
      },
    } as RequestInit).headers.has('Content-Type')
    _supportsStreamBody = duplexAccessed && !hasContentType
  } catch {
    _supportsStreamBody = false
  }
  return _supportsStreamBody
}
