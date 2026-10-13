/**
 * Catch {@link EnvelopeError} to catch everything this package throws.
 *
 * When adding a subclass: its message states the offending value and the
 * range or shape that was expected.
 */

/** Base class for every error raised by this package. */
export class EnvelopeError extends Error {
  override name = 'EnvelopeError'
}

/** A CEK is not a 32-byte, non-zero AES-256 key. */
export class InvalidKeyError extends EnvelopeError {
  override name = 'InvalidKeyError'
}

/** Plaintext supplied to an encryption operation is not a byte string. */
export class InvalidPlaintextError extends EnvelopeError {
  override name = 'InvalidPlaintextError'
}

/** A cryptographic runtime operation failed for a reason other than authentication. */
export class CryptoOperationError extends EnvelopeError {
  override name = 'CryptoOperationError'
}

/**
 * AEAD authentication failed. A wrong key and modified authenticated data
 * are intentionally reported as the same error.
 */
export class AuthenticationError extends EnvelopeError {
  override name = 'AuthenticationError'
}

/** `chunkSize` is not an integer within `[MIN_CHUNK_SIZE, MAX_CHUNK_SIZE]`. */
export class InvalidChunkSizeError extends EnvelopeError {
  override name = 'InvalidChunkSizeError'
}

/** The ciphertext length cannot represent a valid object for the selected scheme. */
export class InvalidCiphertextLengthError extends EnvelopeError {
  override name = 'InvalidCiphertextLengthError'
}

/** A chunk count derived from a plaintext or ciphertext length exceeds `MAX_CHUNK_COUNT`. */
export class ChunkCountExceededError extends EnvelopeError {
  override name = 'ChunkCountExceededError'
}

/**
 * `plaintextLength` is not a non-negative safe integer or exceeds the limit
 * for the selected scheme or encoded layout.
 */
export class InvalidPlaintextLengthError extends EnvelopeError {
  override name = 'InvalidPlaintextLengthError'
}

/** A base nonce, chunk index, or last-chunk flag is not valid for per-chunk nonce derivation. */
export class InvalidNonceError extends EnvelopeError {
  override name = 'InvalidNonceError'
}

/**
 * The envelope, or a value destined for one, does not match this package's
 * wire profile. Raised on both paths: by encode when a caller's input would
 * produce bytes this package could not read back, and by decode on anything
 * the profile forbids.
 *
 * Always thrown before any AEAD tag is checked, so it says nothing about
 * authenticity.
 */
export class MalformedEnvelopeError extends EnvelopeError {
  override name = 'MalformedEnvelopeError'
}

/**
 * The protected header's `alg` is not one of the schemes this package
 * implements (`ALG_AES_256_GCM` or `ALG_CHUNKED_AES_256_GCM_STREAM`).
 */
export class UnsupportedSchemeError extends EnvelopeError {
  override name = 'UnsupportedSchemeError'
}

/**
 * A `crit` (label 2) listing was rejected — wrong bucket, wrong shape, or
 * naming a label this profile does not understand or does not actually carry.
 *
 * Note what is *not* an error: a `crit` naming only understood, present
 * labels (`[16]` for `typ`) is satisfiable and must be accepted.
 */
export class CriticalHeaderError extends EnvelopeError {
  override name = 'CriticalHeaderError'
}
