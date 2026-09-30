/**
 * Random-access byte sources for range decryption: the `RandomAccessSource`
 * contract, adapting a plain `Uint8Array` or a caller object to it, reading
 * exactly one requested range, and reading a chunked envelope from one
 * without loading the whole object. See docs/implementation-guide.md, "Random-access
 * source contract".
 */

import { MAX_ENCODED_OBJECT_SIZE } from '../constants.ts'
import { MAX_ENVELOPE_SIZE } from '../cose/constants.ts'
import type { DecodedEnvelope } from '../cose/decode.ts'
import { createEnvelopeScanner } from '../cose/envelope-scanner.ts'
import { describeCborType } from '../cose/headers.ts'
import { InvalidSourceLengthError, MalformedEnvelopeError } from '../errors.ts'
import { assertArrayBufferBacked } from '../internal/keys.ts'

/** One immutable encoded FEE object, readable by byte range. */
export interface RandomAccessSource {
  /** Exact size of the encoded object: envelope plus detached ciphertext. */
  readonly size: number
  /**
   * Open the half-open byte range `[offset, offset + length)`. The returned
   * stream must produce exactly `length` bytes and then close; a short or long
   * response is rejected rather than reinterpreted, and a stream error
   * propagates unchanged.
   */
  openRange(offset: number, length: number): Promise<ReadableStream<Uint8Array>>
}

function assertValidSourceSize(size: unknown): asserts size is number {
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > MAX_ENCODED_OBJECT_SIZE) {
    throw new InvalidSourceLengthError(
      `Invalid range source size: ${describeCborType(size)} ${String(size)}. Expected a non-negative safe integer of at most ${MAX_ENCODED_OBJECT_SIZE} bytes.`
    )
  }
}

/**
 * Adapt `input` to `RandomAccessSource`: a `Uint8Array` (the whole object
 * already in memory) or an object already shaped like one. This is the one
 * place that validates a caller-supplied source.
 *
 * `size` and `openRange` are each read from `input` exactly once, so a
 * getter or a later mutation can't change what the rest of the library sees.
 * A `Uint8Array` input is borrowed, not copied, until every range opened
 * from it is fully read or cancelled.
 */
export function toRandomAccessSource(input: unknown): RandomAccessSource {
  if (input instanceof Uint8Array) {
    assertArrayBufferBacked(input, 'range source', (message) => new MalformedEnvelopeError(message))
    const bytes = input
    return {
      size: bytes.length,
      openRange(offset, length) {
        return Promise.resolve(
          new ReadableStream<Uint8Array>({
            start(controller) {
              // Borrowed, not copied: the caller must not modify `input`
              // until every range read from it has completed.
              controller.enqueue(bytes.subarray(offset, offset + length))
              controller.close()
            },
          })
        )
      },
    }
  }

  if (input === null || typeof input !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid range source: expected a Uint8Array or an object, got ${describeCborType(input)}.`
    )
  }

  const { size, openRange } = input as { size: unknown; openRange: unknown }
  assertValidSourceSize(size)
  if (typeof openRange !== 'function') {
    throw new MalformedEnvelopeError(
      `Invalid range source: openRange must be a function, got ${describeCborType(openRange)}.`
    )
  }
  const boundOpenRange = openRange as RandomAccessSource['openRange']
  return {
    size,
    openRange: (offset, length) => boundOpenRange.call(input, offset, length),
  }
}

/** One block, or the underlying stream's end, from `readNextNonEmpty`. */
type NextBlock = { done: true } | { done: false; value: Uint8Array<ArrayBuffer> }

async function readNextNonEmpty(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<NextBlock> {
  for (;;) {
    const { value, done } = await reader.read()
    if (done) return { done: true }
    if (!(value instanceof Uint8Array)) {
      throw new MalformedEnvelopeError(
        `Invalid range source block: expected a Uint8Array, got ${describeCborType(value)}.`
      )
    }
    assertArrayBufferBacked(value, 'range source block', (message) => new MalformedEnvelopeError(message))
    // Content-free chunks carry no bytes to count; keep reading past them.
    if (value.length === 0) continue
    return { done: false, value }
  }
}

/** A reader over one opened range, confirmed to produce exactly `length` bytes. */
export interface ExactRangeReader {
  /** The next non-empty block, or `undefined` once exactly `length` bytes are confirmed complete. */
  read(): Promise<Uint8Array<ArrayBuffer> | undefined>
  /** Stop early. Safe to call at any point, including before the first `read()`. */
  cancel(reason?: unknown): Promise<void>
}

/**
 * Open `[offset, offset + length)` from `source` and read it back as exactly
 * `length` bytes, or fail with `InvalidSourceLengthError`. Reused wherever a
 * caller needs one range's bytes without trusting the source to have
 * measured them correctly: too few, too many, or extra bytes discovered only
 * after the count matches are all rejected.
 *
 * `openRange` itself is called at most once. A throw or rejection from it, or
 * from the stream it returns, propagates unchanged -- those are the source's
 * own transport errors, not this reader's to interpret.
 */
export function openExactRange(source: RandomAccessSource, offset: number, length: number): ExactRangeReader {
  let readerPromise: Promise<ReadableStreamDefaultReader<Uint8Array>> | undefined
  let opened = false
  let received = 0
  let finished = false

  function getReader(): Promise<ReadableStreamDefaultReader<Uint8Array>> {
    if (readerPromise === undefined) {
      readerPromise = (async () => {
        const stream = await source.openRange(offset, length)
        if (!(stream instanceof ReadableStream)) {
          throw new MalformedEnvelopeError(
            `Invalid range source: openRange(${offset}, ${length}) must resolve to a ReadableStream, got ${describeCborType(stream)}.`
          )
        }
        opened = true
        return stream.getReader()
      })()
    }
    return readerPromise
  }

  async function read(): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (finished) return undefined
    const reader = await getReader()
    try {
      return await readValidated(reader)
    } catch (cause) {
      // Release the source (e.g. an HTTP body) instead of leaving it open.
      await reader.cancel(cause).catch(() => undefined)
      throw cause
    }
  }

  async function readValidated(
    reader: ReadableStreamDefaultReader<Uint8Array>
  ): Promise<Uint8Array<ArrayBuffer> | undefined> {
    if (received === length) {
      // Every requested byte was already returned by an earlier call. A
      // normal `while ((block = await read()) !== undefined)` loop reaches
      // this exact branch on its last iteration, so this is where "nothing
      // more is coming" gets confirmed -- read() must not report done
      // (return undefined) without having checked.
      const trailing = await readNextNonEmpty(reader)
      if (!trailing.done) {
        throw new InvalidSourceLengthError(
          `Invalid range source: openRange(${offset}, ${length}) produced extra bytes after the ${length} requested were already read.`
        )
      }
      finished = true
      return undefined
    }

    const next = await readNextNonEmpty(reader)
    if (next.done) {
      throw new InvalidSourceLengthError(
        `Invalid range source: openRange(${offset}, ${length}) produced only ${received} of the ${length} requested bytes before ending.`
      )
    }

    const { value } = next
    if (received + value.length > length) {
      throw new InvalidSourceLengthError(
        `Invalid range source: openRange(${offset}, ${length}) produced more than the ${length} requested bytes.`
      )
    }
    received += value.length
    return value
  }

  function cancel(reason?: unknown): Promise<void> {
    if (readerPromise === undefined) return Promise.resolve()
    // Nothing useful to report if the source fails to cancel.
    const cancelled = readerPromise.then(
      (reader) => reader.cancel(reason).catch(() => undefined),
      () => undefined
    )
    // A pending openRange has no abort signal: don't let a hung open hang
    // cancellation. Its stream is still cancelled whenever it arrives.
    return opened ? cancelled : Promise.resolve()
  }

  return { read, cancel }
}

/**
 * Read just enough of `source` to decode its envelope, without loading the
 * detached ciphertext.
 *
 * Probes contiguous, doubling spans starting at `[0, min(4096, size))`, each
 * capped so it never crosses `size` or the 1 MiB envelope limit. Every block
 * is fed to a fresh `createEnvelopeScanner()`; once it completes, the rest of
 * that span is cancelled without being read. An envelope decode error, or a
 * span of the wrong length (`InvalidSourceLengthError`), fails immediately --
 * no further span is opened after one.
 */
export async function readEnvelope(source: RandomAccessSource): Promise<DecodedEnvelope> {
  const scanner = createEnvelopeScanner()
  let offset = 0
  let length = Math.min(4096, source.size, MAX_ENVELOPE_SIZE)

  while (offset < source.size) {
    const range = openExactRange(source, offset, length)
    for (;;) {
      const block = await range.read()
      if (block === undefined) break
      let result: ReturnType<typeof scanner.push>
      try {
        result = scanner.push(block)
      } catch (cause) {
        await range.cancel(cause)
        throw cause
      }
      if (result !== undefined) {
        await range.cancel()
        return result.decoded
      }
    }
    offset += length
    length = Math.min(length * 2, source.size - offset, MAX_ENVELOPE_SIZE - offset)
  }

  // Ran out of source bytes (including size === 0) without a complete
  // envelope: always throws MalformedEnvelopeError.
  scanner.finish()
  throw new Error('unreachable: scanner.finish() always throws once the envelope did not complete')
}
