import assert from 'node:assert'
import { encrypt as encryptWholeObject } from '../src/aes-gcm.ts'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from '../src/constants.ts'
import { ALG_A256KW } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import {
  AuthenticationError,
  InvalidCiphertextLengthError,
  InvalidKeyError,
  InvalidRangeError,
  InvalidSourceLengthError,
  MalformedEnvelopeError,
  UnsupportedSchemeError,
} from '../src/errors.ts'
import { parse } from '../src/inspect.ts'
import { decryptRange } from '../src/range-decrypt.ts'
import { type ByteRange, planRange } from '../src/range-plan.ts'
import type { RandomAccessSource } from '../src/range-source.ts'
import type { A256KWRecipient } from '../src/recipients/types.ts'
import { FIXED_CEK } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks, sourceOf } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'

const CHUNK_SIZE = MIN_CHUNK_SIZE
const STRIDE = CHUNK_SIZE + TAG_SIZE
const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, i) => 0x40 + i)
const KID_A = Uint8Array.from([0xa1, 0xa2])

function recipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
  return kid === undefined
    ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
    : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
}

/** Encrypt via the chunked writer and drive it to completion. */
async function encryptChunkedFull(
  plaintext: Uint8Array,
  extra: Partial<ChunkedEncryptOptions> = {}
): Promise<Uint8Array> {
  const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize: CHUNK_SIZE, ...extra })
  const writer = writable.getWriter()
  const writeDone = writer.write(plaintext)
  const closeDone = writer.close()
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return concatBytes(...chunks)
}

/** The plaintext bytes `range` describes, computed from the documented semantics only -- not from planRange. */
function expectedSlice(fullPlaintext: Uint8Array, range: ByteRange): Uint8Array {
  const total = fullPlaintext.length
  if (range.offset < 0) {
    return fullPlaintext.subarray(Math.max(0, total + range.offset))
  }
  const end = range.length === undefined ? total : Math.min(total, range.offset + range.length)
  return fullPlaintext.subarray(range.offset, end)
}

async function decryptRangeBytes(
  source: RandomAccessSource | Uint8Array,
  cek: Uint8Array,
  range: ByteRange,
  options?: Parameters<typeof decryptRange>[3]
) {
  const result = await decryptRange(source, cek, range, options)
  const bytes = concatBytes(...(await readAllChunks(result.stream)))
  return { result, bytes }
}

/** A `RandomAccessSource` that records every `openRange` call. */
function recordingSource(bytes: Uint8Array): {
  source: RandomAccessSource
  calls: Array<{ offset: number; length: number }>
} {
  const calls: Array<{ offset: number; length: number }> = []
  const blockSize = 64
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
            const end = Math.min(pos + blockSize, slice.length)
            controller.enqueue(slice.subarray(pos, end))
            pos = end
          },
        },
        { highWaterMark: 0 }
      )
    },
  }
  return { source, calls }
}

/** Delivers any requested range split into fixed-size blocks. */
function blockSplitSource(bytes: Uint8Array, blockSize: number): RandomAccessSource {
  return {
    size: bytes.length,
    async openRange(offset, length) {
      const slice = bytes.subarray(offset, offset + length)
      let pos = 0
      return new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            if (pos >= slice.length) {
              controller.close()
              return
            }
            const end = Math.min(pos + blockSize, slice.length)
            controller.enqueue(slice.subarray(pos, end))
            pos = end
          },
        },
        { highWaterMark: 0 }
      )
    },
  }
}

async function readUntilFailure(stream: ReadableStream<Uint8Array>): Promise<{ chunks: Uint8Array[]; error: unknown }> {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let error: unknown
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value)
    }
  } catch (cause) {
    error = cause
  }
  return { chunks, error }
}

const RANGE_SCENARIOS: Array<{ name: string; range: ByteRange }> = [
  { name: 'first bytes', range: { offset: 0, length: 100 } },
  { name: 'middle of a chunk', range: { offset: 5000, length: 2000 } },
  { name: 'exactly one whole chunk', range: { offset: 0, length: 4096 } },
  { name: 'crossing one chunk boundary', range: { offset: 4000, length: 200 } },
  { name: 'crossing several chunk boundaries', range: { offset: 100, length: 9000 } },
  { name: 'ending exactly at a chunk boundary', range: { offset: 0, length: 8192 } },
  { name: 'the final partial chunk, open-ended', range: { offset: 8192 } },
  { name: 'the whole object', range: { offset: 0 } },
  { name: 'open-ended from the middle', range: { offset: 5000 } },
  { name: 'a suffix inside the final chunk', range: { offset: -500 } },
  { name: 'a suffix crossing chunk boundaries', range: { offset: -5000 } },
  { name: 'a suffix longer than the object', range: { offset: -999999 } },
  { name: 'the end clamps past EOF', range: { offset: 9000, length: 5000 } },
]

function pick(names: string[]): Array<{ name: string; range: ByteRange }> {
  return RANGE_SCENARIOS.filter((s) => names.includes(s.name))
}

describe('decryptRange', () => {
  describe('round trips (tag 16)', () => {
    for (const { name, range } of RANGE_SCENARIOS) {
      it(name, async () => {
        const plaintext = deterministicPlaintext(10000)
        const encoded = await encryptChunkedFull(plaintext)
        const { result, bytes } = await decryptRangeBytes(encoded, new Uint8Array(FIXED_CEK), range)
        assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))

        const plan = planRange(
          { sourceSize: encoded.length, headerLength: decodeEnvelope(encoded).envelopeLength, chunkSize: CHUNK_SIZE },
          range
        )
        assert.strictEqual(result.rangeLength, plan.rangeLength)
        assert.strictEqual(result.totalPlaintextLength, plan.totalPlaintextLength)
        assert.deepStrictEqual(result.ciphertextSpan, plan.ciphertextSpan)
        assert.strictEqual(result.includesFinalChunk, plan.includesFinalChunk)
      })
    }

    it('the final full chunk of an exact multiple, open-ended', async () => {
      const plaintext = deterministicPlaintext(8192)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 4096 }
      const { result, bytes } = await decryptRangeBytes(encoded, new Uint8Array(FIXED_CEK), range)
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
      assert.strictEqual(result.includesFinalChunk, true)
    })

    it('decrypts correctly when the range ends on a non-final chunk (nonce flag 0)', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 0, length: 8192 }
      const { result, bytes } = await decryptRangeBytes(encoded, new Uint8Array(FIXED_CEK), range)
      assert.strictEqual(result.includesFinalChunk, false)
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
    })
  })

  describe('round trips (tag 96, direct CEK)', () => {
    for (const { name, range } of pick([
      'first bytes',
      'crossing several chunk boundaries',
      'the whole object',
      'the final partial chunk, open-ended',
    ])) {
      it(name, async () => {
        const plaintext = deterministicPlaintext(10000)
        const encoded = await encryptChunkedFull(plaintext, { recipients: [recipient(KEK_A, KID_A)] })
        const { bytes } = await decryptRangeBytes(encoded, new Uint8Array(FIXED_CEK), range)
        assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
      })
    }
  })

  describe('round trips (with plaintext_length)', () => {
    for (const { name, range } of pick([
      'first bytes',
      'crossing several chunk boundaries',
      'the whole object',
      'the final partial chunk, open-ended',
    ])) {
      it(name, async () => {
        const plaintext = deterministicPlaintext(10000)
        const encoded = await encryptChunkedFull(plaintext, { contentLength: plaintext.length })
        const { result, bytes } = await decryptRangeBytes(encoded, new Uint8Array(FIXED_CEK), range)
        assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
        assert.strictEqual(result.totalPlaintextLength, plaintext.length)
      })
    }
  })

  describe('source path', () => {
    it('fetches the planned span even if the caller edits result.ciphertextSpan', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 5000, length: 100 }
      const result = await decryptRange(encoded, new Uint8Array(FIXED_CEK), range)
      result.ciphertextSpan.offset = 0
      result.ciphertextSpan.length = 1
      const bytes = concatBytes(...(await readAllChunks(result.stream)))
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
    })

    it('opens only envelope spans before the promise resolves; the first read opens exactly the ciphertext span', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const { source, calls } = recordingSource(encoded)
      const range: ByteRange = { offset: 100, length: 9000 }
      const result = await decryptRange(source, new Uint8Array(FIXED_CEK), range)
      const callsBeforeRead = calls.length
      assert.ok(
        calls.every(
          (call) => call.offset + call.length !== result.ciphertextSpan.offset + result.ciphertextSpan.length
        ),
        'no call before the first read should match the ciphertext span'
      )

      const reader = result.stream.getReader()
      await reader.read()
      assert.deepStrictEqual(calls.slice(callsBeforeRead), [result.ciphertextSpan])
    })

    it('with params, no envelope span is ever opened', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return

      const { source, calls } = recordingSource(encoded)
      const result = await decryptRange(
        source,
        new Uint8Array(FIXED_CEK),
        { offset: 0, length: 100 },
        { params: info.params }
      )
      assert.deepStrictEqual(calls, [])
      await readAllChunks(result.stream)
      assert.deepStrictEqual(calls, [result.ciphertextSpan])
    })

    it('works when the source delivers one byte at a time', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 100, length: 9000 }
      const { bytes } = await decryptRangeBytes(blockSplitSource(encoded, 1), new Uint8Array(FIXED_CEK), range)
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
    })

    it('works when blocks straddle chunk boundaries', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 100, length: 9000 }
      // 777 shares no common factor with the stride, so blocks land at different offsets within each chunk.
      const { bytes } = await decryptRangeBytes(blockSplitSource(encoded, 777), new Uint8Array(FIXED_CEK), range)
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
    })
  })

  describe('rejections', () => {
    it('rejects a short span response with InvalidSourceLengthError', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 100, length: 9000 }
      const plan = planRange(
        { sourceSize: encoded.length, headerLength: decodeEnvelope(encoded).envelopeLength, chunkSize: CHUNK_SIZE },
        range
      )
      const source: RandomAccessSource = {
        size: encoded.length,
        async openRange(offset, length) {
          if (offset === plan.ciphertextSpan.offset && length === plan.ciphertextSpan.length) {
            return sourceOf([encoded.subarray(offset, offset + length - 1)])
          }
          return sourceOf([encoded.subarray(offset, offset + length)])
        },
      }
      const result = await decryptRange(source, new Uint8Array(FIXED_CEK), range)
      await assert.rejects(readAllChunks(result.stream), InvalidSourceLengthError)
    })

    it('rejects extra trailing bytes, releasing nothing from the last piece', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const range: ByteRange = { offset: 100, length: 9000 } // includes the final chunk
      const plan = planRange(
        { sourceSize: encoded.length, headerLength: decodeEnvelope(encoded).envelopeLength, chunkSize: CHUNK_SIZE },
        range
      )
      const source: RandomAccessSource = {
        size: encoded.length,
        async openRange(offset, length) {
          if (offset === plan.ciphertextSpan.offset && length === plan.ciphertextSpan.length) {
            // Delivered as a separate block after the correct span, so the
            // exact-count is reached before the extra bytes are discovered.
            return sourceOf([encoded.subarray(offset, offset + length), Uint8Array.from([1, 2, 3])])
          }
          return sourceOf([encoded.subarray(offset, offset + length)])
        },
      }
      const result = await decryptRange(source, new Uint8Array(FIXED_CEK), range)
      const { chunks, error } = await readUntilFailure(result.stream)
      assert.ok(error instanceof InvalidSourceLengthError)
      const released = concatBytes(...chunks)
      assert.ok(released.length < plan.rangeLength, 'the last piece must not have been released')
    })

    it('rejects a tampered chunk, releasing earlier chunks but nothing from the bad one', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext)
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const tampered = new Uint8Array(encoded)
      tampered[envelopeLength + CHUNK_SIZE + 20] ^= 0xff // inside chunk 1's ciphertext
      const result = await decryptRange(tampered, new Uint8Array(FIXED_CEK), { offset: 0 })
      const { chunks, error } = await readUntilFailure(result.stream)
      assert.ok(error instanceof AuthenticationError)
      assert.deepStrictEqual(concatBytes(...chunks), plaintext.subarray(0, CHUNK_SIZE))
    })

    it('rejects the wrong CEK with AuthenticationError', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const wrongCek = Uint8Array.from(FIXED_CEK, (byte) => byte ^ 0xff)
      const result = await decryptRange(encoded, wrongCek, { offset: 0, length: 100 })
      await assert.rejects(readAllChunks(result.stream), AuthenticationError)
    })

    it('rejects an invalid CEK synchronously, before any openRange', async () => {
      let calls = 0
      const source: RandomAccessSource = {
        size: 100,
        async openRange() {
          calls++
          return sourceOf([])
        },
      }
      await assert.rejects(decryptRange(source, new Uint8Array(10), { offset: 0 }), InvalidKeyError)
      assert.strictEqual(calls, 0)
    })

    it('rejects a scheme-1 (whole-object AES-GCM) object with UnsupportedSchemeError', async () => {
      const encoded = await encryptWholeObject(deterministicPlaintext(10), { cek: new Uint8Array(FIXED_CEK) })
      await assert.rejects(decryptRange(encoded, new Uint8Array(FIXED_CEK), { offset: 0 }), UnsupportedSchemeError)
    })

    it('rejects an invalid range before any key import', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      let importCalls = 0
      const original = globalThis.crypto.subtle.importKey
      globalThis.crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
        importCalls++
        return original.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['importKey']
      try {
        await assert.rejects(
          decryptRange(encoded, new Uint8Array(FIXED_CEK), { offset: -1, length: 5 }),
          InvalidRangeError
        )
        assert.strictEqual(importCalls, 0)
      } finally {
        globalThis.crypto.subtle.importKey = original
      }
    })

    it('rejects look-alike params with MalformedEnvelopeError', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      await assert.rejects(
        decryptRange(encoded, new Uint8Array(FIXED_CEK), { offset: 0 }, { params: { ...info.params } }),
        MalformedEnvelopeError
      )
    })

    it('rejects params from a different object with AuthenticationError on read', async () => {
      const encodedA = await encryptChunkedFull(deterministicPlaintext(10000))
      const encodedB = await encryptChunkedFull(deterministicPlaintext(10000))
      const infoA = await parse(encodedA)
      assert.strictEqual(infoA.scheme, 'chunked')
      if (infoA.scheme !== 'chunked') return
      const result = await decryptRange(
        encodedB,
        new Uint8Array(FIXED_CEK),
        { offset: 0, length: 100 },
        { params: infoA.params }
      )
      await assert.rejects(readAllChunks(result.stream), AuthenticationError)
    })

    it('rejects a truncated source without plaintext_length as AuthenticationError when the range covers the presumed final chunk', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext)
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const truncated = encoded.subarray(0, envelopeLength + STRIDE * 2) // still a structurally valid 2-chunk object
      const result = await decryptRange(truncated, new Uint8Array(FIXED_CEK), { offset: 0 })
      await assert.rejects(readAllChunks(result.stream), AuthenticationError)
    })

    it('rejects a truncated source with plaintext_length before opening any ciphertext span', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext, { contentLength: plaintext.length })
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const truncated = encoded.subarray(0, envelopeLength + STRIDE * 2)
      const { source, calls } = recordingSource(truncated)
      await assert.rejects(decryptRange(source, new Uint8Array(FIXED_CEK), { offset: 0 }), InvalidCiphertextLengthError)
      const bytesRequested = calls.reduce((sum, call) => sum + call.length, 0)
      assert.ok(bytesRequested < envelopeLength + CHUNK_SIZE, 'must not have opened a ciphertext span')
    })
  })

  describe('laziness', () => {
    it('imports the key eagerly but decrypts lazily, one aesGcmDecrypt per read', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext)
      let importCalls = 0
      let decryptCalls = 0
      const originalImportKey = globalThis.crypto.subtle.importKey
      const originalDecrypt = globalThis.crypto.subtle.decrypt
      globalThis.crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
        importCalls++
        return originalImportKey.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['importKey']
      globalThis.crypto.subtle.decrypt = ((...args: Parameters<SubtleCrypto['decrypt']>) => {
        decryptCalls++
        return originalDecrypt.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['decrypt']

      try {
        const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
        const result = await decryptRange(encoded, new Uint8Array(FIXED_CEK), { offset: 0 })
        assert.strictEqual(importCalls, 1)
        assert.strictEqual(decryptCalls, 0)

        const reader = result.stream.getReader()
        for (let k = 1; k <= 3; k++) {
          const { done } = await reader.read()
          assert.strictEqual(done, false)
          await settle()
          assert.strictEqual(decryptCalls, k)
        }
        const last = await reader.read()
        assert.strictEqual(last.done, true)
      } finally {
        globalThis.crypto.subtle.importKey = originalImportKey
        globalThis.crypto.subtle.decrypt = originalDecrypt
      }
    })
  })

  describe('cancel', () => {
    it('cancelling the result stream cancels the source span stream', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext)
      let cancelReason: unknown
      const source: RandomAccessSource = {
        size: encoded.length,
        async openRange(offset, length) {
          const slice = encoded.subarray(offset, offset + length)
          return new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(slice)
              // Left open: no pull()/close(), so nothing more happens on its own.
            },
            cancel(reason) {
              cancelReason = reason
            },
          })
        },
      }
      const result = await decryptRange(source, new Uint8Array(FIXED_CEK), { offset: 0 })
      const reader = result.stream.getReader()
      await reader.read() // triggers the first pull, opening the ciphertext span
      const reason = new Error('stop early')
      await reader.cancel(reason)
      assert.strictEqual(cancelReason, reason)
    })
  })
})
