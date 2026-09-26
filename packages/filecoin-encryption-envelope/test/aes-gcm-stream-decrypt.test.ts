import assert from 'node:assert'
import crypto from 'node:crypto'
import { encrypt as encryptWholeObject } from '../src/aes-gcm.ts'
import { type ChunkedEncryptOptions, decrypt, encrypt } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, TAG_SIZE } from '../src/constants.ts'
import { ALG_A256KW } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import {
  AuthenticationError,
  InvalidCiphertextLengthError,
  InvalidKeyError,
  MalformedEnvelopeError,
  UnsupportedSchemeError,
} from '../src/errors.ts'
import { FIXED_CEK, fixedBaseNonceRandomValues, withRandomValues } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks, sourceOf } from './aes-gcm-stream-fixtures.ts'
import { concatBytes, FIXTURE_BASE_NONCE_7, hexToBytes } from './cose-fixtures.ts'

const CHUNK_SIZE = 4096

// Same envelope as aes-gcm-stream-encrypt.test.ts's independent vectors:
// { cek: FIXED_CEK, chunkSize: CHUNK_SIZE }, no contentType/appMetadata/
// plaintext_length, base nonce fixed to FIXTURE_BASE_NONCE_7.
const ENVELOPE_HEX =
  'd083583fa4013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f736520191000a0f6'
// Same configuration but with contentLength: 100 (plaintext_length present).
const PLAINTEXT_LENGTH_ENVELOPE_HEX =
  'd0835846a5013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f7365201910003a000100fc1864a0f6'

/**
 * Build a decryptable object directly with node:crypto (never this
 * package's aesGcmEncrypt/aesGcmDecrypt/deriveChunkNonce): a fixed envelope
 * plus one aes-256-gcm chunk per stride, each with a literal nonce
 * (`[...base, i3,i2,i1,i0, flag]`) and the AAD from encStructure (itself
 * covered elsewhere).
 */
function buildObject(
  totalLength: number,
  envelopeHex: string = ENVELOPE_HEX
): { encoded: Uint8Array; plaintext: Uint8Array } {
  const envelope = hexToBytes(envelopeHex)
  const decoded = decodeEnvelope(envelope)
  const aad = Buffer.from(encStructure(decoded.tag, decoded.protectedHeader.bytes))
  const plaintext = deterministicPlaintext(totalLength)
  const chunkCount = totalLength === 0 ? 1 : Math.ceil(totalLength / CHUNK_SIZE)

  const parts: Uint8Array[] = [envelope]
  for (let i = 0; i < chunkCount; i++) {
    const isLast = i === chunkCount - 1
    const start = i * CHUNK_SIZE
    const end = Math.min(start + CHUNK_SIZE, totalLength)
    const slice = Buffer.from(plaintext.subarray(start, end))

    const nonce = new Uint8Array(12)
    nonce.set(FIXTURE_BASE_NONCE_7, 0)
    new DataView(nonce.buffer).setUint32(7, i, false)
    nonce[11] = isLast ? 1 : 0

    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(FIXED_CEK), Buffer.from(nonce), {
      authTagLength: 16,
    })
    cipher.setAAD(aad)
    const ciphertext = Buffer.concat([cipher.update(slice), cipher.final(), cipher.getAuthTag()])
    parts.push(new Uint8Array(ciphertext))
  }
  return { encoded: concatBytes(...parts), plaintext }
}

/** Encrypt via the production writer and drive it to completion. */
async function encryptFull(plaintext: Uint8Array, extra: Partial<ChunkedEncryptOptions> = {}): Promise<Uint8Array> {
  const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
    encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize: CHUNK_SIZE, ...extra })
  )
  const writer = writable.getWriter()
  const writeDone = writer.write(plaintext)
  const closeDone = writer.close()
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return concatBytes(...chunks)
}

/** Drive decrypt() to completion (or rejection) with `encoded` delivered in one write. */
async function decryptChunks(encoded: Uint8Array, cek: Uint8Array = FIXED_CEK): Promise<Uint8Array<ArrayBuffer>[]> {
  const { writable, readable } = decrypt(new Uint8Array(cek))
  const writer = writable.getWriter()
  const writeDone = writer.write(encoded)
  const closeDone = writer.close()
  writeDone.catch(() => {
    // Surfaced via readAllChunks below either way; avoid an unhandled rejection.
  })
  closeDone.catch(() => {
    // Same: an incomplete/invalid object rejects close(), read already reports it.
  })
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return chunks
}

async function decryptBytes(encoded: Uint8Array, cek: Uint8Array = FIXED_CEK): Promise<Uint8Array> {
  return concatBytes(...(await decryptChunks(encoded, cek)))
}

/** Read until the stream rejects (or ends), capturing every chunk that arrived first. */
async function decryptUntilFailure(
  encoded: Uint8Array,
  cek: Uint8Array = FIXED_CEK
): Promise<{ chunks: Uint8Array<ArrayBuffer>[]; error: unknown }> {
  const { writable, readable } = decrypt(new Uint8Array(cek))
  const writer = writable.getWriter()
  writer.write(encoded).catch(() => {
    // Reported via the read side.
  })
  writer.close().catch(() => {
    // Reported via the read side.
  })
  const reader = readable.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  let error: unknown
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      chunks.push(value as Uint8Array<ArrayBuffer>)
    }
  } catch (cause) {
    error = cause
  }
  return { chunks, error }
}

function findSubsequence(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer
    }
    return i
  }
  throw new Error('test helper: subsequence not found')
}

describe('aesGcmStream.decrypt', () => {
  describe('independent vectors', () => {
    const cases = [
      { name: 'empty', length: 0 },
      { name: 'single partial chunk', length: 100 },
      { name: 'partial-final spanning >= 2 chunks', length: CHUNK_SIZE + 100 },
      { name: 'exact multiple spanning >= 2 chunks', length: CHUNK_SIZE * 2 },
    ]
    for (const { name, length } of cases) {
      it(`matches the independent oracle: ${name}`, async () => {
        const { encoded, plaintext } = buildObject(length)
        const chunks = await decryptChunks(encoded)
        // One piece per non-empty chunk: an empty object yields no pieces at all.
        assert.strictEqual(chunks.length, Math.ceil(length / CHUNK_SIZE))
        assert.deepStrictEqual(concatBytes(...chunks), plaintext)
      })
    }

    it('matches the independent oracle with plaintext_length present', async () => {
      const { encoded, plaintext } = buildObject(100, PLAINTEXT_LENGTH_ENVELOPE_HEX)
      assert.deepStrictEqual(await decryptBytes(encoded), plaintext)
    })
  })

  describe('round-trips with the writer', () => {
    it('round-trips at several sizes', async () => {
      for (const length of [0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 3 + 50]) {
        const plaintext = deterministicPlaintext(length)
        const encoded = await encryptFull(plaintext)
        assert.deepStrictEqual(await decryptBytes(encoded), plaintext)
      }
    })

    it('round-trips when fed one byte at a time', async () => {
      const plaintext = deterministicPlaintext(500)
      const encoded = await encryptFull(plaintext)
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      const writes: Promise<void>[] = []
      for (let i = 0; i < encoded.length; i++) {
        writes.push(writer.write(encoded.subarray(i, i + 1)))
      }
      const closeDone = writer.close()
      const chunks = await readAllChunks(readable)
      await Promise.all(writes)
      await closeDone
      assert.deepStrictEqual(concatBytes(...chunks), plaintext)
    })

    it('round-trips when one block holds the envelope and all ciphertext', async () => {
      const plaintext = deterministicPlaintext(500)
      const encoded = await encryptFull(plaintext)
      assert.deepStrictEqual(await decryptBytes(encoded), plaintext)
    })

    it('round-trips via pipeThrough with a multi-block, non-aligned source', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE + 37)
      const encoded = await encryptFull(plaintext)
      const blocks = [
        encoded.subarray(0, 50),
        encoded.subarray(50, 50), // empty block, interleaved
        encoded.subarray(50, 3000),
        encoded.subarray(3000),
      ]
      const output = sourceOf(blocks).pipeThrough(decrypt(new Uint8Array(FIXED_CEK)))
      const chunks = await readAllChunks(output)
      assert.deepStrictEqual(concatBytes(...chunks), plaintext)
    })

    it('decrypts a tag-96 object (recipients) with the direct CEK', async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext, {
        recipients: [{ alg: ALG_A256KW, kek: new Uint8Array(KEY_SIZE).fill(0x55) }],
      })
      assert.strictEqual(decodeEnvelope(encoded).recipients.length, 1)
      assert.deepStrictEqual(await decryptBytes(encoded), plaintext)
    })
  })

  describe('no release before verify', () => {
    it('yields exactly chunk 0 then rejects when chunk 1 of 3 is tampered', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const tampered = Uint8Array.from(encoded)
      tampered[decodedEnvelope.envelopeLength + stride + 5] ^= 0xff // inside chunk 1's ciphertext

      const { chunks, error } = await decryptUntilFailure(tampered)
      assert.strictEqual(chunks.length, 1)
      assert.deepStrictEqual(chunks[0], plaintext.subarray(0, CHUNK_SIZE))
      assert.ok(error instanceof AuthenticationError)
    })

    it('enqueues nothing when the final chunk fails the plaintext_length check', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE + 50)
      const encoded = await encryptFull(plaintext, { contentLength: CHUNK_SIZE + 50 })
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const droppedFinalChunk = encoded.subarray(0, decodedEnvelope.envelopeLength + stride)

      const { chunks, error } = await decryptUntilFailure(droppedFinalChunk)
      assert.strictEqual(chunks.length, 0)
      assert.ok(error instanceof InvalidCiphertextLengthError)
    })
  })

  describe('rejections', () => {
    it('rejects the wrong key with AuthenticationError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(50))
      const wrongKey = new Uint8Array(FIXED_CEK)
      wrongKey[0] ^= 0xff
      await assert.rejects(decryptBytes(encoded, wrongKey), AuthenticationError)
    })

    it('rejects a changed protected-header byte with AuthenticationError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(10))
      const decodedEnvelope = decodeEnvelope(encoded)
      const ivOffset = findSubsequence(encoded, decodedEnvelope.protectedHeader.iv)
      const tampered = Uint8Array.from(encoded)
      tampered[ivOffset] ^= 0xff
      await assert.rejects(decryptBytes(tampered), AuthenticationError)
    })

    it('rejects a changed ciphertext byte with AuthenticationError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(50))
      const decodedEnvelope = decodeEnvelope(encoded)
      const tampered = Uint8Array.from(encoded)
      tampered[decodedEnvelope.envelopeLength] ^= 0xff
      await assert.rejects(decryptBytes(tampered), AuthenticationError)
    })

    it('rejects a changed tag byte with AuthenticationError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(50))
      const tampered = Uint8Array.from(encoded)
      tampered[tampered.length - 1] ^= 0xff
      await assert.rejects(decryptBytes(tampered), AuthenticationError)
    })

    it('rejects chunks 0 and 1 swapped with AuthenticationError', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 2)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const envelopeBytes = encoded.subarray(0, decodedEnvelope.envelopeLength)
      const chunk0 = encoded.subarray(decodedEnvelope.envelopeLength, decodedEnvelope.envelopeLength + stride)
      const chunk1 = encoded.subarray(decodedEnvelope.envelopeLength + stride)
      const swapped = concatBytes(envelopeBytes, chunk1, chunk0)
      await assert.rejects(decryptBytes(swapped), AuthenticationError)
    })

    it('rejects truncation right after a full non-final chunk with AuthenticationError', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const truncated = encoded.subarray(0, decodedEnvelope.envelopeLength + stride)
      await assert.rejects(decryptBytes(truncated), AuthenticationError)
    })

    it('rejects a dropped final chunk with AuthenticationError', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 2) // exact multiple, 2 chunks
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const dropped = encoded.subarray(0, decodedEnvelope.envelopeLength + stride)
      await assert.rejects(decryptBytes(dropped), AuthenticationError)
    })

    it('rejects truncation leaving fewer than 16 trailing bytes with InvalidCiphertextLengthError', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 2)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const truncated = encoded.subarray(0, decodedEnvelope.envelopeLength + stride + 10)
      await assert.rejects(decryptBytes(truncated), InvalidCiphertextLengthError)
    })

    it('rejects appended trailing bytes with AuthenticationError', async () => {
      // Not InvalidCiphertextLengthError: appending a few bytes after a
      // short final chunk still looks like *some* structurally valid short
      // chunk to chunkLayout (a bigger one), so it isn't rejected on shape --
      // decrypting those extra bytes as part of "the tag" is what actually
      // fails.
      const encoded = await encryptFull(deterministicPlaintext(50))
      const withExtra = concatBytes(encoded, Uint8Array.from([1, 2, 3]))
      await assert.rejects(decryptBytes(withExtra), AuthenticationError)
    })

    it('rejects bytes appended to an exact-multiple object at the old final chunk', async () => {
      // The extra bytes make the old final chunk non-final. It was sealed with
      // last_flag 1, so opening it with 0 fails before the short trailing
      // piece ever reaches the layout check.
      const encoded = await encryptFull(deterministicPlaintext(CHUNK_SIZE * 2))
      for (const extra of [1, 16]) {
        const withExtra = concatBytes(encoded, new Uint8Array(extra))
        await assert.rejects(decryptBytes(withExtra), AuthenticationError)
      }
    })

    it('rejects zero ciphertext bytes after the envelope with InvalidCiphertextLengthError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(0))
      const decodedEnvelope = decodeEnvelope(encoded)
      const envelopeOnly = encoded.subarray(0, decodedEnvelope.envelopeLength)
      await assert.rejects(decryptBytes(envelopeOnly), InvalidCiphertextLengthError)
    })

    it('rejects received bytes exceeding what the declared plaintext_length allows, immediately on write', async () => {
      const encoded = await encryptFull(deterministicPlaintext(100), { contentLength: 100 })
      const withExtra = concatBytes(
        encoded,
        Uint8Array.from({ length: 50 }, () => 0xaa)
      )
      const { writable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await assert.rejects(writer.write(withExtra), InvalidCiphertextLengthError)
    })

    it('rejects an overrun on a later write, after the envelope was already parsed', async () => {
      // Distinct from the "immediately on write" case above: there, the
      // whole envelope, ciphertext, and overrun arrive in one write() call,
      // so the overrun is only ever caught by the check made right after
      // computing expectedTotal for the first time. Splitting the envelope
      // into its own write() call exercises the *separate* check that runs
      // on every write() using the already-computed expectedTotal.
      const encoded = await encryptFull(deterministicPlaintext(100), { contentLength: 100 })
      const decodedEnvelope = decodeEnvelope(encoded)
      const envelopeBytes = encoded.subarray(0, decodedEnvelope.envelopeLength)
      const rest = encoded.subarray(decodedEnvelope.envelopeLength)
      const withExtra = concatBytes(
        rest,
        Uint8Array.from({ length: 50 }, () => 0xaa)
      )
      const { writable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(envelopeBytes)
      await assert.rejects(writer.write(withExtra), InvalidCiphertextLengthError)
    })

    it('rejects when the declared plaintext_length is larger than what arrives, at EOF', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE + 50)
      const encoded = await encryptFull(plaintext, { contentLength: CHUNK_SIZE + 50 })
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const truncated = encoded.subarray(0, decodedEnvelope.envelopeLength + stride)
      await assert.rejects(decryptBytes(truncated), InvalidCiphertextLengthError)
    })

    it('rejects a scheme-1 (whole-object AES-GCM) object with UnsupportedSchemeError', async () => {
      const scheme1Encoded = await encryptWholeObject(deterministicPlaintext(20), { cek: new Uint8Array(FIXED_CEK) })
      await assert.rejects(decryptBytes(scheme1Encoded), UnsupportedSchemeError)
    })

    it('rejects input ending mid-envelope with MalformedEnvelopeError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(10))
      const decodedEnvelope = decodeEnvelope(encoded)
      const partial = encoded.subarray(0, decodedEnvelope.envelopeLength - 5)
      await assert.rejects(decryptBytes(partial), MalformedEnvelopeError)
    })

    it('rejects a non-Uint8Array block with MalformedEnvelopeError', async () => {
      const { writable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
      await assert.rejects(writer.write('not bytes'), MalformedEnvelopeError)
    })

    it('rejects a SharedArrayBuffer-backed block with MalformedEnvelopeError', async () => {
      const { writable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      const view = new Uint8Array(new SharedArrayBuffer(16))
      await assert.rejects(writer.write(view), MalformedEnvelopeError)
    })

    it('throws synchronously for an invalid CEK', () => {
      assert.throws(() => decrypt(new Uint8Array(KEY_SIZE - 1)), InvalidKeyError)
      assert.throws(() => decrypt('not bytes' as unknown as Uint8Array), InvalidKeyError)
    })
  })

  describe('laziness', () => {
    it('imports the key and decrypts lazily, exactly one decrypt per read', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 8)
      const encoded = await encryptFull(plaintext)

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
        // Everything before each counted call is microtasks; one macrotask
        // is enough for any prefetching pull to reach it.
        const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
        const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
        await settle()
        assert.strictEqual(importCalls, 0, 'no key import before the first read')
        assert.strictEqual(decryptCalls, 0)

        const writer = writable.getWriter()
        const writeDone = writer.write(encoded)
        const closeDone = writer.close()

        const reader = readable.getReader()
        for (let k = 1; k <= 8; k++) {
          const { done } = await reader.read()
          assert.strictEqual(done, false)
          await settle()
          assert.strictEqual(decryptCalls, k)
          assert.strictEqual(importCalls, 1, 'the key is imported once, not once per chunk')
        }
        const last = await reader.read()
        assert.strictEqual(last.done, true)
        await writeDone
        await closeDone
      } finally {
        globalThis.crypto.subtle.importKey = originalImportKey
        globalThis.crypto.subtle.decrypt = originalDecrypt
      }
    })
  })

  describe('ownership', () => {
    it('is unaffected by mutating a block (envelope + ciphertext) after its write() resolves', async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext)
      const block = Uint8Array.from(encoded)
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(block)
      block.fill(0xff)
      await writer.close()
      assert.deepStrictEqual(concatBytes(...(await readAllChunks(readable))), plaintext)
    })

    it("is unaffected by transferring a block's buffer (envelope + ciphertext) after its write() resolves", async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext)
      const block = Uint8Array.from(encoded)
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(block)
      structuredClone(block.buffer, { transfer: [block.buffer] })
      await writer.close()
      assert.deepStrictEqual(concatBytes(...(await readAllChunks(readable))), plaintext)
    })

    it('is unaffected by mutating a ciphertext-only block after its write() resolves', async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const envelopeBytes = Uint8Array.from(encoded.subarray(0, decodedEnvelope.envelopeLength))
      const ciphertextBytes = Uint8Array.from(encoded.subarray(decodedEnvelope.envelopeLength))

      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(envelopeBytes)
      await writer.write(ciphertextBytes)
      ciphertextBytes.fill(0xff)
      await writer.close()
      assert.deepStrictEqual(concatBytes(...(await readAllChunks(readable))), plaintext)
    })

    it("is unaffected by transferring a ciphertext-only block's buffer after its write() resolves", async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const envelopeBytes = Uint8Array.from(encoded.subarray(0, decodedEnvelope.envelopeLength))
      const ciphertextBytes = Uint8Array.from(encoded.subarray(decodedEnvelope.envelopeLength))

      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(envelopeBytes)
      await writer.write(ciphertextBytes)
      structuredClone(ciphertextBytes.buffer, { transfer: [ciphertextBytes.buffer] })
      await writer.close()
      assert.deepStrictEqual(concatBytes(...(await readAllChunks(readable))), plaintext)
    })

    it('completes a manual write loop of exactly-stride blocks against a concurrent consumer, without deadlock', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptFull(plaintext)
      const decodedEnvelope = decodeEnvelope(encoded)
      const stride = CHUNK_SIZE + TAG_SIZE
      const envelopeBytes = encoded.subarray(0, decodedEnvelope.envelopeLength)
      const ciphertext = encoded.subarray(decodedEnvelope.envelopeLength)

      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()

      const produce = (async () => {
        await writer.write(Uint8Array.from(envelopeBytes))
        for (let offset = 0; offset < ciphertext.length; offset += stride) {
          await writer.write(Uint8Array.from(ciphertext.subarray(offset, offset + stride)))
        }
        await writer.close()
      })()

      const chunks = await readAllChunks(readable)
      await produce
      assert.deepStrictEqual(concatBytes(...chunks), plaintext)
    })
  })

  describe('cancel and abort', () => {
    it('rejects a pending write when the readable is cancelled', async () => {
      const encoded = await encryptFull(deterministicPlaintext(CHUNK_SIZE * 3))
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      const writeDone = writer.write(encoded) // envelope + big ciphertext: stays pending, nobody reading

      await readable.cancel(new Error('consumer gave up'))
      await assert.rejects(writeDone)
    })

    it('rejects a pending read when the writable is aborted before the envelope completes', async () => {
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const reader = readable.getReader()
      const pending = reader.read() // waiting on the envelope handoff
      const reason = new Error('abort before envelope')
      await writable.getWriter().abort(reason)
      await assert.rejects(pending, (err) => err === reason)
    })

    it('rejects a pending read when the writable is aborted after the envelope completes', async () => {
      const encoded = await encryptFull(deterministicPlaintext(10))
      const decodedEnvelope = decodeEnvelope(encoded)
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      await writer.write(encoded.subarray(0, decodedEnvelope.envelopeLength)) // envelope only

      const reader = readable.getReader()
      const pending = reader.read() // waiting on the first ciphertext chunk
      const reason = new Error('abort after envelope')
      await writer.abort(reason)
      await assert.rejects(pending, (err) => err === reason)
    })

    it('starts no key work when input failed after the envelope but before the first read', async () => {
      const { encoded } = buildObject(CHUNK_SIZE + 100)
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      const original = globalThis.crypto.subtle.importKey
      let importCalls = 0
      globalThis.crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
        importCalls++
        return original.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['importKey']
      try {
        const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
        const writer = writable.getWriter()
        await writer.write(encoded.subarray(0, envelopeLength)) // envelope complete, framer created
        const reason = new Error('abort after envelope, before any read')
        await writer.abort(reason)
        await assert.rejects(readable.getReader().read(), (err) => err === reason)
        assert.strictEqual(importCalls, 0)
      } finally {
        globalThis.crypto.subtle.importKey = original
      }
    })

    it('settles when the writable is aborted with an in-flight write and an idle reader', async () => {
      const encoded = await encryptFull(deterministicPlaintext(CHUNK_SIZE * 3))
      const { writable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      const writeDone = writer.write(encoded)
      writeDone.catch(() => {
        // Asserted below; avoid an unhandled rejection if abort() settles first.
      })

      await writer.abort(new Error('idle reader abort'))
      await assert.rejects(writeDone)
    })

    it('rejects a pending write and errors the writable when decryption fails mid-stream', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptFull(plaintext)
      let calls = 0
      const original = globalThis.crypto.subtle.decrypt
      globalThis.crypto.subtle.decrypt = ((...args: Parameters<SubtleCrypto['decrypt']>) => {
        calls++
        if (calls === 2) {
          return Promise.reject(new DOMException('boom', 'OperationError'))
        }
        return original.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['decrypt']

      try {
        const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
        const writer = writable.getWriter()
        const writeDone = writer.write(encoded) // envelope + 3 chunks: stays pending

        const reader = readable.getReader()
        await reader.read() // chunk 0 (decrypt call #1, succeeds)
        await assert.rejects(reader.read()) // chunk 1 (decrypt call #2, fails)

        await assert.rejects(writeDone)
        await assert.rejects(writer.write(Uint8Array.from([1, 2, 3, 4])))
      } finally {
        globalThis.crypto.subtle.decrypt = original
      }
    })

    it('settles cleanly when the readable is cancelled or the writable is aborted while idle', async () => {
      const a = decrypt(new Uint8Array(FIXED_CEK))
      await assert.doesNotReject(a.readable.cancel(new Error('idle cancel')))

      const b = decrypt(new Uint8Array(FIXED_CEK))
      await assert.doesNotReject(b.writable.abort(new Error('idle abort')))
    })

    it('rejects a pending read when the writable closes mid-envelope', async () => {
      const encoded = await encryptFull(deterministicPlaintext(10))
      const decodedEnvelope = decodeEnvelope(encoded)
      const { writable, readable } = decrypt(new Uint8Array(FIXED_CEK))
      const writer = writable.getWriter()
      const writeDone = writer.write(encoded.subarray(0, decodedEnvelope.envelopeLength - 5)) // incomplete envelope

      const reader = readable.getReader()
      const pending = reader.read() // waiting on the envelope handoff

      await assert.rejects(writer.close(), MalformedEnvelopeError)
      await assert.rejects(pending, MalformedEnvelopeError)
      await writeDone
    })
  })
})
