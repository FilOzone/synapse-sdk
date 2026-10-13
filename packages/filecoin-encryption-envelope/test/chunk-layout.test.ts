import assert from 'node:assert'
import { chunkCountForPlaintext, chunkLayout, ciphertextLengthForPlaintext } from '../src/chunk-layout.ts'
import { MAX_CHUNK_COUNT, MAX_CHUNK_SIZE, MAX_ENCODED_OBJECT_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from '../src/constants.ts'
import {
  ChunkCountExceededError,
  InvalidChunkSizeError,
  InvalidCiphertextLengthError,
  InvalidPlaintextLengthError,
} from '../src/errors.ts'

const CHUNK_SIZE = MIN_CHUNK_SIZE // 4096, small enough to keep test numbers readable
const STRIDE = CHUNK_SIZE + TAG_SIZE

/**
 * Independent reimplementation of the ciphertext length an encoder produces,
 * always in the `k`-chunk (never `k+1`) form. Deliberately not the exported
 * `ciphertextLengthForPlaintext` or `chunkCountForPlaintext`: the round-trip
 * test below needs an oracle that would not agree with `chunkLayout` if both
 * shared the same chunk-count bug.
 */
function expectedCiphertextLength(length: number, chunkSizeBytes: number): number {
  const count = Math.max(1, Math.ceil(length / chunkSizeBytes))
  const stride = chunkSizeBytes + TAG_SIZE
  const lastChunkPlaintext = length <= 0 ? 0 : length - (count - 1) * chunkSizeBytes
  return (count - 1) * stride + (lastChunkPlaintext + TAG_SIZE)
}

describe('chunkLayout', () => {
  it('treats an all-tag ciphertext as one empty chunk', () => {
    const layout = chunkLayout(TAG_SIZE, CHUNK_SIZE)
    assert.deepStrictEqual(layout, { chunkCount: 1, lastChunkCipherLength: TAG_SIZE, plaintextLength: 0 })
  })

  it('treats exactly one stride as a single full chunk', () => {
    const layout = chunkLayout(STRIDE, CHUNK_SIZE)
    assert.deepStrictEqual(layout, { chunkCount: 1, lastChunkCipherLength: STRIDE, plaintextLength: CHUNK_SIZE })
  })

  it('rejects a final chunk carrying only its tag, at any position after the first', () => {
    // Such a chunk would decrypt to exactly what the k-chunk form above
    // already encodes. Accepting both would give an exact-multiple plaintext
    // two legal ciphertext lengths, and `plaintext_length` could not then be
    // checked exactly.
    for (const fullChunks of [1, 2, 5]) {
      assert.throws(() => chunkLayout(STRIDE * fullChunks + TAG_SIZE, CHUNK_SIZE), InvalidCiphertextLengthError)
    }
  })

  it('handles a partial final chunk', () => {
    const ciphertextLength = STRIDE * 2 + 100
    const layout = chunkLayout(ciphertextLength, CHUNK_SIZE)
    assert.deepStrictEqual(layout, {
      chunkCount: 3,
      lastChunkCipherLength: 100,
      plaintextLength: CHUNK_SIZE * 2 + (100 - TAG_SIZE),
    })
  })

  it('handles several multi-chunk sizes', () => {
    for (const chunks of [4, 10, 100]) {
      const ciphertextLength = STRIDE * chunks
      const layout = chunkLayout(ciphertextLength, CHUNK_SIZE)
      assert.strictEqual(layout.chunkCount, chunks)
      assert.strictEqual(layout.lastChunkCipherLength, STRIDE)
      assert.strictEqual(layout.plaintextLength, CHUNK_SIZE * chunks)
    }
  })

  it('round-trips: chunkLayout recovers the plaintext size an encoder produced', () => {
    const lengths = [0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 2, CHUNK_SIZE * 2 + 1, 123456]
    for (const length of lengths) {
      const ciphertextLength = expectedCiphertextLength(length, CHUNK_SIZE)
      const layout = chunkLayout(ciphertextLength, CHUNK_SIZE)
      assert.strictEqual(layout.plaintextLength, length, `plaintext length ${length}`)
    }
  })

  it('rejects a ciphertext length of 0 (no chunks at all is not a valid object)', () => {
    assert.throws(() => chunkLayout(0, CHUNK_SIZE), InvalidCiphertextLengthError)
  })

  it('rejects a final-chunk remainder too small to hold a tag (1..15 bytes over a stride)', () => {
    for (let extra = 1; extra < TAG_SIZE; extra++) {
      assert.throws(() => chunkLayout(STRIDE + extra, CHUNK_SIZE), InvalidCiphertextLengthError, `extra=${extra}`)
    }
  })

  it('rejects a negative or non-safe-integer ciphertext length', () => {
    assert.throws(() => chunkLayout(-1, CHUNK_SIZE), InvalidCiphertextLengthError)
    assert.throws(() => chunkLayout(1.5, CHUNK_SIZE), InvalidCiphertextLengthError)
    assert.throws(() => chunkLayout(Number.MAX_SAFE_INTEGER + 2, CHUNK_SIZE), InvalidCiphertextLengthError)
  })

  it('rejects a chunk size below the minimum', () => {
    assert.throws(() => chunkLayout(STRIDE, MIN_CHUNK_SIZE - 1), InvalidChunkSizeError)
  })

  it('rejects a chunk size above the maximum', () => {
    assert.throws(() => chunkLayout(STRIDE, MAX_CHUNK_SIZE + 1), InvalidChunkSizeError)
  })

  it('rejects a non-integer chunk size', () => {
    assert.throws(() => chunkLayout(STRIDE, 4096.5), InvalidChunkSizeError)
  })

  it('rejects a detached ciphertext larger than the whole-object limit', () => {
    assert.throws(() => chunkLayout(MAX_ENCODED_OBJECT_SIZE + 1, MIN_CHUNK_SIZE), InvalidCiphertextLengthError)
  })

  it('does not enforce the whole-object limit, which it has no envelope length to check against', () => {
    // A ciphertext 16 bytes under the ceiling is accepted here, and any
    // envelope at all then puts the complete object over 64 GiB. This is a
    // deliberate boundary of the module, not an oversight: the limit covers
    // envelope + ciphertext, and only the layer holding the total blob
    // length can check it.
    //
    // This test documents the seam; it cannot police it. It asserts what
    // this module does, so it keeps passing whether or not a future
    // encryption layer remembers the total-size check. The test that would
    // catch that omission has to live with that layer — a rejection test
    // over envelopeLength + ciphertextLength — and does not exist yet.
    const stride = MIN_CHUNK_SIZE + TAG_SIZE
    const justUnder = Math.floor(MAX_ENCODED_OBJECT_SIZE / stride) * stride
    assert.ok(justUnder <= MAX_ENCODED_OBJECT_SIZE)
    assert.doesNotThrow(() => chunkLayout(justUnder, MIN_CHUNK_SIZE))
  })

  it('reaches the object-size limit before the wire chunk-count limit, at every legal chunk size', () => {
    // The 64 GiB object ceiling permits far fewer than 2^32 - 1 chunks at
    // every supported chunk size. Keep the count check anyway: it records the
    // format boundary independently of the current object-size policy.
    for (const chunkSize of [MIN_CHUNK_SIZE, 262144, MAX_CHUNK_SIZE]) {
      const chunksAtObjectLimit = Math.floor(MAX_ENCODED_OBJECT_SIZE / (chunkSize + TAG_SIZE))
      assert.ok(
        chunksAtObjectLimit < MAX_CHUNK_COUNT,
        `chunk size ${chunkSize} admits ${chunksAtObjectLimit} chunks, at or above the ${MAX_CHUNK_COUNT} ceiling`
      )
    }
  })
})

describe('chunkCountForPlaintext', () => {
  it('returns 1 for empty plaintext', () => {
    assert.strictEqual(chunkCountForPlaintext(0, CHUNK_SIZE), 1)
  })

  it('returns the exact quotient for an exact multiple of the chunk size', () => {
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE, CHUNK_SIZE), 1)
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE * 3, CHUNK_SIZE), 3)
  })

  it('rounds up for a non-multiple of the chunk size', () => {
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE + 1, CHUNK_SIZE), 2)
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE * 3 - 1, CHUNK_SIZE), 3)
  })

  it('rejects a negative plaintext length instead of treating it as empty', () => {
    // Previously returned 1, silently treating a negative length as empty input.
    assert.throws(() => chunkCountForPlaintext(-1, CHUNK_SIZE), InvalidPlaintextLengthError)
  })

  it('rejects a NaN plaintext length', () => {
    assert.throws(() => chunkCountForPlaintext(Number.NaN, CHUNK_SIZE), InvalidPlaintextLengthError)
  })

  it('rejects a non-safe-integer plaintext length', () => {
    assert.throws(() => chunkCountForPlaintext(1.5, CHUNK_SIZE), InvalidPlaintextLengthError)
    assert.throws(() => chunkCountForPlaintext(Number.MAX_SAFE_INTEGER + 2, CHUNK_SIZE), InvalidPlaintextLengthError)
  })

  it('rejects a chunk size of 0 instead of dividing by it', () => {
    // Previously returned Infinity for chunkCountForPlaintext(1, 0).
    assert.throws(() => chunkCountForPlaintext(1, 0), InvalidChunkSizeError)
  })

  it('rejects a chunk size outside [MIN_CHUNK_SIZE, MAX_CHUNK_SIZE]', () => {
    assert.throws(() => chunkCountForPlaintext(1, MIN_CHUNK_SIZE - 1), InvalidChunkSizeError)
    assert.throws(() => chunkCountForPlaintext(1, MAX_CHUNK_SIZE + 1), InvalidChunkSizeError)
  })

  it('rejects a plaintext length whose chunk count would exceed MAX_CHUNK_COUNT', () => {
    // Previously returned MAX_CHUNK_COUNT + 1 uncaught.
    const plaintextLength = MIN_CHUNK_SIZE * (MAX_CHUNK_COUNT + 1)
    assert.throws(() => chunkCountForPlaintext(plaintextLength, MIN_CHUNK_SIZE), ChunkCountExceededError)
  })
})

describe('ciphertextLengthForPlaintext', () => {
  it('adds one tag per chunk', () => {
    assert.strictEqual(ciphertextLengthForPlaintext(0, CHUNK_SIZE), TAG_SIZE)
    assert.strictEqual(ciphertextLengthForPlaintext(1, CHUNK_SIZE), 1 + TAG_SIZE)
    assert.strictEqual(ciphertextLengthForPlaintext(CHUNK_SIZE, CHUNK_SIZE), STRIDE)
    assert.strictEqual(ciphertextLengthForPlaintext(CHUNK_SIZE + 1, CHUNK_SIZE), CHUNK_SIZE + 1 + 2 * TAG_SIZE)
  })

  it('agrees with chunkLayout in both directions', () => {
    // The two functions are inverses only because the profile permits one
    // final-chunk form; this is the test that would catch a relaxation of
    // that rule on either side.
    for (const plaintextLength of [0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 3, 123456]) {
      const ciphertextLength = ciphertextLengthForPlaintext(plaintextLength, CHUNK_SIZE)
      assert.strictEqual(chunkLayout(ciphertextLength, CHUNK_SIZE).plaintextLength, plaintextLength)
    }
  })

  it('is strictly increasing, so one ciphertext length admits exactly one plaintext length', () => {
    let previous = -1
    for (let plaintextLength = 0; plaintextLength <= CHUNK_SIZE * 2 + 1; plaintextLength++) {
      const ciphertextLength = ciphertextLengthForPlaintext(plaintextLength, CHUNK_SIZE)
      assert.ok(ciphertextLength > previous, `not increasing at plaintext length ${plaintextLength}`)
      previous = ciphertextLength
    }
  })

  it('rejects a plaintext length whose ciphertext would exceed the encoded-object limit', () => {
    assert.throws(
      () => ciphertextLengthForPlaintext(MAX_ENCODED_OBJECT_SIZE, MAX_CHUNK_SIZE),
      InvalidPlaintextLengthError
    )
  })

  it('rejects the same bad inputs chunkCountForPlaintext does', () => {
    assert.throws(() => ciphertextLengthForPlaintext(-1, CHUNK_SIZE), InvalidPlaintextLengthError)
    assert.throws(() => ciphertextLengthForPlaintext(1, 0), InvalidChunkSizeError)
  })
})
