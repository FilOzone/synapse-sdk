/**
 * Error hierarchy for the Filecoin Encryption Envelope.
 *
 * Every subclass carries a message that states the offending value and the
 * expected range or shape, plus an optional `cause` (standard `ErrorOptions`)
 * for wrapping a lower-level failure.
 */

/** Base class for every error raised by this package. */
export class EnvelopeError extends Error {
  override name = 'EnvelopeError'
}

/** `chunkSize` is not an integer within `[MIN_CHUNK_SIZE, MAX_CHUNK_SIZE]`. */
export class InvalidChunkSizeError extends EnvelopeError {
  override name = 'InvalidChunkSizeError'
}

/**
 * `ciphertextSize` is not a valid ciphertext length for the given chunk
 * size — negative, not a safe integer, or too short to hold a final chunk's
 * authentication tag.
 */
export class InvalidCiphertextSizeError extends EnvelopeError {
  override name = 'InvalidCiphertextSizeError'
}

/** The derived or declared chunk count exceeds `MAX_CHUNK_COUNT`. */
export class ChunkCountExceededError extends EnvelopeError {
  override name = 'ChunkCountExceededError'
}

/** A base nonce or chunk index is not valid for per-chunk nonce derivation. */
export class InvalidNonceError extends EnvelopeError {
  override name = 'InvalidNonceError'
}
