import assert from 'node:assert'
import { KEY_SIZE } from '../src/constants.ts'
import { ALG_A256KW, ALG_ECDH_ES_A256KW } from '../src/cose/constants.ts'
import {
  CryptoOperationError,
  InvalidKeyError,
  MalformedEnvelopeError,
  RecipientAttemptLimitError,
} from '../src/errors.ts'
import { aesKwWrap, importAesGcmKey, importAesKwKey } from '../src/internal/web-crypto.ts'
import { createA256KWUnwrapper } from '../src/recipients/a256kw.ts'
import type { A256KWKey, A256KWUnwrapperOptions, RecipientInfo } from '../src/recipients/types.ts'

const CEK = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index + 1)
const KEK_A = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x10 + index)
const KEK_B = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x20 + index)
const KID_A = Uint8Array.from([0xa1])
const KID_B = Uint8Array.from([0xb1])

/** A 40-byte value that is well-formed length-wise but fails AES-KW's integrity check under any KEK. */
const FAILING_WRAP = new Uint8Array(40)

async function wrapCekFor(cek: Uint8Array, kek: Uint8Array): Promise<Uint8Array> {
  const cekKey = await importAesGcmKey(new Uint8Array(cek), 'encrypt', true)
  const kekKey = await importAesKwKey(new Uint8Array(kek), 'wrapKey')
  return aesKwWrap(cekKey, kekKey)
}

function recipientInfo(overrides: {
  wrappedKey: Uint8Array
  alg?: number | string
  kid?: Uint8Array
  index?: number
}): RecipientInfo {
  return {
    index: overrides.index ?? 0,
    alg: overrides.alg ?? ALG_A256KW,
    ...(overrides.kid === undefined ? {} : { kid: overrides.kid }),
    protectedBytes: new Uint8Array(0),
    protected: new Map(),
    unprotected: new Map(),
    wrappedKey: overrides.wrappedKey,
  }
}

/** Count `subtle.importKey` calls made by `action`. Restores the original in `finally`. */
async function countImportKeyCalls(action: () => Promise<unknown>): Promise<number> {
  const subtle = globalThis.crypto.subtle
  const original = subtle.importKey
  let count = 0
  subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
    count++
    return original.apply(subtle, args)
  }) as SubtleCrypto['importKey']
  try {
    await action()
  } finally {
    subtle.importKey = original
  }
  return count
}

/** Count `subtle.unwrapKey` calls made by `action`. Restores the original in `finally`. */
async function countUnwrapKeyCalls(action: () => Promise<unknown>): Promise<number> {
  const subtle = globalThis.crypto.subtle
  const original = subtle.unwrapKey
  let count = 0
  subtle.unwrapKey = ((...args: Parameters<SubtleCrypto['unwrapKey']>) => {
    count++
    return original.apply(subtle, args)
  }) as SubtleCrypto['unwrapKey']
  try {
    await action()
  } finally {
    subtle.unwrapKey = original
  }
  return count
}

describe('createA256KWUnwrapper', () => {
  describe('validates before any crypto', () => {
    const cases: Array<[string, unknown, unknown, new (...args: never[]) => Error]> = [
      ['keys is not an array', 'nope', undefined, MalformedEnvelopeError],
      ['keys is empty', [], undefined, MalformedEnvelopeError],
      ['a key entry is not an object', ['nope'], undefined, MalformedEnvelopeError],
      ['a key entry is null', [null], undefined, MalformedEnvelopeError],
      ['kek is too short', [{ kek: new Uint8Array(KEY_SIZE - 1) }], undefined, InvalidKeyError],
      ['kek is all-zero', [{ kek: new Uint8Array(KEY_SIZE) }], undefined, InvalidKeyError],
      [
        'kek is SharedArrayBuffer-backed',
        [{ kek: new Uint8Array(new SharedArrayBuffer(KEY_SIZE)) }],
        undefined,
        InvalidKeyError,
      ],
      ['kek is not a Uint8Array', [{ kek: 'nope' }], undefined, InvalidKeyError],
      ['kid is not a Uint8Array', [{ kek: KEK_A, kid: 'nope' }], undefined, MalformedEnvelopeError],
      // A valid key first: validation must finish for every entry before any import.
      ['a later kek is invalid', [{ kek: KEK_A }, { kek: new Uint8Array(KEY_SIZE) }], undefined, InvalidKeyError],
      [
        'a later kid is not a Uint8Array',
        [{ kek: KEK_A }, { kek: KEK_B, kid: 'nope' }],
        undefined,
        MalformedEnvelopeError,
      ],
      ['options is not an object', [{ kek: KEK_A }], 'nope', MalformedEnvelopeError],
      ['options is null', [{ kek: KEK_A }], null, MalformedEnvelopeError],
      ['options is an array', [{ kek: KEK_A }], [], MalformedEnvelopeError],
      ['maxAttempts is 0', [{ kek: KEK_A }], { maxAttempts: 0 }, MalformedEnvelopeError],
      ['maxAttempts is negative', [{ kek: KEK_A }], { maxAttempts: -1 }, MalformedEnvelopeError],
      ['maxAttempts is not an integer', [{ kek: KEK_A }], { maxAttempts: 1.5 }, MalformedEnvelopeError],
      ['maxAttempts is NaN', [{ kek: KEK_A }], { maxAttempts: Number.NaN }, MalformedEnvelopeError],
      [
        'maxAttempts exceeds the safe integer range',
        [{ kek: KEK_A }],
        { maxAttempts: 2 ** 53 },
        MalformedEnvelopeError,
      ],
    ]

    for (const [label, keys, options, ErrorClass] of cases) {
      it(`rejects: ${label}`, async () => {
        const count = await countImportKeyCalls(() =>
          assert.rejects(
            createA256KWUnwrapper(keys as A256KWKey[], options as A256KWUnwrapperOptions | undefined),
            ErrorClass
          )
        )
        assert.strictEqual(count, 0)
      })
    }

    it('rejects: a sparse hole in keys', async () => {
      // biome-ignore lint/suspicious/noSparseArray: the hole is the input under test
      const keys = [, { kek: KEK_A }] as A256KWKey[]
      const count = await countImportKeyCalls(() => assert.rejects(createA256KWUnwrapper(keys), MalformedEnvelopeError))
      assert.strictEqual(count, 0)
    })
  })

  it('reports a KEK import failure as CryptoOperationError', async () => {
    const subtle = globalThis.crypto.subtle
    const original = subtle.importKey
    subtle.importKey = (() => Promise.reject(new DOMException('unavailable', 'NotSupportedError'))) as never
    try {
      await assert.rejects(createA256KWUnwrapper([{ kek: KEK_A }]), CryptoOperationError)
    } finally {
      subtle.importKey = original
    }
  })

  it('imports each KEK exactly once, non-extractable, with unwrapKey usage only', async () => {
    const subtle = globalThis.crypto.subtle
    const original = subtle.importKey
    const calls: Array<{ extractable: boolean; usages: readonly string[] }> = []
    subtle.importKey = ((...args: Parameters<SubtleCrypto['importKey']>) => {
      calls.push({ extractable: args[3], usages: args[4] as string[] })
      return original.apply(subtle, args)
    }) as SubtleCrypto['importKey']

    try {
      await createA256KWUnwrapper([{ kek: KEK_A }, { kek: KEK_B }])
    } finally {
      subtle.importKey = original
    }

    assert.strictEqual(calls.length, 2)
    for (const call of calls) {
      assert.strictEqual(call.extractable, false)
      assert.deepStrictEqual(call.usages, ['unwrapKey'])
    }
  })

  it('imports KEKs sequentially, never more than one in flight', async () => {
    const subtle = globalThis.crypto.subtle
    const original = subtle.importKey
    let inFlight = 0
    let maxInFlight = 0
    subtle.importKey = (async (...args: Parameters<SubtleCrypto['importKey']>) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        return await original.apply(subtle, args)
      } finally {
        inFlight--
      }
    }) as SubtleCrypto['importKey']

    try {
      await createA256KWUnwrapper([{ kek: KEK_A }, { kek: KEK_B }, { kek: new Uint8Array(KEK_A).fill(0x42) }])
    } finally {
      subtle.importKey = original
    }

    assert.strictEqual(maxInFlight, 1)
  })

  it('reads kek and kid once per key entry', async () => {
    const reads = { kek: 0, kid: 0 }
    const keyWithGetters: A256KWKey = {
      get kek() {
        reads.kek++
        return KEK_A
      },
      get kid() {
        reads.kid++
        return KID_A
      },
    }
    await createA256KWUnwrapper([keyWithGetters])
    assert.deepStrictEqual(reads, { kek: 1, kid: 1 })
  })

  it('copies each kid: mutating the caller kid after the factory resolves does not change matching', async () => {
    const kid = new Uint8Array(KID_A)
    const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid }])
    kid.fill(0xff)

    const wrapped = await wrapCekFor(CEK, KEK_A)
    assert.deepStrictEqual(await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_A })]), CEK)
  })

  it('does not break unwrapping if the caller clears its KEK bytes after the factory resolves', async () => {
    const kek = new Uint8Array(KEK_A)
    const unwrapper = await createA256KWUnwrapper([{ kek }])
    kek.fill(0)

    const wrapped = await wrapCekFor(CEK, KEK_A)
    assert.deepStrictEqual(await unwrapper([recipientInfo({ wrappedKey: wrapped })]), CEK)
  })

  describe('matching', () => {
    it('recovers the CEK when a key kid matches the recipient kid', async () => {
      const unwrapper = await createA256KWUnwrapper([
        { kek: KEK_A, kid: KID_A },
        { kek: KEK_B, kid: KID_B },
      ])
      const wrapped = await wrapCekFor(CEK, KEK_B)
      assert.deepStrictEqual(await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_B })]), CEK)
    })

    it('never tries a key whose kid differs from the recipient kid', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }])
      const wrapped = await wrapCekFor(CEK, KEK_A) // would succeed if the key were tried
      const calls = await countUnwrapKeyCalls(async () => {
        const result = await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_B })])
        assert.strictEqual(result, undefined)
      })
      assert.strictEqual(calls, 0)
    })

    it('tries keys in caller order for a kid-less recipient', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }, { kek: KEK_B }])
      const wrapped = await wrapCekFor(CEK, KEK_B)
      const calls = await countUnwrapKeyCalls(async () => {
        const cek = await unwrapper([recipientInfo({ wrappedKey: wrapped })])
        assert.deepStrictEqual(cek, CEK)
      })
      // KEK_A is tried first and fails integrity before KEK_B succeeds.
      assert.strictEqual(calls, 2)
    })

    it('tries exact-kid matches before kid-less wildcard keys', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }, { kek: KEK_B, kid: KID_A }])
      const wrapped = await wrapCekFor(CEK, KEK_B)
      const calls = await countUnwrapKeyCalls(async () => {
        const cek = await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_A })])
        assert.deepStrictEqual(cek, CEK)
      })
      // The exact match (KEK_B) succeeds on the first try; a wildcard-first
      // order would have failed on KEK_A before reaching it.
      assert.strictEqual(calls, 1)
    })

    it('falls back to a kid-less wildcard key after the exact-kid key fails', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }, { kek: KEK_B }])
      const wrapped = await wrapCekFor(CEK, KEK_B)
      const calls = await countUnwrapKeyCalls(async () => {
        const cek = await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_A })])
        assert.deepStrictEqual(cek, CEK)
      })
      assert.strictEqual(calls, 2)
    })

    it('tries a key that carries a kid for a kid-less recipient', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_B, kid: KID_B }])
      const wrapped = await wrapCekFor(CEK, KEK_B)

      assert.deepStrictEqual(await unwrapper([recipientInfo({ wrappedKey: wrapped })]), CEK)
    })

    it('treats an empty kid as present, not as a wildcard', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: new Uint8Array(0) }])
      const wrapped = await wrapCekFor(CEK, KEK_A)
      const calls = await countUnwrapKeyCalls(async () => {
        const result = await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: KID_A })])
        assert.strictEqual(result, undefined)
      })
      assert.strictEqual(calls, 0)
    })

    it('matches a recipient with an empty kid against a key with an empty kid', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: new Uint8Array(0) }])
      const wrapped = await wrapCekFor(CEK, KEK_A)
      const cek = await unwrapper([recipientInfo({ wrappedKey: wrapped, kid: new Uint8Array(0) })])
      assert.deepStrictEqual(cek, CEK)
    })

    it('skips a recipient whose alg is not A256KW, without counting an attempt', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }], { maxAttempts: 1 })
      const wrapped = await wrapCekFor(CEK, KEK_A)
      const cek = await unwrapper([
        recipientInfo({ wrappedKey: wrapped, alg: ALG_ECDH_ES_A256KW }),
        recipientInfo({ wrappedKey: wrapped, alg: ALG_A256KW }),
      ])
      assert.deepStrictEqual(cek, CEK)
    })

    it('processes recipients in wire order and returns the first recovered CEK', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }, { kek: KEK_B }])
      const wrappedA = await wrapCekFor(CEK, KEK_A)
      const otherCek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0xee - index)
      const wrappedB = await wrapCekFor(otherCek, KEK_B)
      const cek = await unwrapper([
        recipientInfo({ index: 0, wrappedKey: wrappedA }),
        recipientInfo({ index: 1, wrappedKey: wrappedB }),
      ])
      assert.deepStrictEqual(cek, CEK)
    })

    it('returns undefined when no key or recipient matches', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])
      const wrapped = await wrapCekFor(CEK, KEK_B) // wrapped under a KEK not supplied
      assert.strictEqual(await unwrapper([recipientInfo({ wrappedKey: wrapped })]), undefined)
    })
  })

  describe('attempt limit', () => {
    it('throws RecipientAttemptLimitError after exactly 64 unwrapKey calls by default', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }])
      const recipients = Array.from({ length: 65 }, () => recipientInfo({ wrappedKey: FAILING_WRAP }))

      const calls = await countUnwrapKeyCalls(() => assert.rejects(unwrapper(recipients), RecipientAttemptLimitError))
      assert.strictEqual(calls, 64)
    })

    it('throws on the 3rd attempt with maxAttempts: 2', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }], { maxAttempts: 2 })
      const recipients = Array.from({ length: 3 }, () => recipientInfo({ wrappedKey: FAILING_WRAP }))

      const calls = await countUnwrapKeyCalls(() => assert.rejects(unwrapper(recipients), RecipientAttemptLimitError))
      assert.strictEqual(calls, 2)
    })

    it('does not count skipped algs or kid mismatches against the limit', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A, kid: KID_A }], { maxAttempts: 1 })
      const recipients = [
        recipientInfo({ wrappedKey: FAILING_WRAP, alg: ALG_ECDH_ES_A256KW }), // skipped, no attempt
        recipientInfo({ wrappedKey: FAILING_WRAP, kid: KID_B }), // different kid, never tried
        recipientInfo({ wrappedKey: FAILING_WRAP, kid: KID_A }), // the one real attempt
      ]
      // If the skipped or mismatched recipients had counted, this single real
      // attempt would already be over budget and throw instead of settling.
      assert.strictEqual(await unwrapper(recipients), undefined)
    })

    it('resets the attempt counter for each call', async () => {
      const unwrapper = await createA256KWUnwrapper([{ kek: KEK_A }], { maxAttempts: 2 })
      const recipients = Array.from({ length: 2 }, () => recipientInfo({ wrappedKey: FAILING_WRAP }))

      assert.strictEqual(await unwrapper(recipients), undefined)
      // A shared, un-reset counter would already be at the limit here.
      assert.strictEqual(await unwrapper(recipients), undefined)
    })
  })
})
