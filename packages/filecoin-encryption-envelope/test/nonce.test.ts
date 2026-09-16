import assert from 'node:assert'
import { NONCE_SIZE } from '../src/constants.ts'
import { InvalidNonceError } from '../src/errors.ts'
import { deriveChunkNonce } from '../src/nonce.ts'

const BASE_NONCE = Uint8Array.from([1, 2, 3, 4, 5, 6, 7])

describe('deriveChunkNonce', () => {
  it('lays out base nonce, big-endian index, and last_flag byte-for-byte', () => {
    // 0x01020304 has four distinct bytes, so a wrong-endian implementation
    // would produce a visibly different (reversed) result here.
    const nonce = deriveChunkNonce(BASE_NONCE, 0x01020304, true)
    const expected = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 0x01, 0x02, 0x03, 0x04, 0x01])
    assert.deepStrictEqual(nonce, expected)
    assert.strictEqual(nonce.length, NONCE_SIZE)
  })

  it('sets last_flag to 0x00 when isLast is false', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, 0x01020304, false)
    assert.strictEqual(nonce[11], 0x00)
  })

  it('sets last_flag to 0x01 when isLast is true', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, 0x01020304, true)
    assert.strictEqual(nonce[11], 0x01)
  })

  it('encodes chunk index 0 as four zero bytes', () => {
    const nonce = deriveChunkNonce(BASE_NONCE, 0, false)
    assert.deepStrictEqual(nonce.subarray(7, 11), Uint8Array.from([0, 0, 0, 0]))
  })

  it('rejects a base nonce of the wrong length', () => {
    assert.throws(() => deriveChunkNonce(Uint8Array.from([1, 2, 3, 4, 5, 6]), 0, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]), 0, false), InvalidNonceError)
  })

  it('rejects a negative, non-integer, or out-of-range chunk index', () => {
    assert.throws(() => deriveChunkNonce(BASE_NONCE, -1, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 1.5, false), InvalidNonceError)
    assert.throws(() => deriveChunkNonce(BASE_NONCE, 4294967295, false), InvalidNonceError) // MAX_CHUNK_COUNT itself
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
