import assert from 'node:assert'
import { KEY_SIZE } from '../src/constants.ts'
import { CryptoOperationError, InvalidKeyError, MalformedEnvelopeError } from '../src/errors.ts'
import { aesKwWrap, importAesGcmKey, importAesKwKey } from '../src/internal/web-crypto.ts'
import { unwrapCek, WRAPPED_CEK_SIZE } from '../src/recipients/a256kw.ts'
import { hexToBytes } from './cose-fixtures.ts'

// RFC 3394 §4.6: wrap 256 bits of key data with a 256-bit KEK.
const RFC_KEK = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const RFC_CEK = hexToBytes('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f')
const RFC_WRAPPED = hexToBytes('28c9f404c4b810f4cbccb35cfb87f8263f5786e2d80ed326cbc7f0e71a99f43bfb988b9b7a02dd21')

const OTHER_KEK = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0xff - index)

/** Wrap arbitrary key bytes with Web Crypto directly, bypassing this package's validation. */
async function wrapRaw(
  keyBytes: Uint8Array,
  algorithm: AlgorithmIdentifier | HmacImportParams,
  usage: KeyUsage
): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle
  const kek = await subtle.importKey('raw', new Uint8Array(RFC_KEK), 'AES-KW', false, ['wrapKey'])
  const key = await subtle.importKey('raw', new Uint8Array(keyBytes), algorithm, true, [usage])
  return new Uint8Array(await subtle.wrapKey('raw', key, kek, 'AES-KW'))
}

async function withSubtle<K extends 'importKey' | 'wrapKey' | 'unwrapKey' | 'exportKey', T>(
  method: K,
  replacement: SubtleCrypto[K],
  action: () => Promise<T>
): Promise<T> {
  const subtle = globalThis.crypto.subtle
  const original = subtle[method]
  subtle[method] = replacement
  try {
    return await action()
  } finally {
    subtle[method] = original
  }
}

const notSupported = (() => Promise.reject(new DOMException('unavailable', 'NotSupportedError'))) as never
const operationErrorFromAnotherRealm = (() => Promise.reject({ name: 'OperationError' })) as never

describe('aesKwWrap', () => {
  it('matches the RFC 3394 §4.6 vector', async () => {
    const cekKey = await importAesGcmKey(new Uint8Array(RFC_CEK), 'encrypt', true)
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'wrapKey')

    const wrapped = await aesKwWrap(cekKey, kekKey)

    assert.strictEqual(wrapped.length, WRAPPED_CEK_SIZE)
    assert.deepStrictEqual(wrapped, RFC_WRAPPED)
  })

  it('reports non-integrity Web Crypto failures as CryptoOperationError', async () => {
    const cekKey = await importAesGcmKey(new Uint8Array(RFC_CEK), 'encrypt', true)
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'wrapKey')

    await withSubtle('wrapKey', notSupported, async () => {
      await assert.rejects(aesKwWrap(cekKey, kekKey), CryptoOperationError)
    })
  })
})

describe('unwrapCek', () => {
  it('recovers the RFC 3394 §4.6 key data', async () => {
    assert.deepStrictEqual(await unwrapCek(new Uint8Array(RFC_WRAPPED), new Uint8Array(RFC_KEK)), RFC_CEK)
  })

  it('round-trips a CEK through aesKwWrap', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index * 7 + 1)
    const cekKey = await importAesGcmKey(new Uint8Array(cek), 'encrypt', true)
    const kekKey = await importAesKwKey(new Uint8Array(OTHER_KEK), 'wrapKey')
    const wrapped = await aesKwWrap(cekKey, kekKey)

    assert.deepStrictEqual(await unwrapCek(wrapped, new Uint8Array(OTHER_KEK)), cek)
  })

  it('returns undefined for a wrong KEK', async () => {
    assert.strictEqual(await unwrapCek(new Uint8Array(RFC_WRAPPED), new Uint8Array(OTHER_KEK)), undefined)
  })

  it('returns undefined for a modified wrapped key', async () => {
    for (const index of [0, 8, WRAPPED_CEK_SIZE - 1]) {
      const modified = new Uint8Array(RFC_WRAPPED)
      modified[index] ^= 0x01
      assert.strictEqual(await unwrapCek(modified, new Uint8Array(RFC_KEK)), undefined)
    }
  })

  it('rejects a wrapped key of any length other than 40 bytes as malformed', async () => {
    // A genuine RFC 3394 wrap of 40 bytes of key material: it passes the
    // integrity check, so only the length check can decline it.
    const wrapped48 = await wrapRaw(new Uint8Array(40).fill(0x42), { name: 'HMAC', hash: 'SHA-256' }, 'sign')
    assert.strictEqual(wrapped48.length, 48)

    for (const wrapped of [new Uint8Array(0), RFC_WRAPPED.subarray(0, 32), wrapped48]) {
      await assert.rejects(unwrapCek(wrapped, new Uint8Array(RFC_KEK)), MalformedEnvelopeError)
    }
  })

  it('rejects a SharedArrayBuffer-backed wrapped key', async () => {
    const wrapped = new Uint8Array(new SharedArrayBuffer(WRAPPED_CEK_SIZE))
    await assert.rejects(unwrapCek(wrapped, new Uint8Array(RFC_KEK)), MalformedEnvelopeError)
  })

  it('rejects a SharedArrayBuffer-backed KEK', async () => {
    const kek = new Uint8Array(new SharedArrayBuffer(KEY_SIZE))
    await assert.rejects(unwrapCek(new Uint8Array(RFC_WRAPPED), kek), InvalidKeyError)
  })

  it('recognises an OperationError without relying on the local Error prototype', async () => {
    await withSubtle('unwrapKey', operationErrorFromAnotherRealm, async () => {
      assert.strictEqual(await unwrapCek(new Uint8Array(RFC_WRAPPED), new Uint8Array(RFC_KEK)), undefined)
    })
  })

  it('rejects a wrapped key that is not a Uint8Array', async () => {
    await assert.rejects(unwrapCek('wrapped' as unknown as Uint8Array, new Uint8Array(RFC_KEK)), MalformedEnvelopeError)
  })

  it('rejects a KEK that is not a 32-byte, non-zero Uint8Array', async () => {
    for (const bad of ['key', new Uint8Array(KEY_SIZE - 1), new Uint8Array(KEY_SIZE)]) {
      await assert.rejects(unwrapCek(new Uint8Array(RFC_WRAPPED), bad as Uint8Array), InvalidKeyError)
    }
  })

  it('rejects a correctly wrapped all-zero CEK instead of declining it', async () => {
    const wrappedZero = await wrapRaw(new Uint8Array(KEY_SIZE), 'AES-GCM', 'encrypt')

    await assert.rejects(unwrapCek(wrappedZero, new Uint8Array(RFC_KEK)), /Invalid recovered CEK: an all-zero/)
  })

  it('reports non-integrity Web Crypto failures as CryptoOperationError, not undefined', async () => {
    for (const method of ['importKey', 'unwrapKey', 'exportKey'] as const) {
      await withSubtle(method, notSupported, async () => {
        await assert.rejects(unwrapCek(new Uint8Array(RFC_WRAPPED), new Uint8Array(RFC_KEK)), CryptoOperationError)
      })
    }
  })
})
