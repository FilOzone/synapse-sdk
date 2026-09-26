import assert from 'node:assert'
import { encrypt } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from '../src/constants.ts'
import { ALG_A256KW, HEADER_ALG, TAG_ENCRYPT, TAG_ENCRYPT0 } from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { InvalidKeyError, InvalidPlaintextLengthError, MalformedEnvelopeError } from '../src/errors.ts'
import { deriveChunkNonce } from '../src/nonce.ts'
import { createA256KWUnwrapper } from '../src/recipients/index.ts'
import { toRecipientInfo } from '../src/recipients/info.ts'
import type { A256KWRecipient } from '../src/recipients/types.ts'
import { FIXED_CEK, fixedBaseNonceRandomValues, withRandomValues } from './aes-gcm-fixtures.ts'
import { decryptChunkedOutput, deterministicPlaintext, readAllChunks, readChunk } from './aes-gcm-stream-fixtures.ts'
import { concatBytes, hexToBytes } from './cose-fixtures.ts'

const CHUNK_SIZE = 4096

describe('aesGcmStream.encrypt with A256KW recipients', () => {
  const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x40 + index)
  const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
  const KID_A = Uint8Array.from([0xa1, 0xa2])
  const KID_B = Uint8Array.from([0xb1])

  function recipient(kek: Uint8Array, kid?: Uint8Array): A256KWRecipient {
    return kid === undefined
      ? { alg: ALG_A256KW, kek: new Uint8Array(kek) }
      : { alg: ALG_A256KW, kek: new Uint8Array(kek), kid: new Uint8Array(kid) }
  }

  /** Encrypt via the stream, drive it to completion, and return the full encoded object. */
  async function encryptFull(
    plaintext: Uint8Array,
    recipients: readonly A256KWRecipient[],
    options?: { chunkSize?: number; contentLength?: number }
  ): Promise<Uint8Array> {
    const { writable, readable } = await withRandomValues(fixedBaseNonceRandomValues, async () =>
      encrypt({
        cek: new Uint8Array(FIXED_CEK),
        chunkSize: options?.chunkSize ?? CHUNK_SIZE,
        contentLength: options?.contentLength,
        recipients,
      })
    )
    const writer = writable.getWriter()
    const writeDone = writer.write(plaintext)
    const closeDone = writer.close()
    const chunks = await readAllChunks(readable)
    await writeDone
    await closeDone
    return concatBytes(...chunks)
  }

  /** Recover the CEK using this package's own built-in unwrapper -- not the raw AES-KW call. */
  async function recoverCek(
    decoded: ReturnType<typeof decodeEnvelope>,
    keys: { kek: Uint8Array; kid?: Uint8Array }[]
  ): Promise<Uint8Array> {
    const unwrapper = await createA256KWUnwrapper(keys)
    const cek = await unwrapper(decoded.recipients.map(toRecipientInfo))
    if (cek === undefined) {
      throw new Error('test helper: unwrapper could not recover the CEK')
    }
    return cek
  }

  /** Count Web Crypto import/wrap/encrypt calls made by `action`. */
  async function countCryptoCalls(
    action: () => Promise<unknown>
  ): Promise<{ importKey: number; wrapKey: number; encrypt: number }> {
    const subtle = globalThis.crypto.subtle
    const originalImportKey = subtle.importKey
    const originalWrapKey = subtle.wrapKey
    const originalEncrypt = subtle.encrypt
    const calls = { importKey: 0, wrapKey: 0, encrypt: 0 }
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      calls.importKey++
      return originalImportKey.apply(subtle, args)
    }) as SubtleCrypto['importKey']
    subtle.wrapKey = ((...args: Parameters<SubtleCrypto['wrapKey']>) => {
      calls.wrapKey++
      return originalWrapKey.apply(subtle, args)
    }) as SubtleCrypto['wrapKey']
    subtle.encrypt = ((...args: Parameters<SubtleCrypto['encrypt']>) => {
      calls.encrypt++
      return originalEncrypt.apply(subtle, args)
    }) as SubtleCrypto['encrypt']
    try {
      await action()
      return calls
    } finally {
      subtle.importKey = originalImportKey
      subtle.wrapKey = originalWrapKey
      subtle.encrypt = originalEncrypt
    }
  }

  it('round-trips with one recipient', async () => {
    const plaintext = deterministicPlaintext(CHUNK_SIZE + 50)
    const full = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
    const decoded = decodeEnvelope(full)
    const cek = await recoverCek(decoded, [{ kek: KEK_A, kid: KID_A }])
    assert.deepStrictEqual(await decryptChunkedOutput(full, cek), plaintext)
  })

  it('round-trips with two recipients, either KEK recovering the same plaintext', async () => {
    const plaintext = deterministicPlaintext(100)
    const full = await encryptFull(plaintext, [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    const decoded = decodeEnvelope(full)

    const cekViaA = await recoverCek(decoded, [{ kek: KEK_A, kid: KID_A }])
    assert.deepStrictEqual(await decryptChunkedOutput(full, cekViaA), plaintext)

    const cekViaB = await recoverCek(decoded, [{ kek: KEK_B, kid: KID_B }])
    assert.deepStrictEqual(await decryptChunkedOutput(full, cekViaB), plaintext)
  })

  it('writes tag 96 and preserves recipient order and kids, with and without a kid', async () => {
    const full = await encryptFull(deterministicPlaintext(10), [recipient(KEK_A, KID_A), recipient(KEK_B)])
    const decoded = decodeEnvelope(full)

    assert.strictEqual(decoded.tag, TAG_ENCRYPT)
    assert.strictEqual(decoded.recipients.length, 2)
    assert.deepStrictEqual(decoded.recipients[0].kid, KID_A)
    assert.strictEqual(decoded.recipients[1].kid, undefined)
    assert.strictEqual(decoded.recipients[0].unprotected.get(HEADER_ALG), ALG_A256KW)
  })

  it('keeps tag 16 when recipients is omitted', async () => {
    const full = await encryptFull(deterministicPlaintext(10), undefined as unknown as A256KWRecipient[])
    assert.strictEqual(decodeEnvelope(full).tag, TAG_ENCRYPT0)
  })

  it('authenticates each chunk under the Encrypt context, not Encrypt0', async () => {
    const plaintext = deterministicPlaintext(50)
    const full = await encryptFull(plaintext, [recipient(KEK_A, KID_A)])
    const decoded = decodeEnvelope(full)
    const cek = await recoverCek(decoded, [{ kek: KEK_A, kid: KID_A }])
    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['decrypt'])
    const chunk = full.subarray(decoded.envelopeLength) as Uint8Array<ArrayBuffer>
    const nonce = deriveChunkNonce(decoded.protectedHeader.iv, 0, true)

    const decryptWithContext = (tag: typeof TAG_ENCRYPT | typeof TAG_ENCRYPT0) =>
      globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: nonce,
          additionalData: encStructure(tag, decoded.protectedHeader.bytes),
          tagLength: 128,
        },
        key,
        chunk
      )

    await assert.rejects(decryptWithContext(TAG_ENCRYPT0))
    assert.deepStrictEqual(new Uint8Array(await decryptWithContext(TAG_ENCRYPT)), plaintext)
  })

  describe('independent vector', () => {
    // Generated once with node:crypto directly: id-aes256-wrap (RFC 3394
    // default IV A6A6A6A6A6A6A6A6) for the wrapped CEK -- AES-KW is
    // deterministic, no randomness involved -- and aes-256-gcm with a literal
    // nonce and the AAD from encStructure for the chunk. Envelope/record
    // shaping used this package's own (separately tested) cose layer.
    const KEK = Uint8Array.from({ length: KEY_SIZE }, (_, i) => 0x60 + i)
    const KID = Uint8Array.from([0xc1, 0xc2])
    const CONTENT_LENGTH = 100
    const ENVELOPE_HEX =
      'd860845846a5013a000101000547000102030405061078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f7365201910003a000100fc1864a0f6818340a201240442c1c2582834838f997ff0ecdfccc2e310951889177e1805c72f50c31a0fcca1d0a0ec69be1fb7a719c6e7bd41'
    const WRAPPED_CEK_HEX = '34838f997ff0ecdfccc2e310951889177e1805c72f50c31a0fcca1d0a0ec69be1fb7a719c6e7bd41'
    const TAG_HEX = '125fe0678427e419be44046ab3e8464b'

    it('matches the independent oracle for one recipient with contentLength set', async () => {
      const plaintext = deterministicPlaintext(CONTENT_LENGTH)
      const full = await encryptFull(plaintext, [recipient(KEK, KID)], { contentLength: CONTENT_LENGTH })

      assert.deepStrictEqual(full.subarray(0, hexToBytes(ENVELOPE_HEX).length), hexToBytes(ENVELOPE_HEX))

      const decoded = decodeEnvelope(full)
      assert.deepStrictEqual(decoded.recipients[0].ciphertext, hexToBytes(WRAPPED_CEK_HEX))

      const chunk = full.subarray(decoded.envelopeLength)
      assert.strictEqual(chunk.length, CONTENT_LENGTH + TAG_SIZE)
      assert.deepStrictEqual(chunk.subarray(chunk.length - TAG_SIZE), hexToBytes(TAG_HEX))
    })
  })

  it('rejects an empty or non-array recipients list before randomness or cryptography', async () => {
    for (const bad of [[], 'nope'] as unknown as A256KWRecipient[][]) {
      let randomCalls = 0
      const observeRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
        randomCalls++
        return fixedBaseNonceRandomValues(array)
      }) as Crypto['getRandomValues']

      const calls = await countCryptoCalls(async () => {
        await withRandomValues(observeRandomValues, async () => {
          assert.throws(() => encrypt({ cek: new Uint8Array(FIXED_CEK), recipients: bad }), MalformedEnvelopeError)
        })
      })
      assert.strictEqual(randomCalls, 0)
      assert.deepStrictEqual(calls, { importKey: 0, wrapKey: 0, encrypt: 0 })
    }
  })

  it('rejects an invalid last recipient before randomness or cryptography', async () => {
    let randomCalls = 0
    const observeRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
      randomCalls++
      return fixedBaseNonceRandomValues(array)
    }) as Crypto['getRandomValues']

    const calls = await countCryptoCalls(async () => {
      await withRandomValues(observeRandomValues, async () => {
        assert.throws(
          () =>
            encrypt({
              cek: new Uint8Array(FIXED_CEK),
              recipients: [recipient(KEK_A, KID_A), { alg: ALG_A256KW, kek: new Uint8Array(KEY_SIZE - 1) }],
            }),
          (error: unknown) => error instanceof InvalidKeyError && error.message.includes('recipients[1].kek')
        )
      })
    })
    assert.strictEqual(randomCalls, 0)
    assert.deepStrictEqual(calls, { importKey: 0, wrapKey: 0, encrypt: 0 })
  })

  it('imports the CEK once (extractable) and wraps once per recipient, only on the first read', async () => {
    const { writable, readable } = encrypt({
      cek: new Uint8Array(FIXED_CEK),
      chunkSize: CHUNK_SIZE,
      recipients: [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)],
    })

    const subtle = globalThis.crypto.subtle
    const originalImportKey = subtle.importKey
    const originalWrapKey = subtle.wrapKey
    const cekExtractableFlags: boolean[] = []
    let wrapKeyCalls = 0
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      const algorithm = args[2]
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (name === 'AES-GCM') {
        cekExtractableFlags.push(args[3])
      }
      return originalImportKey.apply(subtle, args)
    }) as SubtleCrypto['importKey']
    subtle.wrapKey = ((...args: Parameters<SubtleCrypto['wrapKey']>) => {
      wrapKeyCalls++
      return originalWrapKey.apply(subtle, args)
    }) as SubtleCrypto['wrapKey']

    try {
      assert.strictEqual(cekExtractableFlags.length, 0, 'no key import before the first read')
      assert.strictEqual(wrapKeyCalls, 0)

      const reader = readable.getReader()
      await reader.read() // envelope: imports and wraps
      assert.deepStrictEqual(cekExtractableFlags, [true])
      assert.strictEqual(wrapKeyCalls, 2)

      const writer = writable.getWriter()
      const writeDone = writer.write(deterministicPlaintext(10))
      const closeDone = writer.close()
      await reader.read() // final chunk
      await writeDone
      await closeDone

      assert.deepStrictEqual(cekExtractableFlags, [true])
      assert.strictEqual(wrapKeyCalls, 2)
    } finally {
      subtle.importKey = originalImportKey
      subtle.wrapKey = originalWrapKey
    }
  })

  it('rejects the first read when wrapping fails, emitting no envelope', async () => {
    const original = globalThis.crypto.subtle.wrapKey
    globalThis.crypto.subtle.wrapKey = (() =>
      Promise.reject(new DOMException('AES-KW is unavailable', 'NotSupportedError'))) as SubtleCrypto['wrapKey']

    try {
      const { readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), recipients: [recipient(KEK_A, KID_A)] })
      await assert.rejects(readable.getReader().read())
    } finally {
      globalThis.crypto.subtle.wrapKey = original
    }
  })

  it('rejects the first read when the writable is aborted before it, emitting no envelope', async () => {
    const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), recipients: [recipient(KEK_A, KID_A)] })
    const reason = new Error('abort before first read')
    await writable.getWriter().abort(reason)
    await assert.rejects(readable.getReader().read(), (err) => err === reason)
  })

  // One recipient: the abort lands during the last wrap, caught just before
  // the envelope. Two: it's caught before the second wrap starts.
  for (const count of [1, 2]) {
    it(`stops wrapping and emits no envelope when input fails mid-wrap (${count} recipient(s))`, async () => {
      const original = globalThis.crypto.subtle.wrapKey
      let wrapCalls = 0
      let signalEntered: (() => void) | undefined
      const entered = new Promise<void>((resolve) => {
        signalEntered = resolve
      })
      let release: (() => void) | undefined
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      globalThis.crypto.subtle.wrapKey = (async (...args: Parameters<SubtleCrypto['wrapKey']>) => {
        wrapCalls++
        signalEntered?.()
        await released
        return original.apply(globalThis.crypto.subtle, args)
      }) as SubtleCrypto['wrapKey']

      try {
        const { writable, readable } = encrypt({
          cek: new Uint8Array(FIXED_CEK),
          recipients: [recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)].slice(0, count),
        })
        const firstRead = readable.getReader().read()
        await entered // the first recipient's wrap is running

        const reason = new Error('aborted while wrapping')
        const abortDone = writable.getWriter().abort(reason)
        release?.()

        await assert.rejects(firstRead, (err) => err === reason)
        await abortDone
        assert.strictEqual(wrapCalls, 1, 'no recipient is wrapped after the abort')
      } finally {
        globalThis.crypto.subtle.wrapKey = original
      }
    })
  }

  it('starts no key operation when input already failed before the first read', async () => {
    const original = globalThis.crypto.subtle.importKey
    let importCalls = 0
    globalThis.crypto.subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      importCalls++
      return original.apply(globalThis.crypto.subtle, args)
    }) as SubtleCrypto['importKey']

    try {
      const { writable, readable } = encrypt({ cek: new Uint8Array(FIXED_CEK), recipients: [recipient(KEK_A, KID_A)] })
      const reason = new Error('abort before first read')
      await writable.getWriter().abort(reason)
      await assert.rejects(readable.getReader().read(), (err) => err === reason)
      assert.strictEqual(importCalls, 0)
    } finally {
      globalThis.crypto.subtle.importKey = original
    }
  })

  it('preflights envelope + ciphertext against MAX_ENCODED_OBJECT_SIZE with one recipient', async () => {
    // Hand-calculated at chunk size 4096 (stride 4112), one kid-less A256KW
    // recipient:
    //   envelope   132 bytes: protected header (plaintext_length grown to
    //              the 8-byte uint64 form) plus one kid-less recipient
    //              record (h'' · {1: -5} · 40-byte wrapped CEK)
    //   budget     2^36 - 132 = 68,719,476,604 = 16,711,934 × 4112 + 3996
    //   P          16,711,934 × 4096 + (3996 - 16) = 68,452,085,644
    // so envelope + C lands exactly on 2^36, and P + 1 is one byte over.
    const atLimit = 68_452_085_644
    const kidLess = [recipient(KEK_A)]

    const atLimitPair = encrypt({
      cek: new Uint8Array(FIXED_CEK),
      chunkSize: MIN_CHUNK_SIZE,
      contentLength: atLimit,
      recipients: kidLess,
    })
    const envelope = await readChunk(atLimitPair.readable.getReader())
    assert.strictEqual(envelope.length, 132, 'fixture assumes a 132-byte envelope')

    let overPair: ReturnType<typeof encrypt> | undefined
    assert.doesNotThrow(() => {
      overPair = encrypt({
        cek: new Uint8Array(FIXED_CEK),
        chunkSize: MIN_CHUNK_SIZE,
        contentLength: atLimit + 1,
        recipients: kidLess,
      })
    })
    if (overPair === undefined) {
      throw new Error('test helper: encrypt() should have returned a pair')
    }
    await assert.rejects(overPair.readable.getReader().read(), InvalidPlaintextLengthError)
  })
})
