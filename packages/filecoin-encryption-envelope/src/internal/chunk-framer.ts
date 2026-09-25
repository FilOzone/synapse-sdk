/**
 * Reframes an arbitrarily-blocked input stream into fixed-size chunks for the
 * chunked AES-256-GCM scheme, one chunk per `next()` call.
 *
 * Ownership rule: a block passed to `writable`'s sink resolves its `write()`
 * promise only once the framer holds no reference to it any more. A chunk
 * that lies entirely inside one block, with more block bytes still to come,
 * is handed out as a zero-copy `subarray` view — cheap, but it keeps the
 * block alive. Once a block's unyielded tail is small enough to be a whole
 * chunk (the last one, full or partial), that tail is copied into an
 * internal buffer and the write resolves immediately: copying a bounded
 * amount of memory is what lets the caller reuse or transfer the block
 * without waiting on the consumer, and it is also what prevents deadlock —
 * `WritableStream` delivers blocks to `write()` one at a time, so a
 * still-referenced block would stall every block behind it.
 *
 * A plain object instead of an async generator: a generator's `return()` is
 * queued behind any `next()` already awaiting input, so `cancel()` while
 * waiting for a block would hang instead of settling immediately.
 */
import { describeCborType } from '../cose/headers.ts'
import { InvalidPlaintextError } from '../errors.ts'
import { assertArrayBufferBacked } from './keys.ts'

export interface FramedChunk {
  bytes: Uint8Array<ArrayBuffer>
  isLast: boolean
}

export interface ChunkFramer {
  /** Caller-facing input side. */
  writable: WritableStream<Uint8Array>
  /** Next chunk. A yielded chunk's bytes are valid only until the next call. Not called again after isLast. Rejects with the intake/abort error. */
  next(): Promise<FramedChunk>
  /** Consumer gave up: reject any pending write and error the writable with `reason`. */
  cancel(reason: unknown): void
}

function assertValidBlock(value: unknown): asserts value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidPlaintextError(`Invalid plaintext block: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  assertArrayBufferBacked(value, 'plaintext block', (message) => new InvalidPlaintextError(message))
}

export function createChunkFramer(chunkSize: number): ChunkFramer {
  const buffer = new Uint8Array(chunkSize)
  let bufferLength = 0

  let heldBlock: Uint8Array<ArrayBuffer> | undefined
  let heldBlockOffset = 0

  let closed = false
  // A separate flag from `error`: the reason itself may legitimately be
  // `undefined` (an unreasoned `writer.abort()`, or `cancel(undefined)`).
  let failed = false
  let error: unknown

  let writeResolve: (() => void) | undefined
  let writeReject: ((reason: unknown) => void) | undefined
  let pendingNext: { resolve: (chunk: FramedChunk) => void; reject: (reason: unknown) => void } | undefined
  let controller: WritableStreamDefaultController | undefined

  function emit(isLast: boolean): FramedChunk {
    const bytes = buffer.subarray(0, bufferLength) as Uint8Array<ArrayBuffer>
    bufferLength = 0
    return { bytes, isLast }
  }

  /** Copy as much of the held block's remaining bytes into `buffer` as fit; release the block once it is exhausted. */
  function drainHeldBlock(): void {
    if (heldBlock === undefined) return
    const remaining = heldBlock.length - heldBlockOffset
    const space = chunkSize - bufferLength
    const take = Math.min(space, remaining)
    buffer.set(heldBlock.subarray(heldBlockOffset, heldBlockOffset + take), bufferLength)
    bufferLength += take
    heldBlockOffset += take
    if (heldBlockOffset === heldBlock.length) {
      heldBlock = undefined
      heldBlockOffset = 0
      const resolve = writeResolve
      writeResolve = undefined
      writeReject = undefined
      resolve?.()
    }
  }

  /** Produce one chunk from current state, or `undefined` if more input is needed first. */
  function produceChunk(): FramedChunk | undefined {
    for (;;) {
      if (bufferLength === chunkSize) {
        if (heldBlock !== undefined) return emit(false) // more bytes are known to exist
        if (closed) return emit(true)
        return undefined // held full chunk: wait for more input or close to decide
      }
      if (heldBlock !== undefined) {
        const remaining = heldBlock.length - heldBlockOffset
        if (bufferLength === 0 && remaining > chunkSize) {
          // Zero-copy: this slice has more bytes after it in the same block.
          const start = heldBlockOffset
          heldBlockOffset += chunkSize
          return { bytes: heldBlock.subarray(start, start + chunkSize) as Uint8Array<ArrayBuffer>, isLast: false }
        }
        drainHeldBlock() // remaining tail (≤ chunkSize) or cross-block assembly
        continue
      }
      if (closed) return emit(true) // final partial chunk, or the empty-source chunk
      return undefined
    }
  }

  /** Advance state after new input arrives, without inventing a chunk nobody asked for yet. */
  function pump(): void {
    if (pendingNext !== undefined) {
      const chunk = produceChunk()
      if (chunk !== undefined) {
        const { resolve } = pendingNext
        pendingNext = undefined
        resolve(chunk)
      }
      return
    }
    if (heldBlock !== undefined) {
      const remaining = heldBlock.length - heldBlockOffset
      // Leave a would-be zero-copy slice alone; only bounded copying happens unprompted.
      if (!(bufferLength === 0 && remaining > chunkSize)) {
        drainHeldBlock()
      }
    }
  }

  function setError(reason: unknown): void {
    if (failed) return
    failed = true
    error = reason
    heldBlock = undefined
    if (pendingNext !== undefined) {
      const { reject } = pendingNext
      pendingNext = undefined
      reject(reason)
    }
    if (writeReject !== undefined) {
      const reject = writeReject
      writeResolve = undefined
      writeReject = undefined
      reject(reason)
    }
  }

  const writable = new WritableStream<Uint8Array>({
    start(c) {
      controller = c
      // WritableStream defers the sink's own abort() until any in-flight
      // write settles -- which, for a block bigger than chunkSize, only
      // happens once the consumer pulls it. The controller's signal fires
      // immediately instead, so a pending write can be rejected right away.
      c.signal.addEventListener('abort', () => setError(c.signal.reason))
    },
    write(chunk) {
      return new Promise<void>((resolve, reject) => {
        try {
          assertValidBlock(chunk)
        } catch (cause) {
          setError(cause)
          reject(cause)
          return
        }
        if (chunk.length === 0) {
          resolve() // no-op: an empty block carries nothing to frame
          return
        }
        heldBlock = chunk
        heldBlockOffset = 0
        writeResolve = resolve
        writeReject = reject
        pump()
      })
    },
    close() {
      closed = true
      pump()
    },
    // No abort() here: the signal listener in start() already covers it,
    // and runs sooner (abort() itself waits for an in-flight write).
  })

  function next(): Promise<FramedChunk> {
    if (failed) return Promise.reject(error)
    const chunk = produceChunk()
    if (chunk !== undefined) return Promise.resolve(chunk)
    return new Promise<FramedChunk>((resolve, reject) => {
      pendingNext = { resolve, reject }
    })
  }

  function cancel(reason: unknown): void {
    setError(reason)
    // A no-op on an already errored or closed stream, per the Streams spec.
    controller?.error(reason)
  }

  return { writable, next, cancel }
}
