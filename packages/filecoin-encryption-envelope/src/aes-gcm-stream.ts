/**
 * Chunked AES-256-GCM STREAM encryption (FEE scheme 2) using a caller-supplied
 * CEK. Plaintext is written to `writable`; `readable` outputs the encoded FEE
 * object: the envelope followed by detached, per-chunk-tagged ciphertext.
 *
 * `writable` uses the framer from `internal/chunk-framer.ts`, so its block
 * ownership rules apply to whatever is piped in. Each `readable` pull requests and
 * encrypts one chunk, keeping memory bounded regardless of source size.
 */
import {
  assertValidChunkSize,
  assertWithinObjectLimit,
  chunkLayout,
  ciphertextLengthForPlaintext,
} from './chunk-layout.ts'
import {
  ALG_CHUNKED_AES_256_GCM_STREAM,
  BASE_NONCE_SIZE,
  DEFAULT_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  TAG_SIZE,
} from './constants.ts'
import type { DecodedEnvelope } from './cose/decode.ts'
import { encStructure } from './cose/enc-structure.ts'
import { assemblePreparedEnvelope, type PreparedEnvelope, type RecipientInput } from './cose/encode.ts'
import { createEnvelopeScanner } from './cose/envelope-scanner.ts'
import type { AppMetadata } from './cose/headers.ts'
import { describeCborType, encodeProtectedHeader } from './cose/headers.ts'
import { InvalidCiphertextLengthError, MalformedEnvelopeError, UnsupportedSchemeError } from './errors.ts'
import { type ChunkFramer, createChunkFramer } from './internal/chunk-framer.ts'
import { assertAes256Key, assertArrayBufferBacked } from './internal/keys.ts'
import { aesGcmDecrypt, aesGcmEncrypt, importAesGcmKey, randomBytes } from './internal/web-crypto.ts'
import { deriveChunkNonce } from './nonce.ts'
import { createRecipientRecords, prepareRecipientInputs } from './recipients/prepare.ts'
import type { Recipient } from './recipients/types.ts'

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

  /**
   * Wrap the CEK for each recipient and write `COSE_Encrypt` (tag 96).
   * Omit for `COSE_Encrypt0` (tag 16); an empty array is rejected.
   */
  recipients?: readonly Recipient[]
}

/**
 * Encrypt a plaintext stream using scheme 2 (chunked AES-256-GCM STREAM) and
 * a direct CEK.
 *
 * Returns a `{ writable, readable }` pair for
 * `source.pipeThrough(encrypt(options))`. Plaintext goes in; the FEE envelope
 * followed by one encrypted chunk at a time comes out.
 *
 * - Invalid options throw synchronously. Key work happens on the first read:
 *   importing the CEK and, with `recipients`, wrapping it. With recipients the
 *   `contentLength` total-size check also waits for that read (the envelope
 *   size isn't known before), but still fails before any output.
 * - Every buffer in `options` (the CEK, recipient KEKs and kids, metadata) is
 *   borrowed and read as late as the first read: don't change or clear it
 *   until `readable` closes or errors. Input blocks may be reused once their
 *   `write()` resolves.
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
  const {
    cek,
    chunkSize = DEFAULT_CHUNK_SIZE,
    contentType,
    appMetadata,
    contentLength,
    recipients: recipientInputs,
  } = options
  assertAes256Key(cek, 'CEK')
  const recipients = prepareRecipientInputs(recipientInputs)
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

  // Assemble the envelope and, when the length is declared, check the whole
  // object against the 64 GiB limit before any output.
  function assembleChecked(records?: RecipientInput[]): PreparedEnvelope {
    const envelope = assemblePreparedEnvelope(protectedBytes, records)
    if (expectedCiphertextLength !== undefined) {
      assertWithinObjectLimit(envelope.bytes.length, expectedCiphertextLength)
    }
    return envelope
  }

  // Without recipients the envelope needs no key, so build it now. With
  // recipients it waits for the first read, once the CEK can be wrapped.
  const directEnvelope = recipients === undefined ? assembleChecked() : undefined

  const framer = createChunkFramer(chunkSize, contentLength)
  let keyed: { cekKey: CryptoKey; additionalData: Uint8Array<ArrayBuffer> } | undefined
  let chunkIndex = 0
  let emittedBytes = 0

  const readable = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (keyed === undefined) {
            // First read: import the CEK (extractable only when wrapKey needs
            // it), wrap it for each recipient, and emit the envelope. Failed
            // input is checked before the import and before each recipient,
            // so a cancel stops the work after at most one recipient's KEK
            // import and wrap.
            framer.throwIfFailed()
            const cekKey = await importAesGcmKey(cek, 'encrypt', recipients !== undefined)
            const records =
              recipients === undefined
                ? undefined
                : await createRecipientRecords(cekKey, recipients, framer.throwIfFailed)
            const envelope = directEnvelope ?? assembleChecked(records)

            // Do not emit the envelope if input has already failed.
            framer.throwIfFailed()
            keyed = { cekKey, additionalData: encStructure(envelope.tag, envelope.protectedBytes) }
            controller.enqueue(envelope.bytes)
            emittedBytes = envelope.bytes.length
            return
          }

          const { cekKey, additionalData } = keyed
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

/** What the input side hands the output side once the envelope completes. */
interface OpenedEnvelope {
  decoded: DecodedEnvelope
  framer: ChunkFramer
  chunkSize: number
}

function assertValidEncodedBlock(value: unknown): asserts value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(
      `Invalid encoded object block: expected a Uint8Array, got ${describeCborType(value)}.`
    )
  }
  assertArrayBufferBacked(value, 'encoded object block', (message) => new MalformedEnvelopeError(message))
}

/**
 * Build the `{ writable, readable }` pair shared by `decrypt` and (later)
 * `decryptWith`. `getCekKey` is the only thing that differs between them:
 * given the decoded envelope, resolve the `CryptoKey` to decrypt with.
 *
 * `writable` scans incoming blocks for the envelope (`cose/envelope-scanner.ts`),
 * then reuses `internal/chunk-framer.ts` -- configured for ciphertext chunks
 * (`chunk_size + TAG_SIZE`), not plaintext ones -- to reframe whatever
 * follows into fixed-size pieces. `readable` decrypts one piece per pull.
 */
function createDecryptStream(
  getCekKey: (decoded: DecodedEnvelope) => Promise<CryptoKey>
): ReadableWritablePair<Uint8Array, Uint8Array> {
  const scanner = createEnvelopeScanner()

  let receivedTotal = 0
  // Only known once the envelope completes and declares plaintext_length.
  let expectedTotal: number | undefined
  // Set once the envelope completes: the framer for the ciphertext after it.
  let input: { framer: ChunkFramer; writer: WritableStreamDefaultWriter<Uint8Array> } | undefined
  let outerController: WritableStreamDefaultController | undefined

  let resolveHandoff: ((opened: OpenedEnvelope) => void) | undefined
  let rejectHandoff: ((reason: unknown) => void) | undefined
  const handoff = new Promise<OpenedEnvelope>((resolve, reject) => {
    resolveHandoff = resolve
    rejectHandoff = reject
  })
  handoff.catch(() => {
    // A stream nobody reads from must not surface an unhandled rejection.
  })
  let handoffSettled = false

  /**
   * Used when the writable side is already failing on its own (the abort
   * signal, or a write()/close() throw, which auto-errors the stream it
   * throws from) -- must NOT also call `outerController.error()` here, or
   * it reenters that same stream's own abort machinery mid-abort.
   */
  function failInput(reason: unknown): void {
    if (!handoffSettled) {
      handoffSettled = true
      rejectHandoff?.(reason)
    }
    input?.framer.cancel(reason)
  }

  function assertWithinDeclaredLength(): void {
    if (expectedTotal !== undefined && receivedTotal > expectedTotal) {
      throw new InvalidCiphertextLengthError(
        `Invalid encoded object: received ${receivedTotal} bytes, but the declared plaintext_length implies a ` +
          `total of at most ${expectedTotal} bytes.`
      )
    }
  }

  /** Used when the failure originates on the read side and needs to reach an otherwise-healthy writable. */
  function fail(reason: unknown): void {
    failInput(reason)
    // A no-op on an already errored or closed stream, per the Streams spec.
    outerController?.error(reason)
  }

  const writable = new WritableStream<Uint8Array>({
    start(controller) {
      outerController = controller
      // Same reasoning as the framer's own listener: abort() itself waits
      // for an in-flight write, which only settles once the reader pulls.
      controller.signal.addEventListener('abort', () => failInput(controller.signal.reason))
    },
    async write(block) {
      // Wrapped so any failure here -- not just a framer/output failure --
      // also rejects a read still waiting on the envelope handoff, instead
      // of leaving it pending forever.
      try {
        assertValidEncodedBlock(block)
        receivedTotal += block.length
        if (receivedTotal > MAX_ENCODED_OBJECT_SIZE) {
          throw new InvalidCiphertextLengthError(
            `Invalid encoded object: received ${receivedTotal} bytes, exceeding the ${MAX_ENCODED_OBJECT_SIZE}-byte limit.`
          )
        }
        assertWithinDeclaredLength()

        if (input === undefined) {
          // Still scanning for the envelope. `scanner.push` copies whatever
          // it needs synchronously, so a block is fully released the moment
          // this returns -- nothing to await unless the envelope just
          // completed with ciphertext already attached (`rest`, below).
          const result = scanner.push(block)
          if (result === undefined) return

          const { decoded, rest } = result
          if (decoded.protectedHeader.alg !== ALG_CHUNKED_AES_256_GCM_STREAM) {
            throw new UnsupportedSchemeError(
              `Unsupported content algorithm ${decoded.protectedHeader.alg}: chunked decryption requires alg ${ALG_CHUNKED_AES_256_GCM_STREAM}.`
            )
          }
          // The decoder requires chunk_size for the chunked alg.
          const chunkSize = decoded.protectedHeader.chunkSize
          if (chunkSize === undefined) {
            throw new Error('unreachable: the chunked alg always carries chunk_size')
          }
          const { plaintextLength } = decoded.protectedHeader
          if (plaintextLength !== undefined) {
            expectedTotal = decoded.envelopeLength + ciphertextLengthForPlaintext(plaintextLength, chunkSize)
            assertWithinDeclaredLength()
          }

          const framer = createChunkFramer(chunkSize + TAG_SIZE)
          input = { framer, writer: framer.writable.getWriter() }
          resolveHandoff?.({ decoded, framer, chunkSize })

          if (rest.length > 0) {
            await input.writer.write(rest)
          }
          return
        }

        await input.writer.write(block)
      } catch (cause) {
        // The throw below auto-errors this writable; failInput just needs
        // to reject a still-pending envelope handoff and stop the framer.
        failInput(cause)
        throw cause
      }
    },
    async close() {
      if (input === undefined) {
        // Always throws: input would already be set otherwise. Routed
        // through `failInput` too, so a read still waiting on the envelope
        // handoff rejects instead of hanging forever.
        try {
          scanner.finish()
        } catch (cause) {
          failInput(cause)
          throw cause
        }
        return
      }
      await input.writer.close()
    },
  })

  let keyed:
    | {
        framer: ChunkFramer
        cekKey: CryptoKey
        additionalData: Uint8Array<ArrayBuffer>
        baseNonce: Uint8Array
        chunkSize: number
        plaintextLength: number | undefined
      }
    | undefined
  let chunkIndex = 0
  let receivedCiphertext = 0

  const readable = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          if (keyed === undefined) {
            const { decoded, framer, chunkSize } = await handoff
            // Do not start key work for input that has already failed.
            framer.throwIfFailed()
            const cekKey = await getCekKey(decoded)
            keyed = {
              framer,
              cekKey,
              additionalData: encStructure(decoded.tag, decoded.protectedHeader.bytes),
              // Copied: retained for every chunk over the life of the stream.
              baseNonce: new Uint8Array(decoded.protectedHeader.iv),
              chunkSize,
              plaintextLength: decoded.protectedHeader.plaintextLength,
            }
            // Fall through into the chunk step below, in the same pull.
          }

          const { framer, cekKey, additionalData, baseNonce, chunkSize, plaintextLength } = keyed
          const { bytes, isLast } = await framer.next()
          receivedCiphertext += bytes.length
          if (isLast) {
            // Validates the total shape (a bare tag, a short remainder, and
            // so on) before anything about this last chunk is trusted.
            const layout = chunkLayout(receivedCiphertext, chunkSize)
            if (plaintextLength !== undefined && layout.plaintextLength !== plaintextLength) {
              throw new InvalidCiphertextLengthError(
                `Invalid encoded object: the ciphertext implies a plaintext of ${layout.plaintextLength} bytes, ` +
                  `but the declared plaintext_length is ${plaintextLength}.`
              )
            }
          }

          // The header never picks the final chunk; only running out of
          // input (the framer's own `isLast`) does.
          const nonce = deriveChunkNonce(baseNonce, chunkIndex, isLast)
          const plaintext = await aesGcmDecrypt(cekKey, nonce, additionalData, bytes)
          if (plaintext.length > 0) {
            controller.enqueue(plaintext)
          }
          chunkIndex++
          if (isLast) {
            controller.close()
          }
        } catch (cause) {
          // Propagate to the writable side too: rejects a pending write, and
          // errors it so an upstream `pipeThrough` source stops.
          fail(cause)
          throw cause
        }
      },
      cancel(reason) {
        fail(reason)
      },
    },
    { highWaterMark: 0 }
  )

  return { writable, readable }
}

/**
 * Decrypt a scheme-2 (chunked AES-256-GCM STREAM) object using a direct CEK.
 *
 * Returns a `{ writable, readable }` pair for
 * `source.pipeThrough(decrypt(cek))`. The encoded FEE object (envelope
 * followed by detached, per-chunk-tagged ciphertext) goes in; plaintext comes
 * out, one chunk at a time, each only once its own authentication tag verifies.
 *
 * - `cek` is borrowed until `readable` settles (closes or errors); input
 *   blocks may be reused once their `write()` resolves.
 * - If the stream errors, discard everything already read: earlier chunks
 *   were individually authentic, but the object as a whole was not.
 *   Different truncations surface as different errors -- a torn final chunk
 *   as `AuthenticationError`, a length that doesn't add up as
 *   `InvalidCiphertextLengthError` -- but any error means reject the whole
 *   object, not just treat it as ending early.
 */
export function decrypt(cek: Uint8Array): ReadableWritablePair<Uint8Array, Uint8Array> {
  assertAes256Key(cek, 'CEK')
  return createDecryptStream(() => importAesGcmKey(cek, 'decrypt', false))
}
