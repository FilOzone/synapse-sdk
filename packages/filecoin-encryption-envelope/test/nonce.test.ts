import assert from 'node:assert'
import { MAX_CHUNK_COUNT, NONCE_SIZE } from '../src/constants.ts'
import { InvalidNonceError } from '../src/errors.ts'
import { deriveChunkNonce } from '../src/nonce.ts'

const BASE_NONCE = Uint8Array.from([1, 2, 3, 4, 5, 6, 7])

describe('deriveChunkNonce', () => {
  it('lays out base nonce, big-endian index, and last_flag byte-for-byte', () => {
    // Four distinct index bytes, so a wrong-endian implementation would
    // produce a visibly different (reversed) result here.
    const nonce = deriveChunkNonce(BASE_NONCE, 0x00a1b2c3, true)
    const expected = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 0x00, 0xa1, 0xb2, 0xc3, 0x01])
    assert.deepStrictEqual(nonce, expected)
    assert.strictEqual(nonce.length, NONCE_SIZE)
  })

  it('sets last_flag to 0x00 when isLast is false', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, 0x00a1b2c3, false)
    assert.strictEqual(nonce[11], 0x00)
  })

  it('encodes chunk index 0 as four zero bytes', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, 0, false)
    assert.deepStrictEqual(nonce.subarray(7, 11), Uint8Array.from([0, 0, 0, 0]))
  })

  it('encodes the highest permitted chunk index without wrapping', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, MAX_CHUNK_COUNT - 1, false)
    assert.deepStrictEqual(nonce.subarray(7, 11), Uint8Array.from([0xff, 0xff, 0xff, 0xfe]))
  })

  it('rejects a base nonce that is not a Uint8Array, before the length check can pass it', () => {
    // The cruel case here: a seven-character string satisfies a length-only
    // check, and Uint8Array.prototype.set copies it as seven ZERO bytes —
    // the per-object randomness disappears without a word.
    // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
    assert.throws(() => deriveChunkNonce('abcdefg', 0, false), InvalidNonceError)
    // @ts-expect-error deliberately passing a non-Uint8Array from untyped JS
    assert.throws(() => deriveChunkNonce([1, 2, 3, 4, 5, 6, 7], 0, false), InvalidNonceError)
  })

  it('rejects a base nonce of the wrong length', () => {
    assert.throws(() => deriveChunkNonce(Uint8Array.from([1, 2, 3, 4, 5, 6]), 0, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 0, false), InvalidNonceError)
  })

  it('rejects a negative, non-integer, or out-of-range chunk index', () => {
    assert.throws(() => deriveChunkNonce(BASE_NONCE, -1, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 1.5, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(BASE_NONCE, MAX_CHUNK_COUNT, false), InvalidNonceError) // one past the last index
    assert.doesNotThrow(() => deriveChunkNonce(BASE_NONCE, MAX_CHUNK_COUNT - 1, false))
  })

  it('rejects a non-boolean last-chunk flag instead of taking its truthiness', () => {
    // The cruel case: "false" is truthy, so an untyped JavaScript caller
    // would otherwise seal a middle chunk as final — and a truncated object
    // would then authenticate as complete.
    // @ts-expect-error deliberately passing a non-boolean from untyped JS
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 0, 'false'), InvalidNonceError)
    // @ts-expect-error deliberately passing a non-boolean from untyped JS
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 0, 1), InvalidNonceError)
    // @ts-expect-error deliberately passing a non-boolean from untyped JS
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 0, undefined), InvalidNonceError)
  })

  it('does not mutate the input base nonce', () => {
    const baseNonce = Uint8Array.from([1, 2, 3, 4, 5, 6, 7])
    const original = Uint8Array.from(baseNonce)
    const nonce = deriveChunkNonce(baseNonce, 42, true)
    assert.deepStrictEqual(baseNonce, original)

    // Mutating the result must not reach back into the caller's array either.
    nonce[0] = 0xff
    assert.deepStrictEqual(baseNonce, original)
  })
})
