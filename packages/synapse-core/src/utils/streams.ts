import { abortable } from './abort.ts'

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
 * Wrap an AsyncIterable in a ReadableStream. The first chunk is read before returning, so the
 * source's own errors reject here; cancelling the stream calls the iterator's `return`.
 *
 * @param iterable - The source to read
 * @param signal - Aborts the wait for the first chunk
 * @returns A stream of the iterable's chunks
 */
export async function readableStreamFromAsyncIterable<T>(
  iterable: AsyncIterable<T>,
  signal?: AbortSignal
): Promise<ReadableStream<T>> {
  const iterator = iterable[Symbol.asyncIterator]()
  let first: IteratorResult<T> | undefined
  try {
    first = await abortable(iterator.next(), signal)
  } catch (error) {
    Promise.resolve(iterator.return?.()).catch(() => undefined)
    throw error
  }
  return new ReadableStream<T>(
    {
      async pull(controller) {
        const result = first ?? (await iterator.next())
        first = undefined
        if (result.done) {
          controller.close()
          return
        }
        controller.enqueue(result.value)
      },
      async cancel(reason) {
        await iterator.return?.(reason)
      },
    },
    { highWaterMark: 0 }
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

/**
 * Read a byte stream to the end and concatenate its chunks.
 *
 * Rejects with the stream's own error if it errors. `new Response(stream).arrayBuffer()` is not a
 * substitute: browsers replace the stream's error with a generic `TypeError`.
 *
 * @param stream - The stream to read
 * @returns All bytes from the stream
 */
export async function readAllBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let totalLength = 0
  const reader = stream.getReader()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(value)
      totalLength += value.length
    }
  } finally {
    reader.releaseLock()
  }

  if (chunks.length === 1 && chunks[0] != null) {
    return chunks[0]
  }
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }
  return result
}
