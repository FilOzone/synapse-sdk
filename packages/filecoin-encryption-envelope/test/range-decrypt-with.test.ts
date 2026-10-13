import assert from 'node:assert'
import { encrypt as encryptWholeObject } from '../src/aes-gcm.ts'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, MIN_CHUNK_SIZE } from '../src/constants.ts'
import { ALG_A256KW } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import {
  AuthenticationError,
  InvalidKeyError,
  InvalidRangeError,
  MalformedEnvelopeError,
  NoUsableRecipientError,
  RecipientUnwrapError,
  UnsupportedSchemeError,
} from '../src/errors.ts'
import { decryptRangeWith } from '../src/range/decrypt.ts'
import { parse } from '../src/range/inspect.ts'
import type { ByteRange } from '../src/range/plan.ts'
import type { RandomAccessSource } from '../src/range/source.ts'
import { createA256KWUnwrapper } from '../src/recipients/index.ts'
import type { A256KWRecipient, RecipientInfo, Unwrapper } from '../src/recipients/types.ts'
import { FIXED_CEK } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks, sourceOf } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'

const CHUNK_SIZE = MIN_CHUNK_SIZE
const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, i) => 0x40 + i)
const KID_A = Uint8Array.from([0xa1, 0xa2])
const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, i) => 0x80 + i)

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

/** The plaintext bytes `range` describes, computed from the documented semantics only. */
function expectedSlice(fullPlaintext: Uint8Array, range: ByteRange): Uint8Array {
  const total = fullPlaintext.length
  if (range.offset < 0) {
    return fullPlaintext.subarray(Math.max(0, total + range.offset))
  }
  const end = range.length === undefined ? total : Math.min(total, range.offset + range.length)
  return fullPlaintext.subarray(range.offset, end)
}

async function decryptRangeWithBytes(
  source: RandomAccessSource | Uint8Array,
  unwrapper: Unwrapper,
  range: ByteRange,
  options?: Parameters<typeof decryptRangeWith>[3]
) {
  const result = await decryptRangeWith(source, unwrapper, range, options)
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

/** Fails the test if the wrapped unwrapper is ever invoked. */
function neverCalledUnwrapper(): { unwrapper: Unwrapper; assertNeverCalled: () => void } {
  let calls = 0
  return {
    unwrapper: async () => {
      calls++
      return undefined
    },
    assertNeverCalled: () => assert.strictEqual(calls, 0),
  }
}

const RANGE_SCENARIOS: Array<{ name: string; range: ByteRange }> = [
  { name: 'first chunk', range: { offset: 0, length: 100 } },
  { name: 'cross-chunk', range: { offset: 4000, length: 200 } },
  { name: 'final chunk, open-ended', range: { offset: 8192 } },
  { name: 'suffix', range: { offset: -500 } },
]

describe('decryptRangeWith', () => {
  describe('round trips', () => {
    for (const { name, range } of RANGE_SCENARIOS) {
      it(`${name} (one recipient)`, async () => {
        const plaintext = deterministicPlaintext(10000)
        const encoded = await encryptChunkedFull(plaintext, { recipients: [recipient(KEK_A, KID_A)] })
        const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
        const { bytes } = await decryptRangeWithBytes(encoded, unwrapper, range)
        assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
      })

      it(`${name} (two recipients, either KEK works)`, async () => {
        const plaintext = deterministicPlaintext(10000)
        const encoded = await encryptChunkedFull(plaintext, {
          recipients: [recipient(KEK_A, KID_A), recipient(KEK_B)],
        })

        const unwrapperA = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
        const { bytes: bytesA } = await decryptRangeWithBytes(encoded, unwrapperA, range)
        assert.deepStrictEqual(bytesA, expectedSlice(plaintext, range))

        const unwrapperB = await createA256KWUnwrapper([{ kek: KEK_B }])
        const { bytes: bytesB } = await decryptRangeWithBytes(encoded, unwrapperB, range)
        assert.deepStrictEqual(bytesB, expectedSlice(plaintext, range))
      })
    }
  })

  describe('with params', () => {
    it('opens no envelope span, and gives the unwrapper every recipient in wire order', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext, {
        recipients: [recipient(KEK_A, KID_A), recipient(KEK_B)],
      })
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return

      const { source, calls } = recordingSource(encoded)
      let seen: readonly RecipientInfo[] = []
      const unwrapper: Unwrapper = async (recipients) => {
        seen = recipients
        const real = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
        return real(recipients)
      }
      const range: ByteRange = { offset: 0, length: 100 }
      const result = await decryptRangeWith(source, unwrapper, range, { params: info.params })
      assert.deepStrictEqual(calls, [], 'no envelope span, since params supplied the decoded envelope')

      const bytes = concatBytes(...(await readAllChunks(result.stream)))
      assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
      assert.deepStrictEqual(calls, [result.ciphertextSpan])

      assert.strictEqual(seen.length, 2)
      assert.strictEqual(seen[0].index, 0)
      assert.strictEqual(seen[0].alg, ALG_A256KW)
      assert.deepStrictEqual(seen[0].kid, KID_A)
      assert.strictEqual(seen[1].index, 1)
      assert.strictEqual(seen[1].alg, ALG_A256KW)
      assert.strictEqual('kid' in seen[1], false)
    })
  })

  describe('rejections', () => {
    it('rejects a tag-16 object with NoUsableRecipientError, opening no ciphertext span', async () => {
      const plaintext = deterministicPlaintext(10000)
      const encoded = await encryptChunkedFull(plaintext)
      const { source, calls } = recordingSource(encoded)
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptRangeWith(source, unwrapper, { offset: 0 }), NoUsableRecipientError)
      assertNeverCalled()

      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const bytesRequested = calls.reduce((sum, call) => sum + call.length, 0)
      assert.ok(bytesRequested < envelopeLength + CHUNK_SIZE, 'no ciphertext span should have opened')
    })

    it('wraps a thrown unwrapper error as RecipientUnwrapError with the exact cause', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10000), {
        recipients: [recipient(KEK_A, KID_A)],
      })
      const boom = new Error('boom')
      const unwrapper: Unwrapper = async () => {
        throw boom
      }
      await assert.rejects(
        decryptRangeWith(encoded, unwrapper, { offset: 0 }),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
      )
    })

    it('reports an unwrapper returning undefined as NoUsableRecipientError', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10000), {
        recipients: [recipient(KEK_A, KID_A)],
      })
      const unwrapper: Unwrapper = async () => undefined
      await assert.rejects(decryptRangeWith(encoded, unwrapper, { offset: 0 }), NoUsableRecipientError)
    })

    it('rejects an invalid recovered CEK with InvalidKeyError', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10000), {
        recipients: [recipient(KEK_A, KID_A)],
      })
      const unwrapper: Unwrapper = async () => new Uint8Array(KEY_SIZE) // all-zero
      await assert.rejects(decryptRangeWith(encoded, unwrapper, { offset: 0 }), InvalidKeyError)
    })

    it('reports a valid but wrong recovered CEK as AuthenticationError on the first read', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10000), {
        recipients: [recipient(KEK_A, KID_A)],
      })
      const wrongCek = Uint8Array.from(FIXED_CEK, (byte) => byte ^ 0xff)
      const unwrapper: Unwrapper = async () => wrongCek
      const result = await decryptRangeWith(encoded, unwrapper, { offset: 0, length: 100 })
      await assert.rejects(readAllChunks(result.stream), AuthenticationError)
    })

    it('rejects a non-function unwrapper synchronously, with no openRange call', async () => {
      let calls = 0
      const source: RandomAccessSource = {
        size: 100,
        async openRange() {
          calls++
          return sourceOf([])
        },
      }
      await assert.rejects(
        decryptRangeWith(source, 'nope' as unknown as Unwrapper, { offset: 0 }),
        MalformedEnvelopeError
      )
      assert.strictEqual(calls, 0)
    })

    it('rejects an invalid range before calling the unwrapper', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10000), {
        recipients: [recipient(KEK_A, KID_A)],
      })
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()
      await assert.rejects(decryptRangeWith(encoded, unwrapper, { offset: -1, length: 5 }), InvalidRangeError)
      assertNeverCalled()
    })

    it('rejects a scheme-1 (whole-object AES-GCM) object with UnsupportedSchemeError, without calling the unwrapper', async () => {
      const encoded = await encryptWholeObject(deterministicPlaintext(10), { cek: new Uint8Array(FIXED_CEK) })
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()
      await assert.rejects(decryptRangeWith(encoded, unwrapper, { offset: 0 }), UnsupportedSchemeError)
      assertNeverCalled()
    })
  })
})
