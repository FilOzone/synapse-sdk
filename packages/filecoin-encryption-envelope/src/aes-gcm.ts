/**
 * Whole-object AES-256-GCM encryption and decryption (FEE scheme 1).
 *
 * This module owns IV generation, COSE framing, AAD construction, and the
 * Web Crypto operations. Encryption returns one encoded FEE object: envelope
 * followed by detached ciphertext and its 16-byte authentication tag.
 * Decryption accepts that complete layout and a directly supplied CEK.
 */
import { ALG_AES_256_GCM, KEY_SIZE, MAX_AES_GCM_PLAINTEXT_SIZE, NONCE_SIZE, TAG_SIZE } from './constants.ts'
import { decodeEnvelope } from './cose/decode.ts'
import { encStructure } from './cose/enc-structure.ts'
import { prepareEnvelope } from './cose/encode.ts'
import type { CborValue } from './cose/headers.ts'
import { describeCborType } from './cose/headers.ts'
import {
  AuthenticationError,
  CryptoOperationError,
  hasErrorName,
  InvalidCiphertextLengthError,
  InvalidKeyError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
  UnsupportedSchemeError,
} from './errors.ts'

const MAX_AES_GCM_CIPHERTEXT_SIZE = MAX_AES_GCM_PLAINTEXT_SIZE + TAG_SIZE

/** Options for one whole-object AES-256-GCM encryption. */
export interface EncryptOptions {
  /** Exactly 32 bytes and not all-zero. The caller owns its lifecycle and reuse policy. */
  cek: Uint8Array
  contentType?: string | number
  /** Authenticated application metadata carried without interpretation. */
  appMetadata?: Record<string, CborValue>
}

function snapshotPlaintext(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidPlaintextError(`Invalid plaintext: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  if (value.length > MAX_AES_GCM_PLAINTEXT_SIZE) {
    throw new InvalidPlaintextLengthError(
      `Invalid plaintext length ${value.length}: scheme 1 accepts at most ${MAX_AES_GCM_PLAINTEXT_SIZE} bytes.`
    )
  }
  return new Uint8Array(value)
}

function snapshotCek(value: unknown): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidKeyError(`Invalid CEK: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  if (value.length !== KEY_SIZE) {
    throw new InvalidKeyError(`Invalid CEK length ${value.length}: expected exactly ${KEY_SIZE} bytes for AES-256.`)
  }

  const snapshot = new Uint8Array(value)
  if (snapshot.every((byte) => byte === 0)) {
    throw new InvalidKeyError('Invalid CEK: an all-zero 32-byte key is not permitted.')
  }
  return snapshot
}

function generateIv(): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(NONCE_SIZE)
  try {
    globalThis.crypto.getRandomValues(iv)
  } catch (cause) {
    throw new CryptoOperationError(`Could not generate the ${NONCE_SIZE}-byte AES-GCM IV.`, { cause })
  }
  return iv
}

type AesGcmUsage = 'encrypt' | 'decrypt'

async function importKey(key: Uint8Array<ArrayBuffer>, usage: AesGcmUsage): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage])
  } catch (cause) {
    throw new CryptoOperationError(`Could not import the AES-256-GCM CEK for an AES-GCM ${usage} operation.`, {
      cause,
    })
  }
}

function snapshotCiphertext(encoded: Uint8Array, envelopeLength: number): Uint8Array<ArrayBuffer> {
  const ciphertextLength = encoded.length - envelopeLength
  if (ciphertextLength < TAG_SIZE || ciphertextLength > MAX_AES_GCM_CIPHERTEXT_SIZE) {
    throw new InvalidCiphertextLengthError(
      `Invalid AES-GCM ciphertext length ${ciphertextLength}: expected between ${TAG_SIZE} and ` +
        `${MAX_AES_GCM_CIPHERTEXT_SIZE} bytes, including the ${TAG_SIZE}-byte authentication tag.`
    )
  }
  return new Uint8Array(encoded.subarray(envelopeLength))
}

function joinEnvelopeAndCiphertext(envelope: Uint8Array, ciphertext: ArrayBuffer): Uint8Array {
  const ciphertextBytes = new Uint8Array(ciphertext)
  const result = new Uint8Array(envelope.length + ciphertextBytes.length)
  result.set(envelope)
  result.set(ciphertextBytes, envelope.length)
  return result
}

/**
 * Encrypt a complete plaintext as scheme 1 and return `envelope || ciphertext`.
 *
 * Caller-owned byte arrays are snapshotted before the first async step to
 * prevent them from changing during the operation. The IV is always generated
 * internally and cannot be provided by the caller.
 */
export async function encrypt(plaintext: Uint8Array, options: EncryptOptions): Promise<Uint8Array> {
  if (options === null || typeof options !== 'object') {
    throw new MalformedEnvelopeError(
      `Invalid AES-GCM encryption options: expected an object, got ${describeCborType(options)}.`
    )
  }

  const recipientInputs = (options as EncryptOptions & { recipients?: unknown }).recipients
  if (recipientInputs !== undefined) {
    throw new MalformedEnvelopeError(
      'Invalid AES-GCM encryption options: recipient encryption is not supported by this operation.'
    )
  }

  const plaintextSnapshot = snapshotPlaintext(plaintext)
  const { cek: cekInput, contentType, appMetadata } = options
  const cek = snapshotCek(cekInput)
  try {
    const iv = generateIv()
    const prepared = prepareEnvelope({
      protectedHeader: {
        alg: ALG_AES_256_GCM,
        iv,
        contentType,
        appMetadata,
      },
    })
    const additionalData = encStructure(prepared.tag, prepared.protectedBytes)
    const key = await importKey(cek, 'encrypt')

    let ciphertext: ArrayBuffer
    try {
      ciphertext = await globalThis.crypto.subtle.encrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData,
          tagLength: 128,
        },
        key,
        plaintextSnapshot
      )
    } catch (cause) {
      throw new CryptoOperationError('AES-256-GCM encryption failed.', { cause })
    }

    return joinEnvelopeAndCiphertext(prepared.bytes, ciphertext)
  } finally {
    cek.fill(0)
  }
}

/**
 * Authenticate and decrypt a complete scheme-1 FEE object with a supplied CEK.
 *
 * Both COSE_Encrypt0 and COSE_Encrypt are accepted. The envelope tag selects
 * the AAD context; recipient records are validated by the COSE decoder but do
 * not participate when the caller supplies the CEK directly.
 */
export async function decrypt(encoded: Uint8Array, cekInput: Uint8Array): Promise<Uint8Array> {
  const cek = snapshotCek(cekInput)
  try {
    const decoded = decodeEnvelope(encoded)
    if (decoded.protectedHeader.alg !== ALG_AES_256_GCM) {
      throw new UnsupportedSchemeError(
        `Unsupported content algorithm ${decoded.protectedHeader.alg}: AES-GCM decryption requires alg ${ALG_AES_256_GCM}.`
      )
    }

    const ciphertext = snapshotCiphertext(encoded, decoded.envelopeLength)
    const iv = new Uint8Array(decoded.protectedHeader.iv)
    const additionalData = encStructure(decoded.tag, decoded.protectedHeader.bytes)
    const key = await importKey(cek, 'decrypt')

    try {
      const plaintext = await globalThis.crypto.subtle.decrypt(
        {
          name: 'AES-GCM',
          iv,
          additionalData,
          tagLength: 128,
        },
        key,
        ciphertext
      )
      return new Uint8Array(plaintext)
    } catch (cause) {
      if (hasErrorName(cause, 'OperationError')) {
        throw new AuthenticationError(
          'AES-256-GCM authentication failed: the CEK is wrong or authenticated envelope data was changed.',
          { cause }
        )
      }
      throw new CryptoOperationError('AES-256-GCM decryption failed before authentication could be established.', {
        cause,
      })
    }
  } finally {
    cek.fill(0)
  }
}
