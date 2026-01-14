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
 * Convert AsyncIterable or ReadableStream to ReadableStream
 * @param data - AsyncIterable or ReadableStream to convert
 * @returns ReadableStream
 */
export function asReadableStream(
  data: AsyncIterable<Uint8Array> | ReadableStream<Uint8Array>
): ReadableStream<Uint8Array> {
  return isReadableStream(data) ? data : asyncIterableToReadableStream(data)
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
 * Convert AsyncIterable to ReadableStream with broad browser compatibility.
 * Provides fallback for environments where ReadableStream.from() is not available.
 *
 * Uses pull-based streaming to implement proper backpressure and ensure all
 * chunks are consumed in order.
 */
export function asyncIterableToReadableStream(iterable: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  if (!isAsyncIterable(iterable)) {
    throw new Error('Input must be an AsyncIterable')
  }

  // Use native ReadableStream.from() if available
  // See https://developer.mozilla.org/en-US/docs/Web/API/ReadableStream/from_static for latest
  // support matrix, as of late 2025 this is still "Experimental"
  if (typeof ReadableStream.from === 'function') {
    return ReadableStream.from(iterable)
  }

  // Fallback implementation using pull-based streaming
  const iterator = iterable[Symbol.asyncIterator]()

  return new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await iterator.next()
        if (done) {
          controller.close()
        } else {
          controller.enqueue(value)
        }
      } catch (error) {
        // run cleanup on internal errors
        if (iterator.return) {
          try {
            await iterator.return()
          } catch {
            // safely ignore
          }
        }
        controller.error(error)
      }
    },
    async cancel() {
      // Clean up iterator if stream is cancelled
      if (iterator.return) {
        await iterator.return()
      }
    },
  })
}

/**
 * Convert Uint8Array to async iterable with optimal chunk size.
 *
 * Uses 2048-byte chunks for better hasher performance (determined by manual
 * testing with Node.js; this will likely vary by environment). This may not be
 * optimal for the streaming upload case, so further tuning may be needed to
 * find the best balance between hasher performance and upload chunk size.
 *
 * @param data - Uint8Array to convert
 * @param chunkSize - Size of chunks (default 2048)
 * @returns AsyncIterable yielding chunks
 */
export async function* uint8ArrayToAsyncIterable(
  data: Uint8Array,
  chunkSize: number = 2048
): AsyncIterable<Uint8Array> {
  for (let i = 0; i < data.length; i += chunkSize) {
    yield data.subarray(i, i + chunkSize)
  }
}
