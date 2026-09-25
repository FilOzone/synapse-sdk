import assert from 'node:assert'
import { decrypt, type EncryptOptions, encrypt } from '../src/aes-gcm.ts'
import {
  ALG_AES_256_GCM,
  ALG_CHUNKED_AES_256_GCM_STREAM,
  KEY_SIZE,
  MAX_AES_GCM_PLAINTEXT_SIZE,
  NONCE_SIZE,
  TAG_SIZE,
} from '../src/constants.ts'
import { ALG_A256KW, TAG_ENCRYPT, TAG_ENCRYPT0 } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import type { RecipientInput } from '../src/cose/encode.ts'
import { assemblePreparedEnvelope, encodeEnvelope, prepareEnvelope } from '../src/cose/encode.ts'
import { encodeProtectedHeader } from '../src/cose/headers.ts'
import {
  AuthenticationError,
  CryptoOperationError,
  InvalidCiphertextLengthError,
  InvalidKeyError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
  UnsupportedSchemeError,
} from '../src/errors.ts'
import { FIXED_CEK, fixedRandomValues, HELLO, HELLO_VECTOR_HEX, withRandomValues } from './aes-gcm-fixtures.ts'
import { concatBytes, FIXTURE_BASE_NONCE_7, FIXTURE_IV_12, hexToBytes, toNullProto } from './cose-fixtures.ts'

const TEST_RECIPIENT: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map([[1, ALG_A256KW]]),
  ciphertext: new Uint8Array(40),
}

const UNSUPPORTED_RECIPIENT: RecipientInput = {
  protectedBytes: new Uint8Array(0),
  unprotected: new Map([[1, -999]]),
  ciphertext: new Uint8Array(40),
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) {
        continue outer
      }
    }
    return offset
  }
  return -1
}

async function decryptWithWebCrypto(encoded: Uint8Array, cek: Uint8Array): Promise<Uint8Array> {
  const decoded = decodeEnvelope(encoded)
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['decrypt'])
  const plaintext = await globalThis.crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: new Uint8Array(decoded.protectedHeader.iv),
      additionalData: encStructure(decoded.tag, decoded.protectedHeader.bytes),
      tagLength: 128,
    },
    key,
    new Uint8Array(encoded.subarray(decoded.envelopeLength))
  )
  return new Uint8Array(plaintext)
}

async function encryptTag96WithWebCrypto(
  plaintext: Uint8Array,
  cek: Uint8Array,
  recipient: RecipientInput = TEST_RECIPIENT
): Promise<Uint8Array> {
  const prepared = prepareEnvelope({
    protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 },
    recipients: [recipient],
  })
  assert.strictEqual(prepared.tag, TAG_ENCRYPT)

  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['encrypt'])
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv: FIXTURE_IV_12,
      additionalData: encStructure(TAG_ENCRYPT, prepared.protectedBytes),
      tagLength: 128,
    },
    key,
    new Uint8Array(plaintext)
  )
  return concatBytes(prepared.bytes, new Uint8Array(ciphertext))
}

describe('aesGcm.encrypt', () => {
  it('matches a byte-exact scheme-1 vector', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )

    assert.deepStrictEqual(encoded, hexToBytes(HELLO_VECTOR_HEX))
  })

  it('writes a tag-16 envelope and detached ciphertext that Web Crypto can decrypt', async () => {
    const cek = new Uint8Array(FIXED_CEK)
    const plaintext = new Uint8Array(HELLO)
    const encoded = await withRandomValues(fixedRandomValues, () => encrypt(plaintext, { cek }))
    const decoded = decodeEnvelope(encoded)

    assert.strictEqual(decoded.tag, TAG_ENCRYPT0)
    assert.strictEqual(decoded.protectedHeader.alg, ALG_AES_256_GCM)
    assert.deepStrictEqual(decoded.protectedHeader.iv, FIXTURE_IV_12)
    assert.strictEqual(encoded.length - decoded.envelopeLength, plaintext.length + TAG_SIZE)
    assert.deepStrictEqual(await decryptWithWebCrypto(encoded, cek), plaintext)
    assert.deepStrictEqual(cek, FIXED_CEK)
  })

  it('encrypts an empty plaintext as one authentication tag', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(0), { cek: new Uint8Array(FIXED_CEK) })
    )
    const decoded = decodeEnvelope(encoded)

    assert.strictEqual(encoded.length - decoded.envelopeLength, TAG_SIZE)
    assert.deepStrictEqual(await decryptWithWebCrypto(encoded, FIXED_CEK), new Uint8Array(0))
  })

  it('carries content type and application metadata in the protected header', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), {
        cek: new Uint8Array(FIXED_CEK),
        contentType: 'text/plain',
        appMetadata: { name: 'greeting', revision: 1 },
      })
    )
    const decoded = decodeEnvelope(encoded)

    assert.strictEqual(decoded.protectedHeader.contentType, 'text/plain')
    assert.deepStrictEqual(decoded.protectedHeader.appMetadata, toNullProto({ name: 'greeting', revision: 1 }))
  })

  it('rejects plaintext that is not a Uint8Array', async () => {
    await assert.rejects(
      encrypt('hello' as unknown as Uint8Array, { cek: new Uint8Array(FIXED_CEK) }),
      InvalidPlaintextError
    )
  })

  it('rejects a SharedArrayBuffer-backed plaintext', async () => {
    const plaintext = new Uint8Array(new SharedArrayBuffer(HELLO.length))
    await assert.rejects(encrypt(plaintext, { cek: new Uint8Array(FIXED_CEK) }), InvalidPlaintextError)
  })

  it('rejects a SharedArrayBuffer-backed CEK', async () => {
    const cek = new Uint8Array(new SharedArrayBuffer(KEY_SIZE))
    await assert.rejects(encrypt(new Uint8Array(HELLO), { cek }), InvalidKeyError)
  })

  it('rejects a non-byte, wrong-length, or all-zero CEK', async () => {
    const invalidOptions: EncryptOptions[] = [
      { cek: 'key' as unknown as Uint8Array },
      { cek: new Uint8Array(KEY_SIZE - 1) },
      { cek: new Uint8Array(KEY_SIZE + 1) },
      { cek: new Uint8Array(KEY_SIZE) },
    ]

    for (const options of invalidOptions) {
      await assert.rejects(encrypt(new Uint8Array(HELLO), options), InvalidKeyError)
    }
  })

  it('rejects malformed options with a package error', async () => {
    await assert.rejects(encrypt(new Uint8Array(HELLO), null as unknown as EncryptOptions), MalformedEnvelopeError)
  })

  it('round-trips plaintext at the 64 MiB scheme-1 limit', async function () {
    this.timeout(10_000)

    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(MAX_AES_GCM_PLAINTEXT_SIZE), { cek: new Uint8Array(FIXED_CEK) })
    )
    const decoded = decodeEnvelope(encoded)
    const plaintext = await decrypt(encoded, new Uint8Array(FIXED_CEK))

    assert.strictEqual(encoded.length - decoded.envelopeLength, MAX_AES_GCM_PLAINTEXT_SIZE + TAG_SIZE)
    assert.strictEqual(plaintext.length, MAX_AES_GCM_PLAINTEXT_SIZE)
  })

  it('rejects plaintext above the 64 MiB scheme-1 limit before encryption', async () => {
    const oversized = new Uint8Array(MAX_AES_GCM_PLAINTEXT_SIZE + 1)
    await assert.rejects(encrypt(oversized, { cek: new Uint8Array(FIXED_CEK) }), InvalidPlaintextLengthError)
  })

  it('wraps failure to obtain random IV bytes as a CryptoOperationError', async () => {
    const failingRandomValues = (() => {
      throw new Error('random source unavailable')
    }) as Crypto['getRandomValues']

    await withRandomValues(failingRandomValues, async () => {
      await assert.rejects(encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) }), CryptoOperationError)
    })
  })

  it('requests a fresh IV for every encryption call', async () => {
    let invocation = 0
    const sequentialRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
      invocation += 1
      array.fill(invocation)
      return array
    }) as Crypto['getRandomValues']

    const [first, second] = await withRandomValues(sequentialRandomValues, async () => {
      const first = await encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
      const second = await encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
      return [first, second]
    })

    assert.strictEqual(invocation, 2)
    assert.deepStrictEqual(decodeEnvelope(first).protectedHeader.iv, new Uint8Array(NONCE_SIZE).fill(1))
    assert.deepStrictEqual(decodeEnvelope(second).protectedHeader.iv, new Uint8Array(NONCE_SIZE).fill(2))
  })
})

describe('aesGcm.decrypt', () => {
  it('round-trips a tag-16 envelope', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )

    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('accepts a tag-only ciphertext for empty plaintext', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(0), { cek: new Uint8Array(FIXED_CEK) })
    )

    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), new Uint8Array(0))
  })

  it('decrypts a tag-96 envelope with a directly supplied CEK', async () => {
    const encoded = await encryptTag96WithWebCrypto(HELLO, FIXED_CEK)

    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('rejects a malformed tag-96 recipient even when the CEK is supplied directly', async () => {
    const encoded = await encryptTag96WithWebCrypto(HELLO, FIXED_CEK)
    const malformed = new Uint8Array(encoded)
    const recipientAlgorithm = findBytes(malformed, hexToBytes('a10124'))
    assert.notStrictEqual(recipientAlgorithm, -1)
    malformed[recipientAlgorithm + 2] = 0xf5

    await assert.rejects(decrypt(malformed, new Uint8Array(FIXED_CEK)), MalformedEnvelopeError)
  })

  it('rejects a tag-96 A256KW recipient with a bad ciphertext length, even with a directly supplied CEK', async () => {
    // `prepareEnvelope` (the checked encoder) would reject this recipient
    // outright, so this bad envelope can only be built through the trusted
    // `assemblePreparedEnvelope` path, which does not check ciphertext
    // length itself — proving the check that matters here is decodeEnvelope's.
    const badRecipient: RecipientInput = { ...TEST_RECIPIENT, ciphertext: new Uint8Array(39) }
    const protectedBytes = encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 })
    const prepared = assemblePreparedEnvelope(protectedBytes, [badRecipient])

    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
      'encrypt',
    ])
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      {
        name: 'AES-GCM',
        iv: FIXTURE_IV_12,
        additionalData: encStructure(TAG_ENCRYPT, prepared.protectedBytes),
        tagLength: 128,
      },
      key,
      new Uint8Array(HELLO)
    )
    const encoded = concatBytes(prepared.bytes, new Uint8Array(ciphertext))

    await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), MalformedEnvelopeError)
  })

  it('decrypts with a directly supplied CEK despite an unsupported recipient algorithm', async () => {
    const encoded = await encryptTag96WithWebCrypto(HELLO, FIXED_CEK, UNSUPPORTED_RECIPIENT)

    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('uses the Encrypt context for tag 96 rather than Encrypt0', async () => {
    const encoded = await encryptTag96WithWebCrypto(HELLO, FIXED_CEK)
    const decoded = decodeEnvelope(encoded)
    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
      'decrypt',
    ])

    await assert.rejects(
      globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(decoded.protectedHeader.iv),
          additionalData: encStructure(TAG_ENCRYPT0, decoded.protectedHeader.bytes),
          tagLength: 128,
        },
        key,
        new Uint8Array(encoded.subarray(decoded.envelopeLength))
      )
    )
    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('rejects the chunked scheme', async () => {
    const envelope = encodeEnvelope({
      protectedHeader: {
        alg: ALG_CHUNKED_AES_256_GCM_STREAM,
        iv: FIXTURE_BASE_NONCE_7,
        chunkSize: 4096,
      },
    })
    const encoded = concatBytes(envelope, new Uint8Array(TAG_SIZE))

    await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), UnsupportedSchemeError)
  })

  it('reports a wrong key, modified ciphertext, and modified tag as authentication failures', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const decoded = decodeEnvelope(encoded)
    const wrongKey = Uint8Array.from(FIXED_CEK, (byte) => byte ^ 0xff)
    const changedCiphertext = new Uint8Array(encoded)
    changedCiphertext[decoded.envelopeLength] ^= 0x01
    const changedTag = new Uint8Array(encoded)
    changedTag[changedTag.length - 1] ^= 0x01

    const failures: AuthenticationError[] = []
    for (const [candidate, key] of [
      [encoded, wrongKey],
      [changedCiphertext, FIXED_CEK],
      [changedTag, FIXED_CEK],
    ] as const) {
      try {
        await decrypt(candidate, new Uint8Array(key))
        assert.fail('Expected decryption to fail authentication.')
      } catch (error) {
        if (!(error instanceof AuthenticationError)) {
          throw error
        }
        failures.push(error)
      }
    }
    assert.strictEqual(failures.length, 3)
    assert.strictEqual(new Set(failures.map((error) => `${error.name}:${error.message}`)).size, 1)
  })

  it('authenticates application metadata in the protected header', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), {
        cek: new Uint8Array(FIXED_CEK),
        appMetadata: { state: 'before' },
      })
    )
    const decoded = decodeEnvelope(encoded)
    const protectedOffset = findBytes(encoded.subarray(0, decoded.envelopeLength), decoded.protectedHeader.bytes)
    const valueOffset = findBytes(decoded.protectedHeader.bytes, new TextEncoder().encode('before'))
    assert.notStrictEqual(protectedOffset, -1)
    assert.notStrictEqual(valueOffset, -1)

    const changedHeader = new Uint8Array(encoded)
    changedHeader[protectedOffset + valueOffset] = 'B'.charCodeAt(0)
    const changedDecoded = decodeEnvelope(changedHeader)
    assert.deepStrictEqual(changedDecoded.protectedHeader.appMetadata, toNullProto({ state: 'Before' }))

    await assert.rejects(decrypt(changedHeader, new Uint8Array(FIXED_CEK)), AuthenticationError)
  })

  it('does not report non-authentication Web Crypto failures as AuthenticationError', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const original = globalThis.crypto.subtle.decrypt
    globalThis.crypto.subtle.decrypt = (() =>
      Promise.reject(new DOMException('AES-GCM is unavailable', 'NotSupportedError'))) as SubtleCrypto['decrypt']

    try {
      await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), CryptoOperationError)
    } finally {
      globalThis.crypto.subtle.decrypt = original
    }
  })

  it('reports encryption and decryption key-import failures consistently', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const original = globalThis.crypto.subtle.importKey
    globalThis.crypto.subtle.importKey = (() =>
      Promise.reject(new DOMException('AES-GCM is unavailable', 'NotSupportedError'))) as SubtleCrypto['importKey']

    try {
      await assert.rejects(encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) }), CryptoOperationError)
      await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), CryptoOperationError)
    } finally {
      globalThis.crypto.subtle.importKey = original
    }
  })

  it('ignores unknown non-critical content parameters in the unprotected header', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const decoded = decodeEnvelope(encoded)
    assert.deepStrictEqual(encoded.subarray(decoded.envelopeLength - 2, decoded.envelopeLength), hexToBytes('a0f6'))

    const withUnprotectedParameter = concatBytes(
      encoded.subarray(0, decoded.envelopeLength - 2),
      hexToBytes('a1186401f6'),
      encoded.subarray(decoded.envelopeLength)
    )
    const changedDecoded = decodeEnvelope(withUnprotectedParameter)
    assert.strictEqual(changedDecoded.unprotectedHeader.get(100), 1)

    assert.deepStrictEqual(await decrypt(withUnprotectedParameter, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('rejects detached ciphertext shorter than one authentication tag', async () => {
    const prepared = prepareEnvelope({ protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 } })

    for (const length of [0, TAG_SIZE - 1]) {
      const encoded = concatBytes(prepared.bytes, new Uint8Array(length))
      await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), InvalidCiphertextLengthError)
    }
  })

  it('rejects detached ciphertext above the 64 MiB plaintext plus tag limit', async () => {
    const prepared = prepareEnvelope({ protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 } })
    const encoded = new Uint8Array(prepared.bytes.length + MAX_AES_GCM_PLAINTEXT_SIZE + TAG_SIZE + 1)
    encoded.set(prepared.bytes)

    await assert.rejects(decrypt(encoded, new Uint8Array(FIXED_CEK)), InvalidCiphertextLengthError)
  })

  it('rejects a SharedArrayBuffer-backed encoded envelope', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const shared = new Uint8Array(new SharedArrayBuffer(encoded.length))
    shared.set(encoded)

    await assert.rejects(decrypt(shared, new Uint8Array(FIXED_CEK)), MalformedEnvelopeError)
  })

  it('rejects a SharedArrayBuffer-backed CEK', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
    )
    const cek = new Uint8Array(new SharedArrayBuffer(KEY_SIZE))
    cek.set(FIXED_CEK)

    await assert.rejects(decrypt(encoded, cek), InvalidKeyError)
  })
})
