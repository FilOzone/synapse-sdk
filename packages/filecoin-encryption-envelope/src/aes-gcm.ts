/**
 * Whole-object AES-256-GCM encryption (FEE scheme 1).
 *
 * This module owns IV generation, COSE framing, AAD construction, and the
 * Web Crypto operation. Callers supply plaintext and a CEK; ciphertext is
 * returned as one encoded FEE object: envelope followed by detached
 * ciphertext and its 16-byte authentication tag.
 */
import { ALG_AES_256_GCM, KEY_SIZE, MAX_AES_GCM_PLAINTEXT_SIZE, NONCE_SIZE } from './constants.ts'
import { encStructure } from './cose/enc-structure.ts'
import { prepareEnvelope } from './cose/encode.ts'
import type { CborValue } from './cose/headers.ts'
import { describeCborType } from './cose/headers.ts'
import {
  EncryptionError,
  InvalidKeyError,
  InvalidPlaintextError,
  InvalidPlaintextLengthError,
  MalformedEnvelopeError,
} from './errors.ts'

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
    throw new EncryptionError(`Could not generate the ${NONCE_SIZE}-byte AES-GCM IV.`, { cause })
  }
  return iv
}

async function importEncryptionKey(key: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt'])
  } catch (cause) {
    throw new EncryptionError('Could not import the AES-256-GCM CEK.', { cause })
  }
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
    const key = await importEncryptionKey(cek)

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
      throw new EncryptionError('AES-256-GCM encryption failed.', { cause })
    }

    return joinEnvelopeAndCiphertext(prepared.bytes, ciphertext)
  } finally {
    cek.fill(0)
  }
}
