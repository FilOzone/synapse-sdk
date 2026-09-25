/**
 * Chunked AES-256-GCM STREAM encryption (FEE scheme 2) with a caller-supplied
 * CEK, exposed as a `{ writable, readable }` transform: pipe plaintext into
 * `writable`, read the encoded FEE object -- envelope followed by detached,
 * per-chunk-tagged ciphertext -- out of `readable`.
 *
 * `writable` is `internal/chunk-framer.ts`'s framer, so the same block
 * ownership rule applies to whatever is piped in. `readable` drives it: each
 * `pull()` asks the framer for exactly one chunk and encrypts it, so at most
 * one plaintext chunk and one ciphertext chunk exist at a time -- this stays
 * flat in memory regardless of how large the source is.
 */
import { assertValidChunkSize, assertWithinObjectLimit } from './chunk-layout.ts'
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

/** Options for one chunked AES-256-GCM STREAM encryption with a direct CEK. */
export interface ChunkedEncryptOptions {
  /** Exactly 32 bytes and not all-zero. The caller owns its lifecycle and reuse policy. */
  cek: Uint8Array
  /** Plaintext bytes per chunk. Defaults to `DEFAULT_CHUNK_SIZE`. */
  chunkSize?: number
  contentType?: string | number
  /** Authenticated application metadata carried without interpretation. */
  appMetadata?: AppMetadata
}

/**
 * Encrypt an arbitrarily large plaintext as scheme 2, with a direct CEK.
 *
 * Borrows `options.cek` and `options.appMetadata`: the caller must not modify
 * them until `readable` settles (closes or errors). A plaintext block handed
 * to `writable` may be reused once its own `write()` call resolves, per
 * `internal/chunk-framer.ts`'s ownership rule. The base nonce is generated
 * internally here and is never caller-supplied.
 *
 * The final chunk is emitted only once the writable side closes --
 * `ReadableStream.pipeThrough` does this for its source automatically. On any
 * error, whatever `readable` has already produced is an incomplete object:
 * discard it rather than treating it as a usable truncated prefix.
 *
 * Invalid options throw synchronously; the CEK is imported on the first read
 * of `readable`.
 */
export function encrypt(options: ChunkedEncryptOptions): ReadableWritablePair<Uint8Array, Uint8Array> {
  if (options === null || typeof options !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid chunked encryption options: expected an object, got ${describeCborType(options)}.`
    )
  }

  // Read each field once: a getter could otherwise answer differently for
  // validation than for encoding.
  const { cek, chunkSize = DEFAULT_CHUNK_SIZE, contentType, appMetadata } = options
  assertAes256Key(cek, 'CEK')
  assertValidChunkSize(chunkSize)

  const baseNonce = randomBytes(BASE_NONCE_SIZE)
  // Encoding validates contentType and appMetadata, so it runs here with the
  // other synchronous checks, before any crypto.
  const protectedBytes = encodeProtectedHeader({
    alg: ALG_CHUNKED_AES_256_GCM_STREAM,
    iv: baseNonce,
    chunkSize,
    contentType,
    appMetadata,
  })
  // No recipients yet (commit 4): always COSE_Encrypt0, one fixed AAD for
  // every chunk -- the tag and protected bytes never change mid-stream.
  const prepared = assemblePreparedEnvelope(protectedBytes)
  const additionalData = encStructure(prepared.tag, prepared.protectedBytes)

  const framer = createChunkFramer(chunkSize)
  let cekKey: CryptoKey | undefined
  let chunkIndex = 0
  let emittedBytes = 0

  const readable = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (cekKey === undefined) {
            // Deferred to the first pull: no key operation before then.
            cekKey = await importAesGcmKey(cek, 'encrypt', false)
            // Input that already failed (abort, invalid block) gets no envelope.
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
          // Propagate to the writable side too: rejects a pending write, and
          // errors the writable so an upstream `pipeThrough` source stops.
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
