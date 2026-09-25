import assert from 'node:assert'
import { type ChunkedEncryptOptions, encrypt } from '../src/aes-gcm-stream.ts'
import { assertWithinObjectLimit, chunkLayout } from '../src/chunk-layout.ts'
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

/** Deterministic plaintext: byte `i` of the whole (unchunked) source is `i & 0xff`. */
function deterministicPlaintext(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => i & 0xff)
}

/** A source that enqueues each of `blocks` from its own `pull()`, one per call. */
function sourceOf(blocks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < blocks.length) {
        controller.enqueue(blocks[index])
        index++
      } else {
        controller.close()
      }
    },
  })
}

async function readAllChunks(readable: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>[]> {
  const reader = readable.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value as Uint8Array<ArrayBuffer>)
  }
  return chunks
}

/** Read one chunk, asserting the stream isn't already done. */
async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const { value, done } = await reader.read()
  assert.strictEqual(done, false, 'expected another chunk, got end of stream')
  if (value === undefined) {
    throw new Error('test helper: read() reported not done but returned no value')
  }
  return value as Uint8Array<ArrayBuffer>
}

/**
 * Decrypt a full chunked object using this package's own `deriveChunkNonce`
 * and `chunkLayout` (already covered by their own unit tests). Used only for
 * general round-trip checks; the independent-oracle vectors above never use
 * this.
 */
async function decryptChunkedOutput(full: Uint8Array, cek: Uint8Array): Promise<Uint8Array> {
  const decoded = decodeEnvelope(full)
  const { chunkSize } = decoded.protectedHeader
  if (chunkSize === undefined) {
    throw new Error('test helper: expected a chunked-scheme header')
  }
  const ciphertext = full.subarray(decoded.envelopeLength)
  const layout = chunkLayout(ciphertext.length, chunkSize)
  const aad = encStructure(decoded.tag, decoded.protectedHeader.bytes)
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['decrypt'])

  const parts: Uint8Array[] = []
  let offset = 0
  for (let index = 0; index < layout.chunkCount; index++) {
    const isLast = index === layout.chunkCount - 1
    const cipherLength = isLast ? layout.lastChunkCipherLength : chunkSize + TAG_SIZE
    const chunkCiphertext = ciphertext.subarray(offset, offset + cipherLength) as Uint8Array<ArrayBuffer>
    offset += cipherLength
    const nonce = deriveChunkNonce(decoded.protectedHeader.iv, index, isLast)
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
      key,
      chunkCiphertext
    )
    parts.push(new Uint8Array(plaintext))
  }
  return concatBytes(...parts)
}

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
      { name: 'AES-GCM', iv: deriveChunkNonce(baseNonce, 0, false), additionalData: aad, tagLength: 128 },
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
})
