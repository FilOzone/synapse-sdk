/**
 * Chunked AES-256-GCM STREAM encryption (FEE scheme 2) using a caller-supplied
 * CEK. Plaintext is written to `writable`; `readable` outputs the encoded FEE
 * object: the envelope followed by detached, per-chunk-tagged ciphertext.
 *
 * `writable` uses the framer from `internal/chunk-framer.ts`, so its block
 * ownership rules apply to whatever is piped in. Each `readable` pull requests and
 * encrypts one chunk, keeping memory bounded regardless of source size.
 */
import { assertValidChunkSize, assertWithinObjectLimit, ciphertextLengthForPlaintext } from './chunk-layout.ts'
import { ALG_CHUNKED_AES_256_GCM_STREAM, BASE_NONCE_SIZE, DEFAULT_CHUNK_SIZE, TAG_SIZE } from './constants.ts'
import { encStructure } from './cose/enc-structure.ts'
import { assemblePreparedEnvelope } from './cose/encode.ts'
import type { AppMetadata } from './cose/headers.ts'
import { describeCborType, encodeProtectedHeader } from './cose/headers.ts'
import { MalformedEnvelopeError } from './errors.ts'
import { createChunkFramer } from './internal/chunk-framer.ts'
import { assertAes256Key } from './internal/keys.ts'
import { aesGcmEncrypt, importAesGcmKey, randomBytes } from './internal/web-crypto.ts'
import { deriveChunkNonce } from './nonce.ts'

/** Options for one chunked AES-256-GCM STREAM encryption using a direct CEK. */
export interface ChunkedEncryptOptions {
  /** Exactly 32 bytes and not all-zero. The caller owns its lifecycle and reuse policy. */
  cek: Uint8Array

  /** Plaintext bytes per chunk. Defaults to `DEFAULT_CHUNK_SIZE`. */
  chunkSize?: number

  contentType?: string | number

  /** Authenticated application metadata carried without interpretation. */
  appMetadata?: AppMetadata

  /**
   * Exact plaintext length, if known up front. Stored in the authenticated
   * `plaintext_length` header. Exceeding it fails the write; closing before
   * reaching it fails the close. In either case, no final chunk is emitted
   * and earlier output must be discarded. Omit if the length is not guaranteed.
   */
  contentLength?: number
}

/**
 * Encrypt a plaintext stream using scheme 2 (chunked AES-256-GCM STREAM) and
 * a direct CEK.
 *
 * Returns a `{ writable, readable }` pair for
 * `source.pipeThrough(encrypt(options))`. Plaintext goes in; the FEE envelope
 * followed by one encrypted chunk at a time comes out.
 *
 * - Invalid options throw synchronously; the CEK is imported on the first read.
 * - `cek` and `appMetadata` are borrowed and must not change until `readable`
 *   closes or errors. Input blocks may be reused once their `write()` resolves.
 * - The base nonce is always generated internally.
 * - The final chunk is emitted only after `writable` closes.
 * - If the stream errors, any output already read is incomplete and must be discarded.
 */
export function encrypt(options: ChunkedEncryptOptions): ReadableWritablePair<Uint8Array, Uint8Array> {
  if (options === null || typeof options !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid chunked encryption options: expected an object, got ${describeCborType(options)}.`
    )
  }

  // Read each field once so getters cannot return different values during
  // validation and encoding.
  const { cek, chunkSize = DEFAULT_CHUNK_SIZE, contentType, appMetadata, contentLength } = options
  assertAes256Key(cek, 'CEK')
  assertValidChunkSize(chunkSize)

  // Validate the option directly to preserve its length-specific errors.
  // `encodeProtectedHeader` validates it again as a header value below.
  const expectedCiphertextLength =
    contentLength === undefined ? undefined : ciphertextLengthForPlaintext(contentLength, chunkSize)

  const baseNonce = randomBytes(BASE_NONCE_SIZE)

  // Encode now so content type and metadata are validated synchronously,
  // before any cryptographic work.
  const protectedBytes = encodeProtectedHeader({
    alg: ALG_CHUNKED_AES_256_GCM_STREAM,
    iv: baseNonce,
    chunkSize,
    contentType,
    appMetadata,
    plaintextLength: contentLength,
  })

  // Without recipients, use COSE_Encrypt0 and one fixed AAD for every chunk.
  const prepared = assemblePreparedEnvelope(protectedBytes)
  const additionalData = encStructure(prepared.tag, prepared.protectedBytes)

  // If the plaintext length is known, validate the complete encoded object
  // before streaming begins.
  if (expectedCiphertextLength !== undefined) {
    assertWithinObjectLimit(prepared.bytes.length, expectedCiphertextLength)
  }

  const framer = createChunkFramer(chunkSize, contentLength)
  let cekKey: CryptoKey | undefined
  let chunkIndex = 0
  let emittedBytes = 0

  const readable = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (cekKey === undefined) {
            // Defer key import until the first pull.
            cekKey = await importAesGcmKey(cek, 'encrypt', false)

            // Do not emit the envelope if input has already failed.
            framer.throwIfFailed()
            controller.enqueue(prepared.bytes)
            emittedBytes = prepared.bytes.length
            return
          }

          const { bytes, isLast } = await framer.next()
          assertWithinObjectLimit(emittedBytes, bytes.length + TAG_SIZE)
          const nonce = deriveChunkNonce(baseNonce, chunkIndex, isLast)
          const ciphertext = await aesGcmEncrypt(cekKey, nonce, additionalData, bytes)
          controller.enqueue(ciphertext)
          emittedBytes += ciphertext.length
          chunkIndex++
          if (isLast) {
            controller.close()
          }
        } catch (cause) {
          // Propagate output failures to the writable side so pending writes
          // reject and an upstream `pipeThrough` source stops.
          framer.cancel(cause)
          throw cause
        }
      },
      cancel(reason) {
        framer.cancel(reason)
      },
    },
    { highWaterMark: 0 }
  )

  return { writable: framer.writable, readable }
}