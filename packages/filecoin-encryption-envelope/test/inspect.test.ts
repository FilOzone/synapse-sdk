import assert from 'assert'
import { encrypt as encryptWholeObject } from '../src/aes-gcm.ts'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, MIN_CHUNK_SIZE } from '../src/constants.ts'
import { A256KW_WRAPPED_CEK_SIZE, ALG_A256KW } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { InvalidSourceLengthError, MalformedEnvelopeError } from '../src/errors.ts'
import { paramsState, parse } from '../src/range/inspect.ts'
import type { RandomAccessSource } from '../src/range/source.ts'
import type { A256KWRecipient } from '../src/recipients/types.ts'
import { FIXED_CEK } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks } from './aes-gcm-stream-fixtures.ts'
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

/** A `RandomAccessSource` that records every `openRange` call, like the one in test/range-source.test.ts. */
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

describe('parse', () => {
  describe('scheme', () => {
    it('reports a tag-16 chunked object as chunked, with no recipients', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      assert.deepStrictEqual(info.recipients, [])
    })

    it('reports a tag-96 chunked object (one recipient with a kid, one without) as chunked', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), {
        recipients: [recipient(KEK_A, KID_A), recipient(KEK_B)],
      })
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      assert.strictEqual(info.recipients.length, 2)
    })

    it('reports a scheme-1 (whole-object AES-GCM) object as aes-gcm, with no params key', async () => {
      const plaintext = deterministicPlaintext(10)
      const encoded = await encryptWholeObject(plaintext, { cek: new Uint8Array(FIXED_CEK) })
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'aes-gcm')
      assert.strictEqual('params' in info, false)
    })
  })

  describe('field values', () => {
    it('reports a string contentType', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), { contentType: 'text/plain' })
      const info = await parse(encoded)
      assert.strictEqual(info.contentType, 'text/plain')
    })

    it('reports a numeric contentType', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), { contentType: 42 })
      const info = await parse(encoded)
      assert.strictEqual(info.contentType, 42)
    })

    it('reports appMetadata', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), { appMetadata: { note: 'hello' } })
      const info = await parse(encoded)
      // decodeAppMetadata returns a null-prototype object, so compare fields rather than deepStrictEqual.
      assert.deepStrictEqual(Object.keys(info.appMetadata ?? {}), ['note'])
      assert.strictEqual(info.appMetadata?.note, 'hello')
    })

    it('omits contentType and appMetadata when neither was set', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual('contentType' in info, false)
      assert.strictEqual('appMetadata' in info, false)
    })

    it('reports recipient index, alg, kid, and wrappedKey, omitting kid when absent', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), {
        recipients: [recipient(KEK_A, KID_A), recipient(KEK_B)],
      })
      const info = await parse(encoded)
      assert.strictEqual(info.recipients[0].index, 0)
      assert.strictEqual(info.recipients[0].alg, ALG_A256KW)
      assert.deepStrictEqual(info.recipients[0].kid, KID_A)
      assert.strictEqual(info.recipients[0].wrappedKey.length, A256KW_WRAPPED_CEK_SIZE)
      assert.strictEqual(info.recipients[1].index, 1)
      assert.strictEqual('kid' in info.recipients[1], false)
    })

    it('params.headerLength equals the real envelope length, and chunkSize matches', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.strictEqual(info.params.headerLength, decodeEnvelope(encoded).envelopeLength)
      assert.strictEqual(info.params.chunkSize, CHUNK_SIZE)
    })

    it('params.plaintextLength is present when contentLength was declared', async () => {
      const plaintext = deterministicPlaintext(10)
      const encoded = await encryptChunkedFull(plaintext, { contentLength: 10 })
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.strictEqual(info.params.plaintextLength, 10)
    })

    it('params.plaintextLength is absent when contentLength was not declared', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.strictEqual('plaintextLength' in info.params, false)
    })
  })

  describe('params', () => {
    it('is frozen', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.ok(Object.isFrozen(info.params))
    })

    it('JSON.stringify shows only the public fields', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), { contentLength: 10 })
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      const roundTripped = JSON.parse(JSON.stringify(info.params))
      assert.deepStrictEqual(Object.keys(roundTripped).sort(), [
        'chunkSize',
        'headerLength',
        'plaintextLength',
        'scheme',
      ])
    })

    it('paramsState accepts real params from parse()', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.strictEqual(paramsState(info.params).decoded.envelopeLength, info.params.headerLength)
    })

    it('paramsState rejects a spread copy, a frozen spread copy, and null', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
      if (info.scheme !== 'chunked') return
      assert.throws(() => paramsState({ ...info.params }), MalformedEnvelopeError)
      assert.throws(() => paramsState(Object.freeze({ ...info.params })), MalformedEnvelopeError)
      assert.throws(() => paramsState(null), MalformedEnvelopeError)
    })

    it('two parses of the same bytes give distinct params objects with equal fields', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const infoA = await parse(encoded)
      const infoB = await parse(encoded)
      assert.strictEqual(infoA.scheme, 'chunked')
      assert.strictEqual(infoB.scheme, 'chunked')
      if (infoA.scheme !== 'chunked' || infoB.scheme !== 'chunked') return
      assert.notStrictEqual(infoA.params, infoB.params)
      assert.deepStrictEqual(infoA.params, infoB.params)
    })
  })

  describe('isolation', () => {
    it('mutating a returned recipient does not affect paramsState().decoded or a later parse', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10), { recipients: [recipient(KEK_A, KID_A)] })
      const infoA = await parse(encoded)
      assert.strictEqual(infoA.scheme, 'chunked')
      if (infoA.scheme !== 'chunked') return
      const originalWrappedKey = new Uint8Array(infoA.recipients[0].wrappedKey)

      infoA.recipients[0].wrappedKey.fill(0)

      const state = paramsState(infoA.params)
      assert.deepStrictEqual(state.decoded.recipients[0].ciphertext, originalWrappedKey)

      const infoB = await parse(encoded)
      assert.deepStrictEqual(infoB.recipients[0].wrappedKey, originalWrappedKey)
    })
  })

  describe('source path', () => {
    it('reads only the envelope span(s), not the detached ciphertext', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptChunkedFull(plaintext)
      const { source, calls } = recordingSource(encoded)
      const info = await parse(source)
      assert.strictEqual(info.scheme, 'chunked')
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const bytesRequested = calls.reduce((sum, call) => sum + call.length, 0)
      // Spans double from 4096 and are cut off once the envelope completes;
      // the true test is that we never approach the ciphertext's own size.
      assert.ok(bytesRequested < envelopeLength + CHUNK_SIZE, 'must not read anywhere near the detached ciphertext')
    })

    it('parses directly from a Uint8Array', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const info = await parse(encoded)
      assert.strictEqual(info.scheme, 'chunked')
    })

    it('rejects a non-source input with the same error toRandomAccessSource would', async () => {
      await assert.rejects(parse('nope' as unknown as Uint8Array), MalformedEnvelopeError)
    })

    it('rejects an invalid source size', async () => {
      const badSource = { size: -1, openRange: async () => new ReadableStream() } as unknown as RandomAccessSource
      await assert.rejects(parse(badSource), InvalidSourceLengthError)
    })

    it('rejects a truncated envelope', async () => {
      const encoded = await encryptChunkedFull(deterministicPlaintext(10))
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const truncated = encoded.subarray(0, envelopeLength - 5)
      await assert.rejects(parse(truncated), MalformedEnvelopeError)
    })
  })
})
