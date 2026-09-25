/**
 * Reframes an arbitrarily blocked input stream into fixed-size chunks for the
 * chunked AES-256-GCM scheme, returning one chunk per `next()` call.
 *
 * Ownership rule: a block written to `writable` remains owned by the framer
 * until its `write()` promise resolves. When a chunk fits entirely within a
 * block and more bytes remain, it is returned as a zero-copy `subarray` view,
 * which keeps the block alive. Once the remaining tail fits in a single chunk
 * (full or partial), it is copied into an internal buffer and the write
 * resolves. This bounded copy lets the caller reuse or transfer the block
 * without waiting for the consumer and prevents deadlock: `WritableStream`
 * delivers blocks to `write()` sequentially, so retaining one block would
 * stall those behind it.
 *
 * This uses a plain object instead of an async generator because a generator's
 * `return()` is queued behind a `next()` already waiting for input. With a
 * plain object, `cancel()` can settle immediately while waiting for a block.
 */
import { describeCborType } from '../cose/headers.ts'
import { InvalidPlaintextError, InvalidPlaintextLengthError } from '../errors.ts'
import { assertArrayBufferBacked } from './keys.ts'

/** One plaintext chunk; `isLast` marks the final one. */
export interface FramedChunk {
  bytes: Uint8Array<ArrayBuffer>
  isLast: boolean
}

/** Plaintext input and pull-based chunk output. */
export interface ChunkFramer {
  /** Accept plaintext blocks. `write()` resolves once the block is no longer referenced. */
  writable: WritableStream<Uint8Array>
  /**
   * Pull the next chunk. Its bytes are only valid until the next call; don't
   * call again after `isLast`. Rejects if the input failed or was aborted.
   */
  next(): Promise<FramedChunk>
  /** Stop from the output side: rejects a pending write and errors `writable`. */
  cancel(reason: unknown): void
  /** Throw if input has failed or been aborted. */
  throwIfFailed(): void
}

function assertValidBlock(value: unknown): asserts value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidPlaintextError(`Invalid plaintext block: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  assertArrayBufferBacked(value, 'plaintext block', (message) => new InvalidPlaintextError(message))
}

/**
 * Create a framer that accepts plaintext blocks of any size and returns
 * fixed-size chunks through `next()`. The final chunk is flagged after the
 * writable stream closes.
 *
 * @param chunkSize Plaintext bytes per chunk. Validated by the caller.
 * @param expectedLength Exact total plaintext bytes, if known.Checked 
 *   as blocks arrive (one byte over fails that write) and at
 *   close (short fails the close), so a mismatch never yields the last chunk
 *   and no per-chunk length check is needed.
 */
export function createChunkFramer(chunkSize: number, expectedLength?: number): ChunkFramer {
  const buffer = new Uint8Array(chunkSize)
  let bufferLength = 0
  let consumedBytes = 0

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

  /** Copy what fits of the held block into `buffer`; release the block (resolving its write) once it's used up. */
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

  /** Next chunk from what's buffered or held, or `undefined` if more input is needed first. */
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

  /** React to a new block or close: answer a waiting `next()`, or else copy a short tail so the write can resolve. */
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
      // `WritableStream.abort()` waits for any in-flight write to settle. For a
      // block larger than `chunkSize`, that depends on the consumer pulling it.
      // The controller signal fires immediately, so a pending write can be rejected right away.
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
        if (expectedLength !== undefined) {
          consumedBytes += chunk.length
          if (consumedBytes > expectedLength) {
            const cause = new InvalidPlaintextLengthError(
              `Invalid plaintext: expected exactly ${expectedLength} bytes, but intake reached ` +
                `${consumedBytes} bytes and the source has not finished.`
            )
            setError(cause)
            reject(cause)
            return
          }
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
      if (expectedLength !== undefined && consumedBytes !== expectedLength) {
        const cause = new InvalidPlaintextLengthError(
          `Invalid plaintext: expected exactly ${expectedLength} bytes, but only ${consumedBytes} bytes were ` +
            'written before the source closed.'
        )
        setError(cause)
        throw cause
      }
      closed = true
      pump()
    },
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

  function throwIfFailed(): void {
    if (failed) throw error
  }

  return { writable, next, cancel, throwIfFailed }
}
