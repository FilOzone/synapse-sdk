/**
 * Chunk layout arithmetic for the chunked AES-256-GCM scheme.
 *
 * A reader needs the full chunk layout — how many chunks, how long the last
 * one is, and the total plaintext size — before decrypting anything, because
 * a chunk's nonce depends on whether it is the last one (see nonce.ts). Two
 * numbers give you the lot: the ciphertext size and the chunk size. See
 * docs/tech-spec.md, "chunk_count and truncation".
 */
import { MAX_CHUNK_COUNT, MAX_CHUNK_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from './constants.ts'
import { ChunkCountExceededError, InvalidChunkSizeError, InvalidCiphertextSizeError } from './errors.ts'

export interface ChunkLayout {
  chunkCount: number
  /** Wire bytes of the final chunk, tag included. */
  lastChunkCipherLength: number
  plaintextSize: number
}

/**
 * Derive the chunk layout of a stored blob from its ciphertext size and
 * chunk size — never the reverse. A declared `chunk_count` header must be
 * checked against `chunkLayout(...).chunkCount`, not the other way around,
 * or a truncated object would go undetected (docs/tech-spec.md, "Three
 * rules make the check correct").
 */
export function chunkLayout(ciphertextSize: number, chunkSize: number): ChunkLayout {
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    throw new InvalidChunkSizeError(
      `Invalid chunk size: ${chunkSize}. Must be an integer between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes.`
    )
  }
  if (!Number.isSafeInteger(ciphertextSize) || ciphertextSize < 0) {
    throw new InvalidCiphertextSizeError(
      `Invalid ciphertext size: ${ciphertextSize}. Must be a non-negative safe integer.`
    )
  }

  const stride = chunkSize + TAG_SIZE
  const q = Math.floor(ciphertextSize / stride)
  const r = ciphertextSize % stride

  let chunkCount: number
  let lastChunkCipherLength: number

  if (r === 0 && q >= 1) {
    // Exact multiple of the stride: every chunk, including the last, is full.
    chunkCount = q
    lastChunkCipherLength = stride
  } else if (r >= TAG_SIZE) {
    // A short final chunk, large enough to hold at least its tag.
    chunkCount = q + 1
    lastChunkCipherLength = r
  } else {
    // Either no ciphertext at all (r === 0, q === 0) or a remainder too
    // small to contain a tag (1..15 bytes) — neither is a valid final chunk.
    throw new InvalidCiphertextSizeError(
      `Invalid ciphertext size: ${ciphertextSize}. With chunk size ${chunkSize} (stride ${stride}), the final ` +
        `chunk would be ${r} bytes, which cannot hold a ${TAG_SIZE}-byte tag. Expected a size that is a multiple ` +
        `of ${stride}, or leaves a remainder of at least ${TAG_SIZE}.`
    )
  }

  if (chunkCount > MAX_CHUNK_COUNT) {
    throw new ChunkCountExceededError(`Chunk count ${chunkCount} exceeds the maximum of ${MAX_CHUNK_COUNT}.`)
  }

  const plaintextSize = (chunkCount - 1) * chunkSize + (lastChunkCipherLength - TAG_SIZE)

  return { chunkCount, lastChunkCipherLength, plaintextSize }
}

/**
 * Chunk count an *encoder* writes into the `chunk_count` header for a
 * plaintext of the given length. This is deliberately not the inverse of
 * {@link chunkLayout}: a plaintext that is an exact multiple of the chunk
 * size can be sealed validly as either `k` chunks (last one full) or `k+1`
 * (last one empty, carrying only its tag), and both decrypt to identical
 * bytes. We always WRITE the `k` form here, but a decoder must ACCEPT both —
 * so the header this function produces is checked against
 * `chunkLayout(ciphertextSize, chunkSize).chunkCount`, never against
 * `chunkCountForPlaintext` run in reverse on the plaintext size.
 */
export function chunkCountForPlaintext(plaintextLength: number, chunkSize: number): number {
  if (plaintextLength <= 0) {
    return 1
  }
  return Math.ceil(plaintextLength / chunkSize)
}
