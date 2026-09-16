import assert from 'node:assert'
import { chunkCountForPlaintext, chunkLayout } from '../src/chunk-layout.ts'
import { MAX_CHUNK_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from '../src/constants.ts'
import { ChunkCountExceededError, InvalidChunkSizeError, InvalidCiphertextSizeError } from '../src/errors.ts'

const CHUNK_SIZE = MIN_CHUNK_SIZE // 4096, small enough to keep test numbers readable
const STRIDE = CHUNK_SIZE + TAG_SIZE

/**
 * Ciphertext size an encoder would produce for a plaintext of `length`
 * bytes at `chunkSize`, always using the `k`-chunk (never `k+1`) form. Used
 * to test that `chunkLayout` recovers the original plaintext size.
 */
function ciphertextSizeForPlaintext(length: number, chunkSizeBytes: number): number {
  const count = chunkCountForPlaintext(length, chunkSizeBytes)
  const stride = chunkSizeBytes + TAG_SIZE
  const lastChunkPlaintext = length <= 0 ? 0 : length - (count - 1) * chunkSizeBytes
  return (count - 1) * stride + (lastChunkPlaintext + TAG_SIZE)
}

describe('chunkLayout', () => {
  it('treats an all-tag ciphertext as one empty chunk', () => {
    const layout = chunkLayout(TAG_SIZE, CHUNK_SIZE)
    assert.deepStrictEqual(layout, { chunkCount: 1, lastChunkCipherLength: TAG_SIZE, plaintextSize: 0 })
  })

  it('treats exactly one stride as a single full chunk', () => {
    const layout = chunkLayout(STRIDE, CHUNK_SIZE)
    assert.deepStrictEqual(layout, { chunkCount: 1, lastChunkCipherLength: STRIDE, plaintextSize: CHUNK_SIZE })
  })

  it('accepts the k+1 form for an exact multiple of the chunk size (the deliberate ambiguity)', () => {
    // One full chunk plus an empty final chunk (just its tag) encodes the
    // same plaintext size as the single-full-chunk form above.
    const layout = chunkLayout(STRIDE + TAG_SIZE, CHUNK_SIZE)
    assert.deepStrictEqual(layout, {
      chunkCount: 2,
      lastChunkCipherLength: TAG_SIZE,
      plaintextSize: CHUNK_SIZE,
    })
  })

  it('handles a partial final chunk', () => {
    const ciphertextSize = STRIDE * 2 + 100
    const layout = chunkLayout(ciphertextSize, CHUNK_SIZE)
    assert.deepStrictEqual(layout, {
      chunkCount: 3,
      lastChunkCipherLength: 100,
      plaintextSize: CHUNK_SIZE * 2 + (100 - TAG_SIZE),
    })
  })

  it('handles several multi-chunk sizes', () => {
    for (const chunks of [4, 10, 100]) {
      const ciphertextSize = STRIDE * chunks
      const layout = chunkLayout(ciphertextSize, CHUNK_SIZE)
      assert.strictEqual(layout.chunkCount, chunks)
      assert.strictEqual(layout.lastChunkCipherLength, STRIDE)
      assert.strictEqual(layout.plaintextSize, CHUNK_SIZE * chunks)
    }
  })

  it('round-trips: chunkLayout recovers the plaintext size an encoder produced', () => {
    const lengths = [0, 1, CHUNK_SIZE - 1, CHUNK_SIZE, CHUNK_SIZE + 1, CHUNK_SIZE * 2, CHUNK_SIZE * 2 + 1, 123456]
    for (const length of lengths) {
      const ciphertextSize = ciphertextSizeForPlaintext(length, CHUNK_SIZE)
      const layout = chunkLayout(ciphertextSize, CHUNK_SIZE)
      assert.strictEqual(layout.plaintextSize, length, `plaintext length ${length}`)
    }
  })

  it('rejects a ciphertext size of 0 (no chunks at all is not a valid object)', () => {
    assert.throws(() => chunkLayout(0, CHUNK_SIZE), InvalidCiphertextSizeError)
  })

  it('rejects a final-chunk remainder too small to hold a tag (1..15 bytes over a stride)', () => {
    for (let extra = 1; extra < TAG_SIZE; extra++) {
      assert.throws(() => chunkLayout(STRIDE + extra, CHUNK_SIZE), InvalidCiphertextSizeError, `extra=${extra}`)
    }
  })

  it('rejects a negative or non-safe-integer ciphertext size', () => {
    assert.throws(() => chunkLayout(-1, CHUNK_SIZE), InvalidCiphertextSizeError)
    assert.throws(() => chunkLayout(1.5, CHUNK_SIZE), InvalidCiphertextSizeError)
    assert.throws(() => chunkLayout(Number.MAX_SAFE_INTEGER + 2, CHUNK_SIZE), InvalidCiphertextSizeError)
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

  it('rejects a chunk count above MAX_CHUNK_COUNT', () => {
    // Smallest ciphertext size whose derived chunk count exceeds the limit,
    // using the smallest legal stride so the arithmetic stays exact.
    const stride = MIN_CHUNK_SIZE + TAG_SIZE
    const tooManyChunks = 4294967296 // MAX_CHUNK_COUNT + 1
    const ciphertextSize = stride * tooManyChunks
    assert.throws(() => chunkLayout(ciphertextSize, MIN_CHUNK_SIZE), ChunkCountExceededError)
  })
})

describe('chunkCountForPlaintext', () => {
  it('returns 1 for empty or negative-length plaintext', () => {
    assert.strictEqual(chunkCountForPlaintext(0, CHUNK_SIZE), 1)
    assert.strictEqual(chunkCountForPlaintext(-1, CHUNK_SIZE), 1)
  })

  it('returns the exact quotient for an exact multiple of the chunk size', () => {
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE, CHUNK_SIZE), 1)
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE * 3, CHUNK_SIZE), 3)
  })

  it('rounds up for a non-multiple of the chunk size', () => {
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE + 1, CHUNK_SIZE), 2)
    assert.strictEqual(chunkCountForPlaintext(CHUNK_SIZE * 3 - 1, CHUNK_SIZE), 3)
  })
})
