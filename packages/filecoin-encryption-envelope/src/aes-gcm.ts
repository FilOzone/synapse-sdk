/**
 * Whole-object AES-256-GCM encryption and decryption (FEE scheme 1).
 *
 * This module orchestrates scheme 1 — IV generation, COSE framing, AAD
 * construction — and delegates Web Crypto calls to `internal/web-crypto.ts`.
 * Encryption returns one encoded FEE object: envelope, detached ciphertext,
 * and its 16-byte tag. Decryption accepts that layout and either a directly
 * supplied CEK (`decrypt`) or a CEK recovered from a recipient (`decryptWith`).
 */
import { ALG_AES_256_GCM, MAX_AES_GCM_PLAINTEXT_SIZE, NONCE_SIZE, TAG_SIZE } from './constants.ts'
import { TAG_ENCRYPT0 } from './cose/constants.ts'
import { type DecodedEnvelope, decodeEnvelope } from './cose/decode.ts'
import { encStructure } from './cose/enc-structure.ts'
import { assemblePreparedEnvelope } from './cose/encode.ts'
import type { AppMetadata } from './cose/headers.ts'
import { describeCborType, encodeProtectedHeader } from './cose/headers.ts'
import {
  InvalidCiphertextLengthError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
  NoUsableRecipientError,
  RecipientUnwrapError,
  UnsupportedSchemeError,
} from './errors.ts'
import { assertAes256Key, assertArrayBufferBacked } from './internal/keys.ts'
import { aesGcmDecrypt, aesGcmEncrypt, importAesGcmKey, randomBytes } from './internal/web-crypto.ts'
import { toRecipientInfo } from './recipients/info.ts'
import { createRecipientRecords, prepareRecipientInputs } from './recipients/prepare.ts'
import type { Recipient, Unwrapper } from './recipients/types.ts'

const MAX_AES_GCM_CIPHERTEXT_SIZE = MAX_AES_GCM_PLAINTEXT_SIZE + TAG_SIZE

/** Options for one whole-object AES-256-GCM encryption. */
export interface EncryptOptions {
  /** Exactly 32 bytes and not all-zero. The caller owns its lifecycle and reuse policy. */
  cek: Uint8Array
  contentType?: string | number
  /** Authenticated application metadata carried without interpretation. */
  appMetadata?: AppMetadata
  /**
   * Wrap the CEK for each recipient and write `COSE_Encrypt` (tag 96).
   * Omit for `COSE_Encrypt0` (tag 16); an empty array is rejected.
   */
  recipients?: readonly Recipient[]
}

function assertValidPlaintext(value: unknown): asserts value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidPlaintextError(`Invalid plaintext: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  assertArrayBufferBacked(value, 'plaintext', (message) => new InvalidPlaintextError(message))
  if (value.length > MAX_AES_GCM_PLAINTEXT_SIZE) {
    throw new InvalidPlaintextLengthError(
      `Invalid plaintext length ${value.length}: scheme 1 accepts at most ${MAX_AES_GCM_PLAINTEXT_SIZE} bytes.`
    )
  }
}

/** Length-check only; the returned value is a view into `encoded`, not a copy. */
function sliceCiphertext(encoded: Uint8Array, envelopeLength: number): Uint8Array<ArrayBuffer> {
  const ciphertextLength = encoded.length - envelopeLength
  if (ciphertextLength < TAG_SIZE || ciphertextLength > MAX_AES_GCM_CIPHERTEXT_SIZE) {
    throw new InvalidCiphertextLengthError(
      `Invalid AES-GCM ciphertext length ${ciphertextLength}: expected between ${TAG_SIZE} and ` +
        `${MAX_AES_GCM_CIPHERTEXT_SIZE} bytes, including the ${TAG_SIZE}-byte authentication tag.`
    )
  }
  return encoded.subarray(envelopeLength) as Uint8Array<ArrayBuffer>
}

function joinEnvelopeAndCiphertext(envelope: Uint8Array, ciphertext: Uint8Array): Uint8Array {
  const result = new Uint8Array(envelope.length + ciphertext.length)
  result.set(envelope)
  result.set(ciphertext, envelope.length)
  return result
}

/**
 * Encrypt a complete plaintext as scheme 1 and return `envelope || ciphertext`.
 *
 * Borrows its inputs: callers must not modify plaintext, keys, recipients or
 * metadata until the promise settles. The IV is always generated internally
 * and cannot be provided by the caller.
 */
export async function encrypt(plaintext: Uint8Array, options: EncryptOptions): Promise<Uint8Array> {
  if (options === null || typeof options !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid AES-GCM encryption options: expected an object, got ${describeCborType(options)}.`
    )
  }

  const { cek, contentType, appMetadata, recipients: recipientInputs } = options
  assertValidPlaintext(plaintext)
  assertAes256Key(cek, 'CEK')
  const recipients = prepareRecipientInputs(recipientInputs)

  const iv = randomBytes(NONCE_SIZE)
  // Encoding validates contentType and appMetadata, so it runs here with the
  // other synchronous checks, before any crypto.
  const protectedBytes = encodeProtectedHeader({
    alg: ALG_AES_256_GCM,
    iv,
    contentType,
    appMetadata,
  })

  // The CEK is imported once, only after all synchronous validation passes.
  // Extractable when there are recipients: Web Crypto's wrapKey requires it.
  const hasRecipients = recipients !== undefined
  const cekKey = await importAesGcmKey(cek, 'encrypt', hasRecipients)
  const records = hasRecipients ? await createRecipientRecords(cekKey, recipients) : undefined

  // Fails on the envelope-size limit here, before any content encryption.
  const prepared = assemblePreparedEnvelope(protectedBytes, records)
  const additionalData = encStructure(prepared.tag, prepared.protectedBytes)
  const ciphertext = await aesGcmEncrypt(cekKey, iv, additionalData, plaintext)

  return joinEnvelopeAndCiphertext(prepared.bytes, ciphertext)
}

/** Values `decrypt` and `decryptWith` both need, once the envelope shape is settled. */
interface PreparedDecryption {
  decoded: DecodedEnvelope
  ciphertext: Uint8Array<ArrayBuffer>
  additionalData: Uint8Array<ArrayBuffer>
  iv: Uint8Array<ArrayBuffer>
}

/**
 * Shared steps for both decryption entry points: input backing check, decode,
 * content-algorithm check, detached-ciphertext view, AAD, and IV. Neither
 * caller's remaining checks (CEK shape, recipient presence) belong here, since
 * `decrypt` and `decryptWith` order them differently against this common work.
 */
function prepareDecryption(encoded: Uint8Array): PreparedDecryption {
  if (encoded instanceof Uint8Array) {
    assertArrayBufferBacked(encoded, 'envelope input', (message) => new MalformedEnvelopeError(message))
  }

  const decoded = decodeEnvelope(encoded)
  if (decoded.protectedHeader.alg !== ALG_AES_256_GCM) {
    throw new UnsupportedSchemeError(
      `Unsupported content algorithm ${decoded.protectedHeader.alg}: AES-GCM decryption requires alg ${ALG_AES_256_GCM}.`
    )
  }

  const ciphertext = sliceCiphertext(encoded, decoded.envelopeLength)
  const additionalData = encStructure(decoded.tag, decoded.protectedHeader.bytes)
  const iv = new Uint8Array(decoded.protectedHeader.iv)
  return { decoded, ciphertext, additionalData, iv }
}

/**
 * Authenticate and decrypt a complete scheme-1 FEE object with a supplied CEK.
 *
 * Both COSE_Encrypt0 and COSE_Encrypt are accepted. The envelope tag selects
 * the AAD context; recipient records are validated by the COSE decoder but do
 * not participate when the caller supplies the CEK directly. Borrows its
 * inputs: callers must not modify `encoded` or `cek` until the promise settles.
 */
export async function decrypt(encoded: Uint8Array, cek: Uint8Array): Promise<Uint8Array> {
  assertAes256Key(cek, 'CEK')
  const { ciphertext, additionalData, iv } = prepareDecryption(encoded)
  const key = await importAesGcmKey(cek, 'decrypt', false)
  return await aesGcmDecrypt(key, iv, additionalData, ciphertext)
}

/**
 * Authenticate and decrypt a complete scheme-1 FEE object, recovering its CEK
 * from a recipient via `unwrapper`.
 *
 * Accepts only `COSE_Encrypt` (tag 96); a tag-16 envelope carries no
 * recipients and fails with `NoUsableRecipientError` without calling
 * `unwrapper`. Borrows `encoded`: callers must not modify it until the
 * returned promise settles. Each recipient is copied into an isolated
 * `RecipientInfo` before reaching `unwrapper`, so the caller's `encoded` bytes
 * are unaffected by anything the unwrapper does to what it receives.
 * `unwrapper` is called at most once, with every recipient in wire order; its
 * resolved CEK is validated as an exactly 32-byte, non-zero key before use.
 */
export async function decryptWith(encoded: Uint8Array, unwrapper: Unwrapper): Promise<Uint8Array> {
  if (typeof unwrapper !== 'function') {
    throw new MalformedEnvelopeError(`Invalid unwrapper: expected a function, got ${describeCborType(unwrapper)}.`)
  }

  const { decoded, ciphertext, additionalData, iv } = prepareDecryption(encoded)
  if (decoded.tag === TAG_ENCRYPT0) {
    throw new NoUsableRecipientError(
      'No usable recipient: this envelope is COSE_Encrypt0 and carries no recipients; supply the CEK directly with aesGcm.decrypt instead.'
    )
  }

  const infos = decoded.recipients.map(toRecipientInfo)
  let cek: Uint8Array | undefined
  try {
    cek = await unwrapper(infos)
  } catch (cause) {
    throw new RecipientUnwrapError('Recipient key recovery failed.', { cause })
  }
  if (cek === undefined) {
    throw new NoUsableRecipientError(
      `No usable recipient: none of the ${infos.length} recipients offered a usable key.`
    )
  }
  assertAes256Key(cek, 'recovered CEK')

  const key = await importAesGcmKey(cek, 'decrypt', false)
  return await aesGcmDecrypt(key, iv, additionalData, ciphertext)
}
