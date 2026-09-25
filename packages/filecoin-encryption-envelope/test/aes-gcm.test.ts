import assert from 'node:assert'
import { type EncryptOptions, encrypt } from '../src/aes-gcm.ts'
import { ALG_AES_256_GCM, KEY_SIZE, MAX_AES_GCM_PLAINTEXT_SIZE, NONCE_SIZE, TAG_SIZE } from '../src/constants.ts'
import { TAG_ENCRYPT0 } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import {
  EncryptionError,
  InvalidKeyError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
} from '../src/errors.ts'
import { FIXTURE_IV_12, hexToBytes, MINIMAL_ENVELOPE_TAG16_HEX, toNullProto } from './cose-fixtures.ts'

const FIXED_CEK = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index)
const HELLO = new TextEncoder().encode('hello')

// Key 000102...1f, IV 000102...0b, plaintext "hello", and the minimal
// tag-16 Enc_structure. The envelope prefix is the existing hand-derived
// COSE fixture; the final 21 bytes are 5 bytes of ciphertext plus the
// 16-byte GCM tag.
const HELLO_VECTOR_HEX = `${MINIMAL_ENVELOPE_TAG16_HEX}2f67ba77aa3e5b52d043203a731722e538ba0f0538`

async function withRandomValues<T>(implementation: Crypto['getRandomValues'], action: () => Promise<T>): Promise<T> {
  const original = globalThis.crypto.getRandomValues
  globalThis.crypto.getRandomValues = implementation
  try {
    return await action()
  } finally {
    globalThis.crypto.getRandomValues = original
  }
}

const fixedRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
  assert.strictEqual(array.length, NONCE_SIZE)
  array.set(FIXTURE_IV_12)
  return array
}) as Crypto['getRandomValues']

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

  it('snapshots caller-owned plaintext, CEK, and metadata before its first await', async () => {
    const plaintext = new Uint8Array(HELLO)
    const cek = new Uint8Array(FIXED_CEK)
    const appMetadata: NonNullable<EncryptOptions['appMetadata']> = { state: 'before' }

    const encoded = await withRandomValues(fixedRandomValues, async () => {
      const pending = encrypt(plaintext, { cek, appMetadata })
      plaintext.fill(0xff)
      cek.fill(0xff)
      appMetadata.state = 'after'
      return await pending
    })
    const decoded = decodeEnvelope(encoded)

    assert.deepStrictEqual(decoded.protectedHeader.appMetadata, toNullProto({ state: 'before' }))
    assert.deepStrictEqual(await decryptWithWebCrypto(encoded, FIXED_CEK), HELLO)
  })

  it('rejects plaintext that is not a Uint8Array', async () => {
    await assert.rejects(
      encrypt('hello' as unknown as Uint8Array, { cek: new Uint8Array(FIXED_CEK) }),
      InvalidPlaintextError
    )
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

  it('rejects recipients instead of silently producing an envelope without them', async () => {
    const options = {
      cek: new Uint8Array(FIXED_CEK),
      recipients: [{ key: 'recipient' }],
    }

    await assert.rejects(encrypt(new Uint8Array(HELLO), options), MalformedEnvelopeError)
  })

  it('accepts plaintext at the 64 MiB scheme-1 limit', async function () {
    this.timeout(10_000)

    const plaintext = new Uint8Array(MAX_AES_GCM_PLAINTEXT_SIZE)
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(plaintext, { cek: new Uint8Array(FIXED_CEK) })
    )
    const decoded = decodeEnvelope(encoded)

    assert.strictEqual(encoded.length - decoded.envelopeLength, MAX_AES_GCM_PLAINTEXT_SIZE + TAG_SIZE)
  })

  it('rejects plaintext above the 64 MiB scheme-1 limit before encryption', async () => {
    const oversized = new Uint8Array(MAX_AES_GCM_PLAINTEXT_SIZE + 1)
    await assert.rejects(encrypt(oversized, { cek: new Uint8Array(FIXED_CEK) }), InvalidPlaintextLengthError)
  })

  it('wraps failure to obtain random IV bytes as an EncryptionError', async () => {
    const failingRandomValues = (() => {
      throw new Error('random source unavailable')
    }) as Crypto['getRandomValues']

    await withRandomValues(failingRandomValues, async () => {
      await assert.rejects(encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) }), EncryptionError)
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
