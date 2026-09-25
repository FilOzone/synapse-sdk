import assert from 'node:assert'
import { decryptWith, encrypt } from '../src/aes-gcm.ts'
import { ALG_AES_256_GCM, ALG_CHUNKED_AES_256_GCM_STREAM, KEY_SIZE, TAG_SIZE } from '../src/constants.ts'
import { ALG_A256KW, HEADER_ALG } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { assemblePreparedEnvelope, encodeEnvelope, prepareEnvelope, type RecipientInput } from '../src/cose/encode.ts'
import { encodeProtectedHeader } from '../src/cose/headers.ts'
import {
  AuthenticationError,
  InvalidKeyError,
  MalformedEnvelopeError,
  NoUsableRecipientError,
  RecipientAttemptLimitError,
  RecipientUnwrapError,
  UnsupportedSchemeError,
} from '../src/errors.ts'
import { aesKwWrap, importAesGcmKey, importAesKwKey } from '../src/internal/web-crypto.ts'
import { createA256KWUnwrapper } from '../src/recipients/a256kw.ts'
import type { A256KWRecipient, RecipientInfo, Unwrapper } from '../src/recipients/types.ts'
import { FIXED_CEK, fixedRandomValues, HELLO, withRandomValues } from './aes-gcm-fixtures.ts'
import { concatBytes, FIXTURE_BASE_NONCE_7, FIXTURE_IV_12 } from './cose-fixtures.ts'

const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x40 + index)
const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
const KID_A = Uint8Array.from([0xa1, 0xa2])
const KID_B = Uint8Array.from([0xb1])

function recipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
  return kid === undefined
    ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
    : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
}

function encryptFor(recipients: readonly A256KWRecipient[], plaintext: Uint8Array = HELLO) {
  return withRandomValues(fixedRandomValues, () =>
    encrypt(new Uint8Array(plaintext), { cek: new Uint8Array(FIXED_CEK), recipients })
  )
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

/** Build a tag-96 envelope through the checked encoder, so malformed recipients are rejected up front. */
async function encryptTag96WithWebCrypto(plaintext: Uint8Array, cek: Uint8Array, recipients: RecipientInput[]) {
  const prepared = prepareEnvelope({ protectedHeader: { alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 }, recipients })
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['encrypt'])
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: FIXTURE_IV_12, additionalData: encStructure(96, prepared.protectedBytes), tagLength: 128 },
    key,
    new Uint8Array(plaintext)
  )
  return concatBytes(prepared.bytes, new Uint8Array(ciphertext))
}

/** Build a tag-96 envelope bypassing recipient validation, for a deliberately malformed recipient. */
async function buildTag96EnvelopeUnchecked(plaintext: Uint8Array, cek: Uint8Array, recipients: RecipientInput[]) {
  const protectedBytes = encodeProtectedHeader({ alg: ALG_AES_256_GCM, iv: FIXTURE_IV_12 })
  const prepared = assemblePreparedEnvelope(protectedBytes, recipients)
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['encrypt'])
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: FIXTURE_IV_12, additionalData: encStructure(96, prepared.protectedBytes), tagLength: 128 },
    key,
    new Uint8Array(plaintext)
  )
  return concatBytes(prepared.bytes, new Uint8Array(ciphertext))
}

/** A never-settling assertion helper: fails the test if `fn` is ever invoked. */
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

describe('aesGcm.decryptWith', () => {
  describe('round trip', () => {
    it('recovers the plaintext for one A256KW recipient with a kid', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      assert.deepStrictEqual(await decryptWith(encoded, unwrapper), HELLO)
    })

    it('recovers the plaintext for one A256KW recipient without a kid', async () => {
      const encoded = await encryptFor([recipient(KEK_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])
      assert.deepStrictEqual(await decryptWith(encoded, unwrapper), HELLO)
    })

    it('recovers the CEK when the usable recipient is not first', async () => {
      const encoded = await encryptFor([recipient(KEK_B, KID_B), recipient(KEK_A, KID_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      assert.deepStrictEqual(await decryptWith(encoded, unwrapper), HELLO)
    })

    it('reuses the same unwrapper across multiple decryptWith calls', async () => {
      const other = new TextEncoder().encode('world')
      const encodedHello = await encryptFor([recipient(KEK_A, KID_A)], HELLO)
      const encodedOther = await encryptFor([recipient(KEK_A, KID_A)], other)
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])

      assert.deepStrictEqual(await decryptWith(encodedHello, unwrapper), HELLO)
      assert.deepStrictEqual(await decryptWith(encodedOther, unwrapper), other)
    })

    it('does not let a preceding unsupported-algorithm recipient block decryption', async () => {
      const cekKey = await importAesGcmKey(new Uint8Array(FIXED_CEK), 'encrypt', true)
      const kekKey = await importAesKwKey(new Uint8Array(KEK_A), 'wrapKey')
      const wrappedCek = await aesKwWrap(cekKey, kekKey)
      const unsupportedRecipient: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map([[HEADER_ALG, -999]]),
        ciphertext: new Uint8Array(40),
      }
      const a256kwRecipient: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map([[HEADER_ALG, ALG_A256KW]]),
        ciphertext: wrappedCek,
      }
      const encoded = await encryptTag96WithWebCrypto(HELLO, FIXED_CEK, [unsupportedRecipient, a256kwRecipient])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])

      assert.deepStrictEqual(await decryptWith(encoded, unwrapper), HELLO)
    })
  })

  describe('no usable recipient', () => {
    it('rejects a tag-16 envelope with NoUsableRecipientError, without calling the unwrapper', async () => {
      const encoded = await withRandomValues(fixedRandomValues, () =>
        encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) })
      )
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptWith(encoded, unwrapper), NoUsableRecipientError)
      assertNeverCalled()
    })

    it('reports a custom unwrapper returning undefined as NoUsableRecipientError', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const unwrapper: Unwrapper = async () => undefined

      await assert.rejects(decryptWith(encoded, unwrapper), NoUsableRecipientError)
    })
  })

  describe('unsupported scheme', () => {
    it('rejects the chunked scheme without calling the unwrapper', async () => {
      const envelope = encodeEnvelope({
        protectedHeader: { alg: ALG_CHUNKED_AES_256_GCM_STREAM, iv: FIXTURE_BASE_NONCE_7, chunkSize: 4096 },
      })
      const encoded = concatBytes(envelope, new Uint8Array(TAG_SIZE))
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptWith(encoded, unwrapper), UnsupportedSchemeError)
      assertNeverCalled()
    })
  })

  describe('malformed input', () => {
    it('rejects a non-function unwrapper', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      await assert.rejects(decryptWith(encoded, 'nope' as unknown as Unwrapper), MalformedEnvelopeError)
    })

    it('rejects a SharedArrayBuffer-backed encoded envelope, without calling the unwrapper', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const shared = new Uint8Array(new SharedArrayBuffer(encoded.length))
      shared.set(encoded)
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptWith(shared, unwrapper), MalformedEnvelopeError)
      assertNeverCalled()
    })

    it('rejects an A256KW recipient with a wrong ciphertext length, without calling the unwrapper', async () => {
      const badRecipient: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map([[HEADER_ALG, ALG_A256KW]]),
        ciphertext: new Uint8Array(39),
      }
      const encoded = await buildTag96EnvelopeUnchecked(HELLO, FIXED_CEK, [badRecipient])
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptWith(encoded, unwrapper), MalformedEnvelopeError)
      assertNeverCalled()
    })
  })

  describe('unwrapper failure', () => {
    it('wraps a synchronously thrown value as RecipientUnwrapError with the exact cause', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const boom = { reason: 'boom' }
      const unwrapper: Unwrapper = () => {
        throw boom
      }

      await assert.rejects(
        decryptWith(encoded, unwrapper),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
      )
    })

    it('wraps a rejected unwrapper promise as RecipientUnwrapError with the exact cause', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const boom = new Error('boom')
      const unwrapper: Unwrapper = async () => {
        throw boom
      }

      await assert.rejects(
        decryptWith(encoded, unwrapper),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
      )
    })

    it('surfaces the built-in helper attempt cap as RecipientUnwrapError with a RecipientAttemptLimitError cause', async () => {
      // Both recipients are wrapped under KEK_A; the unwrapper only holds the
      // wrong KEK_B, so every attempt fails integrity before the cap is hit.
      const encoded = await encryptFor([recipient(KEK_A, KID_A), recipient(KEK_A, KID_B)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_B }], { maxAttempts: 1 })

      await assert.rejects(
        decryptWith(encoded, unwrapper),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause instanceof RecipientAttemptLimitError
      )
    })
  })

  describe('recovered CEK validation', () => {
    const invalidCeks: Array<[string, unknown]> = [
      ['not a Uint8Array', 'nope'],
      ['31 bytes', new Uint8Array(KEY_SIZE - 1)],
      ['all-zero', new Uint8Array(KEY_SIZE)],
      ['SharedArrayBuffer-backed', new Uint8Array(new SharedArrayBuffer(KEY_SIZE))],
    ]

    for (const [label, badCek] of invalidCeks) {
      it(`rejects a recovered CEK that is ${label}`, async () => {
        const encoded = await encryptFor([recipient(KEK_A, KID_A)])
        const unwrapper: Unwrapper = async () => badCek as Uint8Array

        await assert.rejects(decryptWith(encoded, unwrapper), InvalidKeyError)
      })
    }

    it('names the recovered CEK in the all-zero message', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const unwrapper: Unwrapper = async () => new Uint8Array(KEY_SIZE)

      await assert.rejects(
        decryptWith(encoded, unwrapper),
        (error: unknown) =>
          error instanceof InvalidKeyError && error.message.startsWith('Invalid recovered CEK: an all-zero')
      )
    })

    it('reports a wrong recovered CEK as AuthenticationError, calling the unwrapper exactly once', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const wrongCek = Uint8Array.from(FIXED_CEK, (byte) => byte ^ 0xff)
      let calls = 0
      const unwrapper: Unwrapper = async () => {
        calls++
        return wrongCek
      }

      await assert.rejects(decryptWith(encoded, unwrapper), AuthenticationError)
      assert.strictEqual(calls, 1)
    })
  })

  describe('authentication', () => {
    it('reports modified ciphertext as AuthenticationError', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const decoded = decodeEnvelope(encoded)
      const changed = new Uint8Array(encoded)
      changed[decoded.envelopeLength] ^= 0x01
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])

      await assert.rejects(decryptWith(changed, unwrapper), AuthenticationError)
    })

    it('reports a modified protected header as AuthenticationError', async () => {
      const encoded = await encryptFor([recipient(KEK_A, KID_A)])
      const decoded = decodeEnvelope(encoded)
      // Flip a byte inside the raw IV field specifically: unlike `typ` or
      // `alg`, it carries no expected value decode would reject, so this
      // changes the authenticated bytes without breaking decode itself.
      const headerOffset = findBytes(encoded.subarray(0, decoded.envelopeLength), decoded.protectedHeader.bytes)
      const ivOffset = findBytes(decoded.protectedHeader.bytes, decoded.protectedHeader.iv)
      assert.notStrictEqual(headerOffset, -1)
      assert.notStrictEqual(ivOffset, -1)
      const changed = new Uint8Array(encoded)
      changed[headerOffset + ivOffset] ^= 0x01
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])

      await assert.rejects(decryptWith(changed, unwrapper), AuthenticationError)
    })
  })

  it('gives the unwrapper isolated recipient copies in wire order; mutating them leaves encoded untouched', async () => {
    const encoded = await encryptFor([recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    const encodedCopy = new Uint8Array(encoded)
    let seen: readonly RecipientInfo[] = []
    const unwrapper: Unwrapper = async (recipients) => {
      seen = recipients
      for (const info of recipients) {
        info.wrappedKey.fill(0)
      }
      return undefined
    }

    await assert.rejects(decryptWith(encoded, unwrapper), NoUsableRecipientError)
    assert.strictEqual(seen.length, 2)
    assert.strictEqual(seen[0].index, 0)
    assert.strictEqual(seen[1].index, 1)
    assert.deepStrictEqual(encoded, encodedCopy)
  })
})
