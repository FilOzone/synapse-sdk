/**
 * Per-chunk nonce derivation for the chunked AES-256-GCM scheme.
 *
 * The nonce is the only thing binding a chunk to its position, which is what
 * detects reordering, insertion and truncation — every chunk shares the same
 * AAD, see docs/tech-spec.md, "Per-chunk nonce".
 */
import { BASE_NONCE_SIZE, MAX_CHUNK_COUNT, NONCE_SIZE } from './constants.ts'
import { InvalidNonceError } from './errors.ts'

/**
 * Derive the 12-byte AEAD nonce for one chunk:
 * `baseNonce (7) ‖ chunkIndex (4, big-endian) ‖ last_flag (1)`.
 *
 * Returns a freshly allocated array; `baseNonce` is never mutated.
 */
export function deriveChunkNonce(baseNonce: Uint8Array, chunkIndex: number, isLast: boolean): Uint8Array {
  if (baseNonce.length !== BASE_NONCE_SIZE) {
    throw new InvalidNonceError(
      `Invalid base nonce length: ${baseNonce.length}. Expected exactly ${BASE_NONCE_SIZE} bytes.`
    )
  }
  if (!Number.isInteger(chunkIndex) || chunkIndex < 0 || chunkIndex > MAX_CHUNK_COUNT - 1) {
    throw new InvalidNonceError(
      `Invalid chunk index: ${chunkIndex}. Must be an integer between 0 and ${MAX_CHUNK_COUNT - 1}.`
    )
  }

  const nonce = new Uint8Array(NONCE_SIZE)
  nonce.set(baseNonce, 0)

  // chunk_index is big-endian per the wire format; last_flag follows as a single byte.
  const view = new DataView(nonce.buffer, nonce.byteOffset, nonce.byteLength)
  view.setUint32(BASE_NONCE_SIZE, chunkIndex, false)
  nonce[BASE_NONCE_SIZE + 4] = isLast ? 0x01 : 0x00

  return nonce
}
