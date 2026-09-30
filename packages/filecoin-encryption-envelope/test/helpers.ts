/** Small fixtures and stream plumbing shared across test suites. */
import { ALG_A256KW } from '../src/cose/constants.ts'
import type { RandomAccessSource } from '../src/index.ts'
import type { A256KWRecipient } from '../src/recipients/types.ts'
import { readAllChunks } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'

/** Builds an A256KW recipient with independent copies of its key and identifier. */
export function a256kwRecipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
  return kid === undefined
    ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
    : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
}

/** Write one block, close the pair, and collect its output bytes. */
export async function pipeBytes(
  pair: ReadableWritablePair<Uint8Array, Uint8Array>,
  input: Uint8Array
): Promise<Uint8Array> {
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
  return concatBytes(...chunks)
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
