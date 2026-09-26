import assert from 'node:assert'
import { decryptWith, encrypt } from '../src/aes-gcm-stream.ts'
import { ALG_CHUNKED_AES_256_GCM_STREAM, KEY_SIZE } from '../src/constants.ts'
import { ALG_A256KW, HEADER_ALG } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { assemblePreparedEnvelope, type RecipientInput } from '../src/cose/encode.ts'
import { encodeProtectedHeader } from '../src/cose/headers.ts'
import {
  AuthenticationError,
  InvalidKeyError,
  MalformedEnvelopeError,
  NoUsableRecipientError,
  RecipientUnwrapError,
} from '../src/errors.ts'
import { deriveChunkNonce } from '../src/nonce.ts'
import { createA256KWUnwrapper } from '../src/recipients/index.ts'
import { toRecipientInfo } from '../src/recipients/info.ts'
import type { A256KWRecipient, RecipientInfo, Unwrapper } from '../src/recipients/types.ts'
import { FIXED_CEK, fixedBaseNonceRandomValues, withRandomValues } from './aes-gcm-fixtures.ts'
import { deterministicPlaintext, readAllChunks } from './aes-gcm-stream-fixtures.ts'
import { concatBytes, FIXTURE_BASE_NONCE_7 } from './cose-fixtures.ts'

const CHUNK_SIZE = 4096

const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x40 + index)
const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
const KID_A = Uint8Array.from([0xa1, 0xa2])
const KID_B = Uint8Array.from([0xb1])

function recipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
  return kid === undefined
    ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
    : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
}

/** Encrypt via the production writer, optionally with recipients, and drive it to completion. */
async function encryptFull(plaintext: Uint8Array, recipients?: readonly A256KWRecipient[]): Promise<Uint8Array> {
  const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
    encrypt({ cek: new Uint8Array(FIXED_CEK), chunkSize: CHUNK_SIZE, recipients })
  )
  const writer = writable.getWriter()
  const writeDone = writer.write(plaintext)
  const closeDone = writer.close()
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return concatBytes(...chunks)
}

/** Drive decryptWith() to completion (or rejection) with `encoded` delivered in one write. */
async function decryptWithChunks(encoded: Uint8Array, unwrapper: Unwrapper): Promise<Uint8Array<ArrayBuffer>[]> {
  const { writable, readable } = decryptWith(unwrapper)
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

async function decryptWithBytes(encoded: Uint8Array, unwrapper: Unwrapper): Promise<Uint8Array> {
  return concatBytes(...(await decryptWithChunks(encoded, unwrapper)))
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

/**
 * Build a chunked (tag-96) object with a single small chunk and an arbitrary
 * recipient list, bypassing `encrypt()`'s recipient-shape validation --
 * mirrors `encryptTag96WithWebCrypto` in test/aes-gcm-decrypt-with.test.ts,
 * adapted to the chunked scheme's per-chunk AEAD framing.
 */
async function buildSingleChunkTag96Object(
  plaintext: Uint8Array,
  cek: Uint8Array,
  recipients: RecipientInput[]
): Promise<Uint8Array> {
  const protectedBytes = encodeProtectedHeader({
    alg: ALG_CHUNKED_AES_256_GCM_STREAM,
    iv: FIXTURE_BASE_NONCE_7,
    chunkSize: CHUNK_SIZE,
  })
  const prepared = assemblePreparedEnvelope(protectedBytes, recipients)
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['encrypt'])
  const aad = encStructure(prepared.tag, prepared.protectedBytes)
  const nonce = deriveChunkNonce(FIXTURE_BASE_NONCE_7, 0, true)
  const ciphertext = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
    key,
    new Uint8Array(plaintext)
  )
  return concatBytes(prepared.bytes, new Uint8Array(ciphertext))
}

describe('aesGcmStream.decryptWith', () => {
  describe('round trip', () => {
    it('recovers the plaintext for one recipient with a kid', async () => {
      const plaintext = deterministicPlaintext(200)
      const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      assert.deepStrictEqual(await decryptWithBytes(encoded, unwrapper), plaintext)
    })

    it('recovers the plaintext for two recipients, either KEK working', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE + 50)
      const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])

      const unwrapperA = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      assert.deepStrictEqual(await decryptWithBytes(encoded, unwrapperA), plaintext)

      const unwrapperB = await createA256KWUnwrapper([{ kek: KEK_B, kid: KID_B }])
      assert.deepStrictEqual(await decryptWithBytes(encoded, unwrapperB), plaintext)
    })

    it('round-trips a multi-chunk object', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3 + 77)
      const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      assert.deepStrictEqual(await decryptWithBytes(encoded, unwrapper), plaintext)
    })

    it('round-trips when fed one byte at a time', async () => {
      const plaintext = deterministicPlaintext(500)
      const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      const { writable, readable } = decryptWith(unwrapper)
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

    it('decrypts via a custom unwrapper handling a non-A256KW recipient', async () => {
      // decryptWith must not filter recipients by algorithm itself.
      const plaintext = deterministicPlaintext(20)
      const unknownRecipient: RecipientInput = {
        protectedBytes: new Uint8Array(0),
        unprotected: new Map([[HEADER_ALG, -999]]),
        ciphertext: new Uint8Array(40),
      }
      const encoded = await buildSingleChunkTag96Object(plaintext, FIXED_CEK, [unknownRecipient])
      const unwrapper: Unwrapper = async (recipients) => {
        assert.strictEqual(recipients.length, 1)
        assert.strictEqual(recipients[0].alg, -999)
        assert.strictEqual(recipients[0].index, 0)
        return new Uint8Array(FIXED_CEK)
      }
      assert.deepStrictEqual(await decryptWithBytes(encoded, unwrapper), plaintext)
    })
  })

  it('gives the unwrapper every recipient once, in wire order, matching toRecipientInfo exactly', async () => {
    const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    const expected = decodeEnvelope(encoded).recipients.map(toRecipientInfo)
    let calls = 0
    const unwrapper: Unwrapper = async (recipients) => {
      calls++
      assert.deepStrictEqual(recipients, expected)
      return undefined
    }

    await assert.rejects(decryptWithBytes(encoded, unwrapper), NoUsableRecipientError)
    assert.strictEqual(calls, 1)
  })

  it('gives the unwrapper isolated recipient copies; mutating them affects neither encoded nor a later read of it', async () => {
    const plaintext = deterministicPlaintext(20)
    const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    const encodedCopy = new Uint8Array(encoded)
    let seen: readonly RecipientInfo[] = []
    const mutatingUnwrapper: Unwrapper = async (recipients) => {
      seen = recipients
      for (const info of recipients) {
        info.wrappedKey.fill(0)
      }
      return undefined
    }

    await assert.rejects(decryptWithBytes(encoded, mutatingUnwrapper), NoUsableRecipientError)
    assert.strictEqual(seen.length, 2)
    assert.strictEqual(seen[0].index, 0)
    assert.strictEqual(seen[1].index, 1)
    assert.deepStrictEqual(encoded, encodedCopy)

    // A later, independent read of the same bytes still works.
    const freshUnwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
    assert.deepStrictEqual(await decryptWithBytes(encoded, freshUnwrapper), plaintext)
  })

  describe('no usable recipient', () => {
    it('rejects a tag-16 envelope with NoUsableRecipientError, without calling the unwrapper', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20))
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()

      await assert.rejects(decryptWithBytes(encoded, unwrapper), NoUsableRecipientError)
      assertNeverCalled()
    })

    it('reports a custom unwrapper returning undefined as NoUsableRecipientError', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const unwrapper: Unwrapper = async () => undefined

      await assert.rejects(decryptWithBytes(encoded, unwrapper), NoUsableRecipientError)
    })
  })

  describe('unwrapper failure', () => {
    it('wraps a synchronously thrown value as RecipientUnwrapError with the exact cause', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const boom = { reason: 'boom' }
      const unwrapper: Unwrapper = () => {
        throw boom
      }

      await assert.rejects(
        decryptWithBytes(encoded, unwrapper),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
      )
    })

    it('wraps a rejected unwrapper promise as RecipientUnwrapError with the exact cause', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const boom = new Error('boom')
      const unwrapper: Unwrapper = async () => {
        throw boom
      }

      await assert.rejects(
        decryptWithBytes(encoded, unwrapper),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
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
        const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
        const unwrapper: Unwrapper = async () => badCek as Uint8Array

        await assert.rejects(decryptWithBytes(encoded, unwrapper), InvalidKeyError)
      })
    }

    it('reports a wrong recovered CEK as AuthenticationError, calling the unwrapper exactly once', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const wrongCek = Uint8Array.from(FIXED_CEK, (byte) => byte ^ 0xff)
      let calls = 0
      const unwrapper: Unwrapper = async () => {
        calls++
        return wrongCek
      }

      await assert.rejects(decryptWithBytes(encoded, unwrapper), AuthenticationError)
      assert.strictEqual(calls, 1)
    })
  })

  describe('malformed input', () => {
    it('rejects a non-function unwrapper synchronously', () => {
      assert.throws(() => decryptWith('nope' as unknown as Unwrapper), MalformedEnvelopeError)
    })
  })

  describe('cancel and abort', () => {
    it('does not call the unwrapper when input fails before the first read', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const decodedEnvelope = decodeEnvelope(encoded)
      const { unwrapper, assertNeverCalled } = neverCalledUnwrapper()
      const { writable, readable } = decryptWith(unwrapper)
      const writer = writable.getWriter()
      await writer.write(encoded.subarray(0, decodedEnvelope.envelopeLength)) // envelope only, framer created

      const reason = new Error('abort after envelope, before any read')
      await writer.abort(reason)
      await assert.rejects(readable.getReader().read(), (err) => err === reason)
      assertNeverCalled()
    })

    it('rejects a pending read with the abort reason, and enqueues nothing, when aborted while the unwrapper is pending', async () => {
      const encoded = await encryptFull(deterministicPlaintext(20), [recipient(KEK_A, KID_A)])
      const decodedEnvelope = decodeEnvelope(encoded)
      let releaseUnwrapper: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        releaseUnwrapper = resolve
      })
      let resolveCalled: (() => void) | undefined
      const called = new Promise<void>((resolve) => {
        resolveCalled = resolve
      })
      let calls = 0
      const unwrapper: Unwrapper = async (recipients) => {
        calls++
        resolveCalled?.()
        await gate
        const real = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
        return real(recipients)
      }
      const { writable, readable } = decryptWith(unwrapper)
      const writer = writable.getWriter()
      await writer.write(encoded.subarray(0, decodedEnvelope.envelopeLength)) // envelope only

      const reader = readable.getReader()
      const pending = reader.read() // triggers the handoff, then the gated unwrapper call
      await called // wait until the unwrapper has actually started and is blocked on `gate`

      const reason = new Error('abort while unwrapper pending')
      const abortDone = writer.abort(reason) // signal fires synchronously, before this settles
      abortDone.catch(() => {
        // Asserted below via `pending`; avoid an unhandled rejection.
      })
      releaseUnwrapper?.() // let the (now-pointless) unwrapper call finish after the abort

      await assert.rejects(pending, (err) => err === reason)
      assert.strictEqual(calls, 1)
    })

    it('rejects a pending write and errors the writable when the unwrapper fails mid-stream', async () => {
      const plaintext = deterministicPlaintext(CHUNK_SIZE * 3)
      const encoded = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
      const boom = new Error('unwrapper boom')
      const unwrapper: Unwrapper = async () => {
        throw boom
      }
      const { writable, readable } = decryptWith(unwrapper)
      const writer = writable.getWriter()
      const writeDone = writer.write(encoded) // envelope + big ciphertext: stays pending
      writeDone.catch(() => {
        // Asserted below; avoid an unhandled rejection.
      })

      const reader = readable.getReader()
      await assert.rejects(
        reader.read(),
        (error: unknown) => error instanceof RecipientUnwrapError && error.cause === boom
      )

      await assert.rejects(writeDone)
      await assert.rejects(writer.write(Uint8Array.from([1, 2, 3, 4])))
    })
  })
})
