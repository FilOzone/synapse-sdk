/** Small fixtures and stream plumbing shared across test suites. */
import assert from 'assert'
import { ALG_A256KW } from '../src/cose/constants.ts'
import type { ByteRange, RandomAccessSource } from '../src/index.ts'
import type { A256KWRecipient, Unwrapper } from '../src/recipients/types.ts'
import { readAllChunks } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'

/** Builds an A256KW recipient with independent copies of its key and identifier. */
export function a256kwRecipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
  return kid === undefined
    ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
    : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
}

/**
 * Write one block, close the pair, and collect the readable side's chunks.
 * `write()`/`close()` rejections are caught here so they never become
 * unhandled rejections -- a failure still surfaces through the awaited read,
 * which every caller already checks.
 */
export async function pipeChunks(
  pair: ReadableWritablePair<Uint8Array, Uint8Array>,
  input: Uint8Array
): Promise<Uint8Array<ArrayBuffer>[]> {
  const writer = pair.writable.getWriter()
  const writeDone = writer.write(input)
  const closeDone = writer.close()
  writeDone.catch(() => {
    // Surfaced via the drained read either way; avoid an unhandled rejection.
  })
  closeDone.catch(() => {
    // Same: a failed object rejects close(), the read already reports it.
  })
  const chunks = await readAllChunks(pair.readable)
  await writeDone
  await closeDone
  return chunks
}

/** Like `pipeChunks`, but concatenated into one `Uint8Array`. */
export async function pipeBytes(
  pair: ReadableWritablePair<Uint8Array, Uint8Array>,
  input: Uint8Array
): Promise<Uint8Array> {
  return concatBytes(...(await pipeChunks(pair, input)))
}

/** An `Unwrapper` that fails the test if it's ever invoked. */
export function neverCalledUnwrapper(): { unwrapper: Unwrapper; assertNeverCalled: () => void } {
  let calls = 0
  return {
    unwrapper: async () => {
      calls++
      return undefined
    },
    assertNeverCalled: () => assert.strictEqual(calls, 0),
  }
}

/** The offset of the first occurrence of `needle` in `haystack`. Throws if `haystack` never contains it. */
export function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) continue outer
    }
    return offset
  }
  throw new Error('test helper: subsequence not found')
}

/** The plaintext bytes `range` describes, from the documented semantics only -- not from planRange. */
export function expectedSlice(fullPlaintext: Uint8Array, range: ByteRange): Uint8Array {
  const total = fullPlaintext.length
  if (range.offset < 0) {
    return fullPlaintext.subarray(Math.max(0, total + range.offset))
  }
  const end = range.length === undefined ? total : Math.min(total, range.offset + range.length)
  return fullPlaintext.subarray(range.offset, end)
}

/**
 * A `RandomAccessSource` that records every `openRange` call and cancellation
 * against `bytes`, delivering each opened span in 64-byte pieces so a
 * span that completes early still has bytes left to actually cancel.
 */
export function recordingSource(bytes: Uint8Array): {
  source: RandomAccessSource
  calls: Array<{ offset: number; length: number }>
  cancelled: Array<{ offset: number; length: number }>
} {
  const calls: Array<{ offset: number; length: number }> = []
  const cancelled: Array<{ offset: number; length: number }> = []
  const source: RandomAccessSource = {
    size: bytes.length,
    async openRange(offset, length) {
      calls.push({ offset, length })
      const slice = bytes.subarray(offset, offset + length)
      let pos = 0
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pos >= slice.length) {
              controller.close()
              return
            }
            const end = Math.min(pos + 64, slice.length)
            controller.enqueue(slice.subarray(pos, end))
            pos = end
          },
          cancel() {
            cancelled.push({ offset, length })
          },
        },
        // Without this, the default queuing strategy (highWaterMark: 1)
        // eagerly pulls one block ahead of every explicit read() -- which
        // could self-close before a caller ever gets to cancel it.
        { highWaterMark: 0 }
      )
    },
  }
  return { source, calls, cancelled }
}
