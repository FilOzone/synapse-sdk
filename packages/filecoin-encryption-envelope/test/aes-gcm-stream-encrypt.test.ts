import assert from 'node:assert'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { assertWithinObjectLimit } from '../src/chunk-layout.ts'
import {
  DEFAULT_CHUNK_SIZE,
  KEY_SIZE,
  MAX_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  MIN_CHUNK_SIZE,
  TAG_SIZE,
} from '../src/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import type { AppMetadata } from '../src/cose/headers.ts'
import {
  CryptoOperationError,
  InvalidChunkSizeError,
  InvalidKeyError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
} from '../src/errors.ts'
import { deriveChunkNonce } from '../src/nonce.ts'
import { FIXED_CEK, fixedBaseNonceRandomValues, withRandomValues } from './aes-gcm-fixtures.ts'
import {
  decryptChunkedOutput,
  deterministicPlaintext,
  readAllChunks,
  readChunk,
  sourceOf,
} from './aes-gcm-stream-fixtures.ts'
import { concatBytes, FIXTURE_BASE_NONCE_7, hexToBytes } from './cose-fixtures.ts'

const CHUNK_SIZE = 4096

// The exact envelope produced for { cek: FIXED_CEK, chunkSize: CHUNK_SIZE } with
// no contentType/appMetadata and the base nonce fixed to FIXTURE_BASE_NONCE_7.
// Envelope wire format is covered by its own byte-exact tests (cose-encode.test.ts,
// cose-headers.test.ts); this is generated once from this package's own encoder
// so this file doesn't re-derive CBOR bytes by hand.
const ENVELOPE_HEX =
  'd083583fa4013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f736520191000a0f6'

/**
 * Per-chunk expected tag and length, generated once with `node:crypto`
 * directly (never this package's `aesGcmEncrypt`/`deriveChunkNonce`) against
 * literal nonce bytes and the AAD from `encStructure` (itself covered
 * elsewhere). This is the independent oracle for the AEAD math.
 */
interface VectorChunk {
  isLast: boolean
  plaintextLength: number
  tagHex: string
}
interface Vector {
  name: string
  totalLength: number
  chunks: VectorChunk[]
}

const VECTORS: Vector[] = [
  {
    name: 'empty plaintext',
    totalLength: 0,
    chunks: [{ isLast: true, plaintextLength: 0, tagHex: 'beac63537a276db116e51c27e62d97fb' }],
  },
  {
    name: 'single partial chunk',
    totalLength: 100,
    chunks: [{ isLast: true, plaintextLength: 100, tagHex: '17403c2308c63f4ff3b0c3d6dc1ad16c' }],
  },
  {
    name: 'partial final chunk spanning >= 2 chunks',
    totalLength: CHUNK_SIZE + 100,
    chunks: [
      { isLast: false, plaintextLength: CHUNK_SIZE, tagHex: '8dc46d165505cb0f7e58d81682214619' },
      { isLast: true, plaintextLength: 100, tagHex: 'e2c3ed5be49fedbbf421f17177e1aff0' },
    ],
  },
  {
    name: 'exact multiple spanning >= 2 chunks',
    totalLength: CHUNK_SIZE * 2,
    chunks: [
      { isLast: false, plaintextLength: CHUNK_SIZE, tagHex: '8dc46d165505cb0f7e58d81682214619' },
      { isLast: true, plaintextLength: CHUNK_SIZE, tagHex: '4a8d16e14a9615be03111d2899974531' },
    ],
  },
]

describe('aesGcmStream.encrypt', () => {
  describe('independent vectors', () => {
    for (const vector of VECTORS) {
      it(`matches the independent oracle: ${vector.name}`, async () => {
        const plaintext = deterministicPlaintext(vector.totalLength)
        const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
          encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize: CHUNK_SIZE })
        )
        const writer = writable.getWriter()
        const writeDone = writer.write(plaintext)
        const closeDone = writer.close()

        const output = await readAllChunks(readable)
        await writeDone
        await closeDone

        assert.strictEqual(output.length, 1 + vector.chunks.length)
        assert.deepStrictEqual(output[0], hexToBytes(ENVELOPE_HEX))

        const decodedEnvelope = decodeEnvelope(output[0])
        const aad = encStructure(decodedEnvelope.tag, decodedEnvelope.protectedHeader.bytes)
        const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
          'decrypt',
        ])

        for (let i = 0; i < vector.chunks.length; i++) {
          const expected = vector.chunks[i]
          const chunk = output[i + 1]
          assert.strictEqual(chunk.length, expected.plaintextLength + TAG_SIZE)
          assert.deepStrictEqual(chunk.subarray(chunk.length - TAG_SIZE), hexToBytes(expected.tagHex))

          // Cross-check with Web Crypto too, using a literal nonce (not deriveChunkNonce).
          const nonce = new Uint8Array(12)
          nonce.set(FIXTURE_BASE_NONCE_7, 0)
          const view = new DataView(nonce.buffer)
          view.setUint32(7, i, false)
          nonce[11] = expected.isLast ? 1 : 0

          const plaintextSlice = await globalThis.crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
            key,
            chunk
          )
          assert.deepStrictEqual(
            new Uint8Array(plaintextSlice),
            plaintext.subarray(i * CHUNK_SIZE, i * CHUNK_SIZE + expected.plaintextLength)
          )
        }
      })
    }
  })

  it('encrypts and imports the key lazily, exactly one pull at a time', async () => {
    const chunkSize = MIN_CHUNK_SIZE
    let encryptCalls = 0
    let importCalls = 0
    const originalEncrypt = globalThis.crypto.subtle.encrypt
    const originalImportKey = globalThis.crypto.subtle.importKey
    globalThis.crypto.subtle.encrypt = ((...args: Parameters<SubtleCrypto['encrypt']>) => {
      encryptCalls++
      return originalEncrypt.apply(globalThis.crypto.subtle, args)
    }) as SubtleCrypto['encrypt']
    globalThis.crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      importCalls++
      return originalImportKey.apply(globalThis.crypto.subtle, args)
    }) as SubtleCrypto['importKey']

    try {
      // Proves the absence of extra work, which no completion signal can show.
      // Everything before each counted Web Crypto call is microtasks, so one
      // macrotask is enough for any prefetching pull to reach it.
      const settle = () => new Promise((resolve) => setTimeout(resolve, 0))
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize })
      await settle()
      assert.strictEqual(importCalls, 0, 'no key import before the first pull')
      assert.strictEqual(encryptCalls, 0)

      const writer = writable.getWriter()
      const data = Uint8Array.from({ length: chunkSize * 8 }, (_, i) => i) // exactly 8 chunks
      const writeDone = writer.write(data) // not awaited
      const closeDone = writer.close()

      const reader = readable.getReader()
      await reader.read() // envelope
      await settle()
      assert.strictEqual(encryptCalls, 0)
      assert.strictEqual(importCalls, 1)

      for (let k = 1; k <= 8; k++) {
        const { done } = await reader.read()
        assert.strictEqual(done, false)
        await settle()
        assert.strictEqual(encryptCalls, k)
        assert.strictEqual(importCalls, 1, 'the key is imported once, not once per chunk')
      }
      const last = await reader.read()
      assert.strictEqual(last.done, true)

      await writeDone
      await closeDone
    } finally {
      globalThis.crypto.subtle.encrypt = originalEncrypt
      globalThis.crypto.subtle.importKey = originalImportKey
    }
  })

  it('rejects options that are not an object', () => {
    assert.throws(() => encrypt(null as unknown as ChunkedEncryptOptions), MalformedEnvelopeError)
    assert.throws(() => encrypt('nope' as unknown as ChunkedEncryptOptions), MalformedEnvelopeError)
  })

  it('rejects a non-byte, wrong-length, or all-zero CEK', () => {
    const invalidOptions: ChunkedEncryptOptions[] = [
      { cek: 'key' as unknown as Uint8Array },
      { cek: new Uint8Array(KEY_SIZE - 1) },
      { cek: new Uint8Array(KEY_SIZE + 1) },
      { cek: new Uint8Array(KEY_SIZE) }, // all-zero
    ]
    for (const options of invalidOptions) {
      assert.throws(() => encrypt(options), InvalidKeyError)
    }
  })

  it('rejects an invalid chunkSize, including the default when omitted being in range', () => {
    const invalidOptions: ChunkedEncryptOptions[] = [
      { cek: new Uint8Array(FIXED_CEK), chunkSize: MIN_CHUNK_SIZE - 1 },
      { cek: new Uint8Array(FIXED_CEK), chunkSize: MAX_CHUNK_SIZE + 1 },
      { cek: new Uint8Array(FIXED_CEK), chunkSize: 1.5 },
      { cek: new Uint8Array(FIXED_CEK), chunkSize: Number.NaN },
      { cek: new Uint8Array(FIXED_CEK), chunkSize: 'big' as unknown as number },
    ]
    for (const options of invalidOptions) {
      assert.throws(() => encrypt(options), InvalidChunkSizeError)
    }
    assert.doesNotThrow(() => encrypt({ cek: new Uint8Array(FIXED_CEK) }))
  })

  it('rejects an invalid contentType or appMetadata synchronously', () => {
    assert.throws(
      () => encrypt({ cek: new Uint8Array(FIXED_CEK), contentType: {} as unknown as string }),
      MalformedEnvelopeError
    )
    assert.throws(
      () => encrypt({ cek: new Uint8Array(FIXED_CEK), appMetadata: 'nope' as unknown as AppMetadata }),
      MalformedEnvelopeError
    )
  })

  it('draws the base nonce exactly once, carries it as the header iv, and applies DEFAULT_CHUNK_SIZE', async () => {
    let calls = 0
    const countingRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
      calls++
      return fixedBaseNonceRandomValues(array)
    }) as Crypto['getRandomValues']

    const { readable } = await withRandomValues(countingRandomValues, async () =>
      encrypt({ cek: new Uint8Array(FIXED_CEK) })
    )
    assert.strictEqual(calls, 1)

    const envelope = await readChunk(readable.getReader())
    const decoded = decodeEnvelope(envelope)
    assert.deepStrictEqual(decoded.protectedHeader.iv, FIXTURE_BASE_NONCE_7)
    assert.strictEqual(decoded.protectedHeader.chunkSize, DEFAULT_CHUNK_SIZE)
  })

  it('assertWithinObjectLimit passes exactly at the boundary and throws one byte over it', () => {
    assert.doesNotThrow(() => assertWithinObjectLimit(MAX_ENCODED_OBJECT_SIZE - 10, 10))
    assert.throws(() => assertWithinObjectLimit(MAX_ENCODED_OBJECT_SIZE - 9, 10), InvalidPlaintextLengthError)
  })

  it('errors the stream when CEK import fails', async () => {
    const original = globalThis.crypto.subtle.importKey
    globalThis.crypto.subtle.importKey = (() =>
      Promise.reject(new DOMException('AES-GCM is unavailable', 'NotSupportedError'))) as SubtleCrypto['importKey']

    try {
      const { readable } = encrypt({ cek: new Uint8Array(FIXED_CEK) })
      await assert.rejects(readable.getReader().read(), CryptoOperationError)
    } finally {
      globalThis.crypto.subtle.importKey = original
    }
  })

  it('errors the output mid-stream when the source errors, and the emitted chunk never authenticates as last', async () => {
    const chunkSize = 4096
    let pulls = 0
    const source = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls++
        if (pulls === 1) {
          controller.enqueue(deterministicPlaintext(chunkSize * 2))
          return
        }
        controller.error(new Error('source failed'))
      },
    })

    const output = source.pipeThrough(encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize }))
    const reader = output.getReader()

    const envelope = await readChunk(reader)
    const decodedEnvelope = decodeEnvelope(envelope)
    const aad = encStructure(decodedEnvelope.tag, decodedEnvelope.protectedHeader.bytes)
    const baseNonce = decodedEnvelope.protectedHeader.iv

    const chunk = await readChunk(reader)
    assert.strictEqual(chunk.length, chunkSize + TAG_SIZE)

    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
      'decrypt',
    ])
    const decrypted = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: Uint8Array.of(...baseNonce, 0, 0, 0, 0, 0x00), additionalData: aad, tagLength: 128 },
      key,
      chunk
    )
    assert.strictEqual(new Uint8Array(decrypted).length, chunkSize)

    await assert.rejects(
      globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: deriveChunkNonce(baseNonce, 0, true), additionalData: aad, tagLength: 128 },
        key,
        chunk
      ),
      'the same ciphertext must not also authenticate as the final chunk'
    )

    await assert.rejects(reader.read())
  })

  it('rejects a pending write when the readable is cancelled', async () => {
    const chunkSize = 4096
    const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize })
    const writer = writable.getWriter()
    // Bigger than chunkSize: held for zero-copy slicing, so nobody has pulled it yet.
    const writeDone = writer.write(deterministicPlaintext(chunkSize * 2))

    await readable.cancel(new Error('consumer gave up'))
    await assert.rejects(writeDone)
  })

  it('rejects a pending read when the writable is aborted', async () => {
    const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK) })
    const reader = readable.getReader()
    await reader.read() // envelope; imports the key

    const pending = reader.read() // nothing written yet, so this waits
    await writable.getWriter().abort(new Error('producer gave up'))
    await assert.rejects(pending)
  })

  it('rejects a pending write and errors the writable when encryption fails mid-stream', async () => {
    const chunkSize = MIN_CHUNK_SIZE
    let calls = 0
    const original = globalThis.crypto.subtle.encrypt
    globalThis.crypto.subtle.encrypt = ((...args: Parameters<SubtleCrypto['encrypt']>) => {
      calls++
      if (calls === 2) {
        return Promise.reject(new DOMException('boom', 'OperationError'))
      }
      return original.apply(globalThis.crypto.subtle, args)
    }) as SubtleCrypto['encrypt']

    try {
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize })
      const writer = writable.getWriter()
      // 3 chunks worth: chunk 0 and chunk 1 are both zero-copy slices, so the
      // write is still pending (block still referenced) when chunk 1's
      // encryption fails.
      const writeDone = writer.write(deterministicPlaintext(chunkSize * 3))

      const reader = readable.getReader()
      await reader.read() // envelope
      await reader.read() // chunk 0 (encrypt call #1, succeeds)
      await assert.rejects(reader.read()) // chunk 1 (encrypt call #2, fails)

      await assert.rejects(writeDone)
      await assert.rejects(writer.write(Uint8Array.from([1, 2, 3, 4])))
    } finally {
      globalThis.crypto.subtle.encrypt = original
    }
  })

  it('settles cleanly when the readable is cancelled or the writable is aborted while idle', async () => {
    const a = encrypt({ cek: new Uint8Array(FIXED_CEK) })
    await assert.doesNotReject(a.readable.cancel(new Error('idle cancel')))

    const b = encrypt({ cek: new Uint8Array(FIXED_CEK) })
    const reason = new Error('idle abort')
    await assert.doesNotReject(b.writable.abort(reason))
    // No envelope for input that already failed: the first read reports it.
    await assert.rejects(b.readable.getReader().read(), (err) => err === reason)
  })

  it('emits no envelope when an invalid block was written before the first read', async () => {
    const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK) })
    // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
    await assert.rejects(writable.getWriter().write('not bytes'), InvalidPlaintextError)
    await assert.rejects(readable.getReader().read(), InvalidPlaintextError)
  })

  it('round-trips a multi-block, non-aligned source through pipeThrough', async () => {
    const chunkSize = MIN_CHUNK_SIZE
    const totalLength = chunkSize + 37 // not a multiple of chunkSize
    const plaintext = deterministicPlaintext(totalLength)
    const blocks = [
      plaintext.subarray(0, 1000),
      plaintext.subarray(1000, 1000), // empty block, interleaved
      plaintext.subarray(1000, 3000),
      plaintext.subarray(3000, totalLength),
    ]

    const output = sourceOf(blocks).pipeThrough(encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize }))
    const chunks = await readAllChunks(output)
    const full = concatBytes(...chunks)

    const decrypted = await decryptChunkedOutput(full, FIXED_CEK)
    assert.deepStrictEqual(decrypted, plaintext)
  })

  describe('contentLength', () => {
    // Envelope hex and tag generated once with node:crypto directly (never
    // this package's aesGcmEncrypt/deriveChunkNonce), against the AAD from
    // encStructure and a literal nonce -- same approach as the independent
    // vectors above, extended to a header carrying plaintext_length.
    const CONTENT_LENGTH_VECTOR = {
      contentLength: 100,
      envelopeHex:
        'd0835846a5013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f7365201910003a000100fc1864a0f6',
      tagHex: '7eeeed681893653415ca0dfed7f67871',
    }

    it('matches the independent oracle for an envelope carrying plaintext_length', async () => {
      const plaintext = deterministicPlaintext(CONTENT_LENGTH_VECTOR.contentLength)
      const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
        encrypt({
          cek: new Uint8Array(FIXED_CEK),
          chunkSize: CHUNK_SIZE,
          contentLength: CONTENT_LENGTH_VECTOR.contentLength,
        })
      )
      const writer = writable.getWriter()
      const writeDone = writer.write(plaintext)
      const closeDone = writer.close()

      const output = await readAllChunks(readable)
      await writeDone
      await closeDone

      assert.strictEqual(output.length, 2)
      assert.deepStrictEqual(output[0], hexToBytes(CONTENT_LENGTH_VECTOR.envelopeHex))
      const chunk = output[1]
      assert.strictEqual(chunk.length, CONTENT_LENGTH_VECTOR.contentLength + TAG_SIZE)
      assert.deepStrictEqual(chunk.subarray(chunk.length - TAG_SIZE), hexToBytes(CONTENT_LENGTH_VECTOR.tagHex))
    })

    it('writes plaintext_length only when contentLength is given, equal to it', async () => {
      const { readable: withoutLength } = encrypt({ cek: new Uint8Array(FIXED_CEK) })
      const envelope1 = await readChunk(withoutLength.getReader())
      assert.strictEqual(decodeEnvelope(envelope1).protectedHeader.plaintextLength, undefined)

      const { readable: withLength } = encrypt({ cek: new Uint8Array(FIXED_CEK), contentLength: 12345 })
      const envelope2 = await readChunk(withLength.getReader())
      assert.strictEqual(decodeEnvelope(envelope2).protectedHeader.plaintextLength, 12345)
    })

    it('rejects an invalid contentLength synchronously', () => {
      const invalidValues: unknown[] = [-1, 1.5, Number.NaN, '10', 2 ** 53]
      for (const contentLength of invalidValues) {
        assert.throws(
          () => encrypt({ cek: new Uint8Array(FIXED_CEK), contentLength: contentLength as number }),
          InvalidPlaintextLengthError
        )
      }
      // The implied ciphertext alone already exceeds MAX_ENCODED_OBJECT_SIZE.
      assert.throws(
        () =>
          encrypt({
            cek: new Uint8Array(FIXED_CEK),
            chunkSize: MIN_CHUNK_SIZE,
            contentLength: MAX_ENCODED_OBJECT_SIZE,
          }),
        InvalidPlaintextLengthError
      )
    })

    it('preflights envelope + ciphertext against MAX_ENCODED_OBJECT_SIZE before any allocation', async () => {
      // Hand-calculated at chunk size 4096 (stride 4112):
      //   envelope   83 bytes: the 76-byte vector envelope above, with
      //              plaintext_length grown from `18 64` to `1b` + 8 bytes
      //   budget     2^36 - 83 = 68,719,476,653 = 16,711,934 × 4112 + 4045
      //   P          16,711,934 × 4096 + (4045 - 16) = 68,452,085,693
      // so envelope + C lands exactly on 2^36, and P + 1 is one byte over.
      const atLimit = 68_452_085_693
      const { readable } = encrypt({
        cek: new Uint8Array(FIXED_CEK),
        chunkSize: MIN_CHUNK_SIZE,
        contentLength: atLimit,
      })
      const envelope = await readChunk(readable.getReader())
      assert.strictEqual(envelope.length, 83, 'fixture assumes an 83-byte envelope')

      assert.throws(
        () => encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize: MIN_CHUNK_SIZE, contentLength: atLimit + 1 }),
        InvalidPlaintextLengthError
      )
    })

    it('round-trips when contentLength matches the source exactly', async () => {
      const chunkSize = CHUNK_SIZE
      for (const contentLength of [0, chunkSize, chunkSize * 2 + 100]) {
        const plaintext = deterministicPlaintext(contentLength)
        const output = sourceOf([plaintext]).pipeThrough(
          encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize, contentLength })
        )
        const chunks = await readAllChunks(output)
        const full = concatBytes(...chunks)

        assert.strictEqual(decodeEnvelope(full).protectedHeader.plaintextLength, contentLength)
        const decrypted = await decryptChunkedOutput(full, FIXED_CEK)
        assert.deepStrictEqual(decrypted, plaintext)
      }
    })

    it('underrun: emits exactly the completed non-final chunks, then rejects', async () => {
      const chunkSize = CHUNK_SIZE
      const { writable, readable } = encrypt({
        cek: new Uint8Array(FIXED_CEK),
        chunkSize,
        contentLength: chunkSize * 3,
      })
      const writer = writable.getWriter()
      // Two full chunks written; a third was promised but never arrives.
      const write1 = writer.write(deterministicPlaintext(chunkSize))
      const write2 = writer.write(deterministicPlaintext(chunkSize))
      const closeAttempt = writer.close()

      const reader = readable.getReader()
      const envelope = await readChunk(reader)
      const decodedEnvelope = decodeEnvelope(envelope)
      const aad = encStructure(decodedEnvelope.tag, decodedEnvelope.protectedHeader.bytes)
      const baseNonce = decodedEnvelope.protectedHeader.iv

      const chunk1 = await readChunk(reader)
      assert.strictEqual(chunk1.length, chunkSize + TAG_SIZE)
      const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
        'decrypt',
      ])
      const decrypted1 = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Uint8Array.of(...baseNonce, 0, 0, 0, 0, 0x00), additionalData: aad, tagLength: 128 },
        key,
        chunk1
      )
      assert.deepStrictEqual(new Uint8Array(decrypted1), deterministicPlaintext(chunkSize))

      await assert.rejects(reader.read(), InvalidPlaintextLengthError)
      await assert.rejects(closeAttempt, InvalidPlaintextLengthError)
      await write1
      await write2
    })

    it('overrun: emits exactly the completed non-final chunks, then rejects', async () => {
      const chunkSize = CHUNK_SIZE
      const { writable, readable } = encrypt({
        cek: new Uint8Array(FIXED_CEK),
        chunkSize,
        contentLength: chunkSize * 2,
      })
      const writer = writable.getWriter()
      // One big block exactly matching contentLength, so its first chunk is a
      // zero-copy slice decidable as non-last on its own; then one more byte
      // arrives and overruns.
      const write1 = writer.write(deterministicPlaintext(chunkSize * 2))
      const write2 = writer.write(Uint8Array.from([0]))

      const reader = readable.getReader()
      const envelope = await readChunk(reader)
      const decodedEnvelope = decodeEnvelope(envelope)
      const aad = encStructure(decodedEnvelope.tag, decodedEnvelope.protectedHeader.bytes)
      const baseNonce = decodedEnvelope.protectedHeader.iv

      const chunk1 = await readChunk(reader)
      assert.strictEqual(chunk1.length, chunkSize + TAG_SIZE)
      const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
        'decrypt',
      ])
      const decrypted1 = await globalThis.crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: Uint8Array.of(...baseNonce, 0, 0, 0, 0, 0x00), additionalData: aad, tagLength: 128 },
        key,
        chunk1
      )
      assert.deepStrictEqual(new Uint8Array(decrypted1), deterministicPlaintext(chunkSize))

      // write1's tail (the rest of the 2×chunkSize block) is still held --
      // this next pull is what drains and releases it, which is also what
      // finally lets the platform attempt write2's now-overrunning intake.
      await assert.rejects(reader.read(), InvalidPlaintextLengthError)
      await write1
      await assert.rejects(write2, InvalidPlaintextLengthError)
    })

    it('rejects the entire block when a single write already overruns, emitting no chunks at all', async () => {
      const chunkSize = CHUNK_SIZE
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize, contentLength: chunkSize })
      const reader = readable.getReader()
      await readChunk(reader) // envelope, read before the offending write is even issued

      const writer = writable.getWriter()
      const write = writer.write(deterministicPlaintext(chunkSize + 1))

      await assert.rejects(reader.read(), InvalidPlaintextLengthError)
      await assert.rejects(write, InvalidPlaintextLengthError)
    })

    it('treats contentLength 0 as declared, rejecting a single extra byte', async () => {
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), contentLength: 0 })
      const reader = readable.getReader()
      const envelope = await readChunk(reader)
      assert.strictEqual(decodeEnvelope(envelope).protectedHeader.plaintextLength, 0)

      await assert.rejects(writable.getWriter().write(Uint8Array.of(1)), InvalidPlaintextLengthError)
      await assert.rejects(reader.read(), InvalidPlaintextLengthError)
    })

    it('rejects the third of three under-chunk-sized writes once intake exceeds contentLength', async () => {
      const chunkSize = CHUNK_SIZE
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize, contentLength: 250 })
      const reader = readable.getReader()
      await readChunk(reader) // envelope, read before any write can fail

      const writer = writable.getWriter()
      await writer.write(deterministicPlaintext(100)) // 100/250
      await writer.write(deterministicPlaintext(100)) // 200/250
      await assert.rejects(writer.write(deterministicPlaintext(100)), InvalidPlaintextLengthError) // 300 > 250

      await assert.rejects(reader.read(), InvalidPlaintextLengthError)
    })
  })
})
