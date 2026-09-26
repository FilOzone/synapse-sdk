import assert from 'node:assert'
import { KEY_SIZE } from '../src/constants.ts'
import { CryptoOperationError } from '../src/errors.ts'
import { aesKwUnwrap, aesKwWrap, importAesGcmKey, importAesKwKey } from '../src/internal/web-crypto.ts'
import { hexToBytes } from './cose-fixtures.ts'

// RFC 3394 §4.6: wrap 256 bits of key data with a 256-bit KEK.
const RFC_KEK = hexToBytes('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f')
const RFC_CEK = hexToBytes('00112233445566778899aabbccddeeff000102030405060708090a0b0c0d0e0f')
const RFC_WRAPPED = hexToBytes('28c9f404c4b810f4cbccb35cfb87f8263f5786e2d80ed326cbc7f0e71a99f43bfb988b9b7a02dd21')

const OTHER_KEK = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0xff - index)

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

    assert.strictEqual(wrapped.length, 40)
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

describe('aesKwUnwrap', () => {
  it('recovers the RFC 3394 §4.6 key data', async () => {
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'unwrapKey')
    assert.deepStrictEqual(await aesKwUnwrap(new Uint8Array(RFC_WRAPPED), kekKey), RFC_CEK)
  })

  it('round-trips a CEK through aesKwWrap', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index * 7 + 1)
    const cekKey = await importAesGcmKey(new Uint8Array(cek), 'encrypt', true)
    const wrapKekKey = await importAesKwKey(new Uint8Array(OTHER_KEK), 'wrapKey')
    const wrapped = await aesKwWrap(cekKey, wrapKekKey)

    const unwrapKekKey = await importAesKwKey(new Uint8Array(OTHER_KEK), 'unwrapKey')
    assert.deepStrictEqual(await aesKwUnwrap(new Uint8Array(wrapped), unwrapKekKey), cek)
  })

  it('returns undefined for a wrong KEK', async () => {
    const kekKey = await importAesKwKey(new Uint8Array(OTHER_KEK), 'unwrapKey')
    assert.strictEqual(await aesKwUnwrap(new Uint8Array(RFC_WRAPPED), kekKey), undefined)
  })

  it('returns undefined for a modified wrapped key', async () => {
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'unwrapKey')
    for (const index of [0, 8, RFC_WRAPPED.length - 1]) {
      const modified = new Uint8Array(RFC_WRAPPED)
      modified[index] ^= 0x01
      assert.strictEqual(await aesKwUnwrap(modified, kekKey), undefined)
    }
  })

  it('recognises an OperationError without relying on the local Error prototype', async () => {
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'unwrapKey')
    await withSubtle('unwrapKey', operationErrorFromAnotherRealm, async () => {
      assert.strictEqual(await aesKwUnwrap(new Uint8Array(RFC_WRAPPED), kekKey), undefined)
    })
  })

  it('reports non-integrity Web Crypto failures as CryptoOperationError, not undefined', async () => {
    const kekKey = await importAesKwKey(new Uint8Array(RFC_KEK), 'unwrapKey')
    for (const method of ['unwrapKey', 'exportKey'] as const) {
      await withSubtle(method, notSupported, async () => {
        await assert.rejects(aesKwUnwrap(new Uint8Array(RFC_WRAPPED), kekKey), CryptoOperationError)
      })
    }
  })
})
