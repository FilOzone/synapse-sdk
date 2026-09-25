/**
 * Chunk layout arithmetic for the chunked AES-256-GCM scheme.
 *
 * A reader needs the full chunk layout — how many chunks, how long the last
 * one is, and the total plaintext size — before decrypting anything, because
 * a chunk's nonce depends on whether it is the last one (see nonce.ts). Two
 * numbers give you the lot: the ciphertext length and the chunk size. See
 * docs/tech-spec.md, "`plaintext_length` and truncation".
 */
import { MAX_CHUNK_COUNT, MAX_CHUNK_SIZE, MAX_ENCODED_OBJECT_SIZE, MIN_CHUNK_SIZE, TAG_SIZE } from './constants.ts'
import {
  ChunkCountExceededError,
  InvalidChunkSizeError,
  InvalidCiphertextLengthError,
  InvalidPlaintextLengthError,
} from './errors.ts'

/**
 * Shared by every entry point that takes a chunk size, in this module and in
 * the chunked encryption stream: one definition so the range and the message
 * cannot drift apart between them.
 */
export function assertValidChunkSize(chunkSize: number): void {
  if (!Number.isInteger(chunkSize) || chunkSize < MIN_CHUNK_SIZE || chunkSize > MAX_CHUNK_SIZE) {
    throw new InvalidChunkSizeError(
      `Invalid chunk size: ${chunkSize}. Must be an integer between ${MIN_CHUNK_SIZE} and ${MAX_CHUNK_SIZE} bytes.`
    )
  }
}

/**
 * Assert that emitting one more chunk keeps the encoded object -- everything
 * emitted so far, envelope included, plus this chunk's ciphertext and tag --
 * within `MAX_ENCODED_OBJECT_SIZE`. Checked before encrypting each chunk, so
 * the limit is enforced before the allocation it would otherwise justify.
 *
 * note: this alone keeps chunk count under `MAX_CHUNK_COUNT` too, but
 * only because 64 GiB / (4 KiB + 16 bytes) is comfortably under 2^32 - 1 at
 * today's `MIN_CHUNK_SIZE`. If either constant ever changes, add an explicit
 * chunk-count check back here; `deriveChunkNonce`'s own index range is the
 * last-resort backstop either way.
 */
export function assertWithinObjectLimit(emittedBytes: number, nextChunkCipherLength: number): void {
  const total = emittedBytes + nextChunkCipherLength
  if (total > MAX_ENCODED_OBJECT_SIZE) {
    throw new InvalidPlaintextLengthError(
      `Invalid chunked object: emitting the next chunk (${nextChunkCipherLength} bytes) would bring the encoded ` +
        `object to ${total} bytes, exceeding the ${MAX_ENCODED_OBJECT_SIZE}-byte limit.`
    )
  }
}

export interface ChunkLayout {
  chunkCount: number
  /** Wire bytes of the final chunk, tag included. */
  lastChunkCipherLength: number
  plaintextLength: number
}

/**
 * Derive the chunk layout of a stored blob from its ciphertext length and
 * chunk size — never the reverse. A declared `plaintext_length` header is
 * checked against what this function derives, not the other way around, or a
 * rewritten header could change which chunk is treated as last and a
 * truncated object would go undetected (docs/tech-spec.md,
 * "`plaintext_length` and truncation").
 *
 * Exactly one ciphertext length represents any given plaintext length; the
 * branches below say how.
 */
export function chunkLayout(ciphertextLength: number, chunkSize: number): ChunkLayout {
  assertValidChunkSize(chunkSize)
  if (!Number.isSafeInteger(ciphertextLength) || ciphertextLength < 0) {
    throw new InvalidCiphertextLengthError(
      `Invalid ciphertext length: ${ciphertextLength}. Must be a non-negative safe integer.`
    )
  }
  // Necessary, not sufficient — see MAX_ENCODED_OBJECT_SIZE.
  if (ciphertextLength > MAX_ENCODED_OBJECT_SIZE) {
    throw new InvalidCiphertextLengthError(
      `Invalid ciphertext length: ${ciphertextLength}. The detached ciphertext alone exceeds the ` +
        `${MAX_ENCODED_OBJECT_SIZE}-byte encoded-object limit, which also has to cover the envelope.`
    )
  }

  const stride = chunkSize + TAG_SIZE
  const q = Math.floor(ciphertextLength / stride)
  const r = ciphertextLength % stride

  let chunkCount: number
  let lastChunkCipherLength: number

  if (r === 0 && q >= 1) {
    // Exact multiple of the stride: every chunk, including the last, is full.
    chunkCount = q
    lastChunkCipherLength = stride
  } else if (r === TAG_SIZE && q >= 1) {
    // A tag-only chunk following at least one full chunk: an empty terminal
    // chunk. Valid CBOR, valid tags, and still rejected — it is the second
    // representation of a plaintext the `k`-chunk form already encodes.
    throw new InvalidCiphertextLengthError(
      `Invalid ciphertext length: ${ciphertextLength}. With chunk size ${chunkSize} (stride ${stride}), the final ` +
        `chunk would be ${TAG_SIZE} bytes of tag and no plaintext, following ${q} full chunk(s). A tag-only ` +
        'final chunk is valid only as the sole chunk of an empty object.'
    )
  } else if (r > TAG_SIZE) {
    // A short final chunk, carrying at least one plaintext byte plus its tag.
    chunkCount = q + 1
    lastChunkCipherLength = r
  } else if (r === TAG_SIZE) {
    // q === 0: the sole chunk of an empty object.
    chunkCount = 1
    lastChunkCipherLength = TAG_SIZE
  } else {
    // Either no ciphertext at all (r === 0, q === 0) or a remainder too
    // small to contain a tag (1..15 bytes) — neither is a valid final chunk.
    throw new InvalidCiphertextLengthError(
      `Invalid ciphertext length: ${ciphertextLength}. With chunk size ${chunkSize} (stride ${stride}), the final ` +
        `chunk would be ${r} bytes, which cannot hold a ${TAG_SIZE}-byte tag. Expected a nonzero multiple of ` +
        `${stride}, a remainder above ${TAG_SIZE}, or exactly ${TAG_SIZE} bytes in total for an empty object.`
    )
  }

  if (chunkCount > MAX_CHUNK_COUNT) {
    throw new ChunkCountExceededError(`Chunk count ${chunkCount} exceeds the maximum of ${MAX_CHUNK_COUNT}.`)
  }

  const plaintextLength = (chunkCount - 1) * chunkSize + (lastChunkCipherLength - TAG_SIZE)

  return { chunkCount, lastChunkCipherLength, plaintextLength }
}

/**
 * Chunk count for a plaintext of the given length: `max(1, ceil(P / S))`.
 * The `max` matters — `ceil(0 / S)` is zero, and empty plaintext is still
 * one chunk, carrying nothing but its tag.
 *
 * Use this to *predict* a layout from a plaintext length, never to validate
 * a stored one. A declared `plaintext_length` is checked through
 * {@link ciphertextLengthForPlaintext} against the observed ciphertext
 * length, never by running this in reverse.
 */
export function chunkCountForPlaintext(plaintextLength: number, chunkSize: number): number {
  if (!Number.isSafeInteger(plaintextLength) || plaintextLength < 0) {
    throw new InvalidPlaintextLengthError(
      `Invalid plaintext length: ${plaintextLength}. Must be a non-negative safe integer.`
    )
  }
  assertValidChunkSize(chunkSize)

  const chunkCount = plaintextLength === 0 ? 1 : Math.ceil(plaintextLength / chunkSize)
  if (chunkCount > MAX_CHUNK_COUNT) {
    throw new ChunkCountExceededError(`Chunk count ${chunkCount} exceeds the maximum of ${MAX_CHUNK_COUNT}.`)
  }
  return chunkCount
}

/**
 * Detached ciphertext length a plaintext of `plaintextLength` bytes produces
 * at `chunkSize`: `P + 16 × max(1, ceil(P / S))`, one tag per chunk.
 *
 * This is what makes a declared `plaintext_length` checkable. The mapping is
 * strictly increasing in `P`, so one ciphertext length admits exactly one
 * valid `P` — which holds only because the profile permits a single
 * final-chunk form (see {@link chunkLayout}). An unsafe result is rejected
 * rather than returned: past `Number.MAX_SAFE_INTEGER` a length rounds
 * silently instead of failing.
 */
export function ciphertextLengthForPlaintext(plaintextLength: number, chunkSize: number): number {
  const chunkCount = chunkCountForPlaintext(plaintextLength, chunkSize)
  const ciphertextLength = plaintextLength + TAG_SIZE * chunkCount
  if (!Number.isSafeInteger(ciphertextLength)) {
    throw new InvalidPlaintextLengthError(
      `Invalid plaintext length: ${plaintextLength}. The ciphertext length it implies is not a safe integer.`
    )
  }
  // Necessary, not sufficient — see MAX_ENCODED_OBJECT_SIZE.
  if (ciphertextLength > MAX_ENCODED_OBJECT_SIZE) {
    throw new InvalidPlaintextLengthError(
      `Invalid plaintext length: ${plaintextLength}. The detached ciphertext it implies (${ciphertextLength} ` +
        `bytes) alone exceeds the ${MAX_ENCODED_OBJECT_SIZE}-byte encoded-object limit, which also has to ` +
        'cover the envelope.'
    )
  }
  return ciphertextLength
}
