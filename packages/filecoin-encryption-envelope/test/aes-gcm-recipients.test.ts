import assert from 'node:assert'
import { decrypt, encrypt } from '../src/aes-gcm.ts'
import { KEY_SIZE } from '../src/constants.ts'
import {
  ALG_A256KW,
  ALG_ECDH_ES_A256KW,
  HEADER_ALG,
  HEADER_KID,
  MAX_ENVELOPE_SIZE,
  TAG_ENCRYPT,
  TAG_ENCRYPT0,
} from '../src/cose/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { InvalidKeyError, MalformedEnvelopeError } from '../src/errors.ts'
import { unwrapCek, WRAPPED_CEK_SIZE } from '../src/recipients/a256kw.ts'
import type { A256KWRecipient } from '../src/recipients/types.ts'
import { FIXED_CEK, fixedRandomValues, HELLO, HELLO_VECTOR_HEX, withRandomValues } from './aes-gcm-fixtures.ts'
import { hexToBytes, MINIMAL_PROTECTED_HEADER_HEX } from './cose-fixtures.ts'

describe('aesGcm.encrypt with A256KW recipients', () => {
  const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x40 + index)
  const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
  const KID_A = Uint8Array.from([0xa1, 0xa2])
  const KID_B = Uint8Array.from([0xb1])

  // FIXED_CEK wrapped under KEK_A (RFC 3394) and the "hello" ciphertext under
  // the Encrypt context, both computed with OpenSSL rather than this package.
  // Hand-encoded after the protected header: {} · null · array(1) ·
  // [h'', {1: -5, 4: h'a1a2'}, bstr(40)] · 5 ciphertext bytes · 16-byte tag.
  const WRAPPED_UNDER_KEK_A = '9ba74ec0a3394a43baa95548a2d07bd4ac4f6ead62c4dd166837dcc58680468653db29b899a7668d'
  const TAG96_HELLO_VECTOR_HEX =
    `d86084583c${MINIMAL_PROTECTED_HEADER_HEX}a0f6818340a201240442a1a25828${WRAPPED_UNDER_KEK_A}` +
    '2f67ba77aac8eb27d5b3f96ae7c50d40f2cdc7c20a'

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

  /** Count Web Crypto key-wrap and content-encryption calls made by `action`. */
  async function countCryptoCalls(action: () => Promise<unknown>): Promise<{ wrapKey: number; encrypt: number }> {
    const subtle = globalThis.crypto.subtle
    const originalWrap = subtle.wrapKey
    const originalEncrypt = subtle.encrypt
    const calls = { wrapKey: 0, encrypt: 0 }
    subtle.wrapKey = ((...args: Parameters<SubtleCrypto['wrapKey']>) => {
      calls.wrapKey++
      return originalWrap.apply(subtle, args)
    }) as SubtleCrypto['wrapKey']
    subtle.encrypt = ((...args: Parameters<SubtleCrypto['encrypt']>) => {
      calls.encrypt++
      return originalEncrypt.apply(subtle, args)
    }) as SubtleCrypto['encrypt']
    try {
      await action()
      return calls
    } finally {
      subtle.wrapKey = originalWrap
      subtle.encrypt = originalEncrypt
    }
  }

  it('matches a byte-exact tag-96 vector for one recipient with a kid', async () => {
    assert.deepStrictEqual(await encryptFor([recipient(KEK_A, KID_A)]), hexToBytes(TAG96_HELLO_VECTOR_HEX))
  })

  it('writes the A256KW record with an empty protected field and alg and kid unprotected', async () => {
    const decoded = decodeEnvelope(await encryptFor([recipient(KEK_A, KID_A)]))
    const [record] = decoded.recipients

    assert.strictEqual(decoded.tag, TAG_ENCRYPT)
    assert.strictEqual(decoded.recipients.length, 1)
    assert.deepStrictEqual(record.protectedBytes, new Uint8Array(0))
    assert.deepStrictEqual(
      record.unprotected,
      new Map<number, unknown>([
        [HEADER_ALG, ALG_A256KW],
        [HEADER_KID, KID_A],
      ])
    )
    assert.strictEqual(record.ciphertext.length, 40)
  })

  it('omits kid when the recipient has none', async () => {
    const encoded = await encryptFor([recipient(KEK_A)])
    const [record] = decodeEnvelope(encoded).recipients

    assert.deepStrictEqual(record.unprotected, new Map([[HEADER_ALG, ALG_A256KW]]))
    assert.strictEqual(record.kid, undefined)
    assert.deepStrictEqual(await unwrapCek(record.ciphertext, KEK_A), FIXED_CEK)
  })

  it('wraps the same CEK for every recipient, in order, each under its own KEK only', async () => {
    const encoded = await encryptFor([recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    const [first, second] = decodeEnvelope(encoded).recipients

    assert.deepStrictEqual(first.kid, KID_A)
    assert.deepStrictEqual(second.kid, KID_B)
    assert.deepStrictEqual(await unwrapCek(first.ciphertext, KEK_A), FIXED_CEK)
    assert.deepStrictEqual(await unwrapCek(second.ciphertext, KEK_B), FIXED_CEK)
    assert.strictEqual(await unwrapCek(first.ciphertext, KEK_B), undefined)
    assert.strictEqual(await unwrapCek(second.ciphertext, KEK_A), undefined)
  })

  it('authenticates content under the Encrypt context, not Encrypt0', async () => {
    const encoded = await encryptFor([recipient(KEK_A, KID_A)])
    const decoded = decodeEnvelope(encoded)
    const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(FIXED_CEK), 'AES-GCM', false, [
      'decrypt',
    ])
    const decryptWithContext = (tag: typeof TAG_ENCRYPT | typeof TAG_ENCRYPT0) =>
      globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv: new Uint8Array(decoded.protectedHeader.iv),
          additionalData: encStructure(tag, decoded.protectedHeader.bytes),
          tagLength: 128,
        },
        key,
        new Uint8Array(encoded.subarray(decoded.envelopeLength))
      )

    await assert.rejects(decryptWithContext(TAG_ENCRYPT0))
    assert.deepStrictEqual(new Uint8Array(await decryptWithContext(TAG_ENCRYPT)), HELLO)
    assert.deepStrictEqual(await decrypt(encoded, new Uint8Array(FIXED_CEK)), HELLO)
  })

  it('keeps tag 16 when recipients is omitted', async () => {
    const encoded = await withRandomValues(fixedRandomValues, () =>
      encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK), recipients: undefined })
    )
    assert.deepStrictEqual(encoded, hexToBytes(HELLO_VECTOR_HEX))
  })

  it('rejects an empty recipients array before randomness or cryptography', async () => {
    let randomCalls = 0
    const observeRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
      randomCalls++
      return fixedRandomValues(array)
    }) as Crypto['getRandomValues']

    const calls = await countCryptoCalls(async () => {
      await withRandomValues(observeRandomValues, async () => {
        await assert.rejects(
          encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK), recipients: [] }),
          MalformedEnvelopeError
        )
      })
    })
    assert.strictEqual(randomCalls, 0)
    assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
  })

  it('rejects an invalid KEK in any recipient before wrapping or encrypting', async () => {
    for (const badKek of [new Uint8Array(KEY_SIZE - 1), new Uint8Array(KEY_SIZE), 'kek' as unknown as Uint8Array]) {
      const calls = await countCryptoCalls(async () => {
        await assert.rejects(
          encryptFor([recipient(KEK_A, KID_A), { alg: ALG_A256KW, kek: badKek }]),
          (error: unknown) => error instanceof InvalidKeyError && error.message.includes('recipients[1].kek')
        )
      })
      assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
    }
  })

  it('rejects malformed recipient entries before any cryptography', async () => {
    const invalid: unknown[] = [
      'recipients',
      [null],
      // biome-ignore lint/suspicious/noSparseArray: the hole is the input under test
      [, recipient(KEK_A)],
      [{ alg: ALG_ECDH_ES_A256KW, kek: new Uint8Array(KEK_A) }],
      [{ kek: new Uint8Array(KEK_A) }],
      [{ alg: ALG_A256KW, kek: new Uint8Array(KEK_A), kid: 'kid' }],
    ]
    for (const recipients of invalid) {
      const calls = await countCryptoCalls(async () => {
        await assert.rejects(encryptFor(recipients as A256KWRecipient[]), MalformedEnvelopeError)
      })
      assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
    }
  })

  it('rejects a SharedArrayBuffer-backed recipient KEK before wrapping or encrypting', async () => {
    const badKek = new Uint8Array(new SharedArrayBuffer(KEY_SIZE))
    badKek.set(KEK_B)

    const calls = await countCryptoCalls(async () => {
      await assert.rejects(
        encryptFor([recipient(KEK_A, KID_A), { alg: ALG_A256KW, kek: badKek }]),
        (error: unknown) => error instanceof InvalidKeyError && error.message.includes('recipients[1].kek')
      )
    })
    assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
  })

  it('imports the CEK once and each recipient KEK once, by algorithm', async () => {
    const subtle = globalThis.crypto.subtle
    const original = subtle.importKey
    const importsByAlgorithm = new Map<string, number>()
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      const algorithm = args[2]
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      importsByAlgorithm.set(name, (importsByAlgorithm.get(name) ?? 0) + 1)
      return original.apply(subtle, args)
    }) as SubtleCrypto['importKey']

    try {
      await encryptFor([recipient(KEK_A, KID_A), recipient(KEK_B, KID_B)])
    } finally {
      subtle.importKey = original
    }

    assert.strictEqual(importsByAlgorithm.get('AES-GCM'), 1)
    assert.strictEqual(importsByAlgorithm.get('AES-KW'), 2)
  })

  /** Record the `extractable` flag of every AES-GCM `importKey` call made by `action`. */
  async function captureCekExtractable(action: () => Promise<unknown>): Promise<boolean[]> {
    const subtle = globalThis.crypto.subtle
    const original = subtle.importKey
    const extractableFlags: boolean[] = []
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      const algorithm = args[2]
      const name = typeof algorithm === 'string' ? algorithm : algorithm.name
      if (name === 'AES-GCM') {
        extractableFlags.push(args[3])
      }
      return original.apply(subtle, args)
    }) as SubtleCrypto['importKey']
    try {
      await action()
    } finally {
      subtle.importKey = original
    }
    return extractableFlags
  }

  it('imports the CEK as extractable only when it will be wrapped for recipients', async () => {
    const withoutRecipients = await captureCekExtractable(() =>
      withRandomValues(fixedRandomValues, () => encrypt(new Uint8Array(HELLO), { cek: new Uint8Array(FIXED_CEK) }))
    )
    assert.deepStrictEqual(withoutRecipients, [false])

    const withRecipients = await captureCekExtractable(() => encryptFor([recipient(KEK_A, KID_A)]))
    assert.deepStrictEqual(withRecipients, [true])

    const encoded = await encryptFor([recipient(KEK_A, KID_A)])
    const decrypting = await captureCekExtractable(() => decrypt(encoded, new Uint8Array(FIXED_CEK)))
    assert.deepStrictEqual(decrypting, [false])
  })

  it('wraps recipient keys sequentially, never more than one in flight', async () => {
    const subtle = globalThis.crypto.subtle
    const originalImportKey = subtle.importKey
    const originalWrapKey = subtle.wrapKey
    let inFlight = 0
    let maxInFlight = 0

    const track = <A extends unknown[], R>(fn: (...args: A) => Promise<R>) =>
      (async (...args: A) => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        try {
          return await fn(...args)
        } finally {
          inFlight--
        }
      }) as (...args: A) => Promise<R>

    subtle.importKey = track(originalImportKey.bind(subtle)) as SubtleCrypto['importKey']
    subtle.wrapKey = track(originalWrapKey.bind(subtle)) as SubtleCrypto['wrapKey']

    try {
      await encryptFor([recipient(KEK_A, KID_A), recipient(KEK_B, KID_B), recipient(KEK_A)])
    } finally {
      subtle.importKey = originalImportKey
      subtle.wrapKey = originalWrapKey
    }

    assert.strictEqual(maxInFlight, 1)
  })

  it('makes zero crypto calls when a late recipient (index 2 of 3) is malformed', async () => {
    let randomCalls = 0
    const observeRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
      randomCalls++
      return fixedRandomValues(array)
    }) as Crypto['getRandomValues']

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
      await withRandomValues(observeRandomValues, async () => {
        await assert.rejects(
          encryptFor([
            recipient(KEK_A, KID_A),
            recipient(KEK_B, KID_B),
            { alg: ALG_ECDH_ES_A256KW, kek: new Uint8Array(KEK_A) },
          ] as A256KWRecipient[]),
          MalformedEnvelopeError
        )
      })
    } finally {
      subtle.importKey = originalImportKey
      subtle.wrapKey = originalWrapKey
      subtle.encrypt = originalEncrypt
    }

    assert.strictEqual(randomCalls, 0)
    assert.deepStrictEqual(calls, { importKey: 0, wrapKey: 0, encrypt: 0 })
  })

  it('reads each recipient property exactly once', async () => {
    const reads = { alg: 0, kek: 0, kid: 0 }
    const recipientWithGetters: A256KWRecipient = {
      get alg(): typeof ALG_A256KW {
        reads.alg++
        return ALG_A256KW
      },
      get kek() {
        reads.kek++
        return new Uint8Array(KEK_A)
      },
      get kid() {
        reads.kid++
        return new Uint8Array(KID_A)
      },
    }

    await encryptFor([recipientWithGetters])

    assert.deepStrictEqual(reads, { alg: 1, kek: 1, kid: 1 })
  })

  it('rejects a kid that cannot fit before copying keys or starting cryptography', async () => {
    const calls = await countCryptoCalls(async () => {
      await assert.rejects(
        encryptFor([recipient(KEK_A, new Uint8Array(MAX_ENVELOPE_SIZE))]),
        /exceeding the \d+-byte remaining envelope budget/
      )
    })
    assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
  })

  it('rejects cumulative kid data that cannot fit before key wrapping', async () => {
    const recipients = Array.from({ length: 4 }, () => recipient(KEK_A, new Uint8Array(MAX_ENVELOPE_SIZE / 2)))

    const calls = await countCryptoCalls(async () => {
      await assert.rejects(encryptFor(recipients), /remaining envelope budget/)
    })
    assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
  })

  it('rejects a recipient count whose wrapped CEKs alone cannot fit before cryptography', async () => {
    const impossibleCount = Math.floor(MAX_ENVELOPE_SIZE / WRAPPED_CEK_SIZE) + 1
    const recipients = new Array<A256KWRecipient>(impossibleCount).fill(recipient(KEK_A))

    const calls = await countCryptoCalls(async () => {
      await assert.rejects(encryptFor(recipients), /remaining envelope budget/)
    })
    assert.deepStrictEqual(calls, { wrapKey: 0, encrypt: 0 })
  })

  it('still enforces the exact MAX_ENVELOPE_SIZE ceiling once CBOR framing is added, even after the budget check passes', async () => {
    // The pre-crypto budget check only sums WRAPPED_CEK_SIZE + kid.length; it
    // has no way to know the CBOR framing overhead (tags, array/map headers,
    // the protected header) that assembly adds on top. A kid sized to fill
    // the budget exactly therefore clears that check but yields an encoded
    // envelope a little over MAX_ENVELOPE_SIZE, which assembly must still catch.
    const kid = new Uint8Array(MAX_ENVELOPE_SIZE - WRAPPED_CEK_SIZE)

    const calls = await countCryptoCalls(async () => {
      await assert.rejects(encryptFor([recipient(KEK_A, kid)]), /exceeds the \d+-byte decode ceiling/)
    })
    assert.strictEqual(calls.encrypt, 0)
  })
})
