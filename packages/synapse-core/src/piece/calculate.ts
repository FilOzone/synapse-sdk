/**
 * Compute PieceCIDs from data: bytes, blobs, streams, or async iterables.
 */

import { create as createHasher, digest as wasmDigest } from '@hugomrdias/commp-wasm'
import { isAsyncIterable, isReadableStream } from '../utils/streams.ts'
import * as Digest from './internal/digest.ts'
import { PieceCID } from './piece-cid.ts'

/**
 * Input types accepted by {@link calculate}.
 *
 * - `Uint8Array`: hashed synchronously.
 * - `Blob` / `File`: streamed via `Blob.stream()`.
 * - `ReadableStream<Uint8Array>`: consumed via async iteration.
 * - `AsyncIterable<Uint8Array>`: consumed chunk-by-chunk.
 */
export type CalculateInput = Uint8Array | Blob | ReadableStream<Uint8Array> | AsyncIterable<Uint8Array>

/**
 * Compute the PieceCID of `input`. Always returns a Promise. For the
 * synchronous bytes case, use {@link hasher} directly.
 */
export async function calculate(input: CalculateInput): Promise<PieceCID> {
  if (input instanceof Uint8Array) {
    return toPieceCID(wasmDigest(input))
  }

  const h = createHasher()
  try {
    const stream = input instanceof Blob ? input.stream() : input
    for await (const chunk of asyncIterableOf(stream)) {
      h.write(chunk)
    }
    return toPieceCID(h.digest())
  } finally {
    h.free()
  }
}

/**
 * Imperative incremental hasher. Use for sync code paths or when integrating
 * with libraries that expose chunk-level callbacks.
 */
export interface PieceHasher {
  /** Append bytes. Returns `this` for chaining. */
  write(chunk: Uint8Array): PieceHasher
  /** Total bytes written so far. */
  count(): bigint
  /** Finalize and return the PieceCID. Non-destructive, further writes are allowed. */
  finalize(): PieceCID
  /** Reset to initial state for reuse. */
  reset(): PieceHasher
}

/**
 * Create a new {@link PieceHasher}.
 *
 * @example
 * ```ts
 * const h = Piece.hasher()
 * h.write(chunk1)
 * h.write(chunk2)
 * const piece = h.finalize()
 * ```
 */
export function hasher(): PieceHasher {
  // WASM memory is released by the package's FinalizationRegistry once the
  // facade is garbage collected.
  const h = createHasher()
  const facade: PieceHasher = {
    write(chunk) {
      h.write(chunk)
      return facade
    },
    count: () => h.count(),
    finalize: () => toPieceCID(h.digest()),
    reset() {
      h.reset()
      return facade
    },
  }
  return facade
}

/**
 * A pass-through {@link TransformStream} that computes the PieceCID of the
 * data flowing through it. The {@link PieceCIDTransform.result} promise
 * resolves once the input stream closes.
 *
 * @example
 * ```ts
 * const { transform, result } = Piece.transformStream()
 * await source.pipeThrough(transform).pipeTo(uploadSink)
 * const piece = await result
 * ```
 */
export interface PieceCIDTransform {
  readonly transform: TransformStream<Uint8Array, Uint8Array>
  readonly result: Promise<PieceCID>
}

export function transformStream(): PieceCIDTransform {
  const h = createHasher()
  const { promise: result, resolve, reject } = Promise.withResolvers<PieceCID>()

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      try {
        h.write(chunk)
        controller.enqueue(chunk)
      } catch (err) {
        reject(err)
        controller.error(err)
      }
    },
    flush() {
      try {
        resolve(toPieceCID(h.digest()))
      } catch (err) {
        reject(err)
      } finally {
        h.free()
      }
    },
  })

  return { transform, result }
}

function toPieceCID(digest: { bytes: Uint8Array }): PieceCID {
  return PieceCID._fromDigest(Digest.fromBytes(digest.bytes))
}

function asyncIterableOf<T>(source: AsyncIterable<T> | ReadableStream<T>): AsyncIterable<T> {
  if (isAsyncIterable(source as AsyncIterable<Uint8Array>)) {
    return source as AsyncIterable<T>
  }
  if (!isReadableStream(source as ReadableStream<Uint8Array>)) {
    throw new TypeError('Piece.calculate input must be Uint8Array, Blob, ReadableStream, or AsyncIterable')
  }
  // ReadableStream in some environments lacks Symbol.asyncIterator; fall back to getReader.
  return {
    [Symbol.asyncIterator]() {
      const reader = (source as ReadableStream<T>).getReader()
      return {
        async next(): Promise<IteratorResult<T>> {
          const { done, value } = await reader.read()
          if (done) return { done: true, value: undefined }
          return { done: false, value }
        },
        async return(): Promise<IteratorResult<T>> {
          reader.releaseLock()
          return { done: true, value: undefined }
        },
      }
    },
  }
}
