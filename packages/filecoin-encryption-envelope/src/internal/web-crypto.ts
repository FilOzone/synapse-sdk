/**
 * Every direct call into `globalThis.crypto` in this package: randomness plus
 * `subtle`'s AES-GCM import/encrypt/decrypt and AES-KW import/wrap/unwrap.
 * This module owns only Web Crypto mechanics and their error mapping — no
 * COSE, no recipient logic, no key validation, no all-zero checks (see
 * `./keys.ts` for that).
 */
import { AuthenticationError, CryptoOperationError } from '../errors.ts'

/** Web Crypto reports an AEAD tag or AES-KW integrity failure as a DOMException named OperationError. */
function isOperationError(cause: unknown): boolean {
  return cause !== null && typeof cause === 'object' && 'name' in cause && cause.name === 'OperationError'
}

/** Generate `length` cryptographically random bytes. */
export function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(length)
  try {
    globalThis.crypto.getRandomValues(bytes)
  } catch (cause) {
    throw new CryptoOperationError(`Could not generate ${length} random bytes.`, { cause })
  }
  return bytes
}

/** Import a raw AES-GCM key. */
export async function importAesGcmKey(
  raw: Uint8Array<ArrayBuffer>,
  usage: 'encrypt' | 'decrypt',
  extractable: boolean
): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.importKey('raw', raw, 'AES-GCM', extractable, [usage])
  } catch (cause) {
    throw new CryptoOperationError(`Could not import the AES-256-GCM CEK for ${usage}.`, { cause })
  }
}

/** Import a raw AES-KW key (a KEK). */
export async function importAesKwKey(raw: Uint8Array<ArrayBuffer>, usage: 'wrapKey' | 'unwrapKey'): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.importKey('raw', raw, 'AES-KW', false, [usage])
  } catch (cause) {
    throw new CryptoOperationError(`Could not import the AES-256 KEK for ${usage}.`, { cause })
  }
}

/** AES-256-GCM encrypt with a 128-bit authentication tag. */
export async function aesGcmEncrypt(
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  additionalData: Uint8Array<ArrayBuffer>,
  plaintext: Uint8Array<ArrayBuffer>
): Promise<Uint8Array<ArrayBuffer>> {
  try {
    const ciphertext = await globalThis.crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
      key,
      plaintext
    )
    return new Uint8Array(ciphertext)
  } catch (cause) {
    throw new CryptoOperationError('AES-256-GCM encryption failed.', { cause })
  }
}

/**
 * AES-256-GCM decrypt with a 128-bit authentication tag. An `OperationError`
 * (tag mismatch) is reported as `AuthenticationError`; anything else as
 * `CryptoOperationError`.
 */
export async function aesGcmDecrypt(
  key: CryptoKey,
  iv: Uint8Array<ArrayBuffer>,
  additionalData: Uint8Array<ArrayBuffer>,
  ciphertext: Uint8Array<ArrayBuffer>
): Promise<Uint8Array> {
  try {
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv, additionalData, tagLength: 128 },
      key,
      ciphertext
    )
    return new Uint8Array(plaintext)
  } catch (cause) {
    if (isOperationError(cause)) {
      throw new AuthenticationError(
        'AES-256-GCM authentication failed: the CEK is wrong or authenticated envelope data was changed.',
        { cause }
      )
    }
    throw new CryptoOperationError('AES-256-GCM decryption failed before authentication could be established.', {
      cause,
    })
  }
}

/** Wrap an extractable AES-GCM CEK key under an AES-KW KEK key (RFC 3394). */
export async function aesKwWrap(cekKey: CryptoKey, kekKey: CryptoKey): Promise<Uint8Array> {
  try {
    const wrapped = await globalThis.crypto.subtle.wrapKey('raw', cekKey, kekKey, 'AES-KW')
    return new Uint8Array(wrapped)
  } catch (cause) {
    throw new CryptoOperationError('AES-256 key wrap failed.', { cause })
  }
}

/**
 * Unwrap a CEK under a KEK, to an extractable AES-GCM key, then export it.
 * Returns `undefined` when RFC 3394's integrity check fails during unwrap
 * (wrong KEK or corrupted wrapped bytes) instead of throwing, so a caller can
 * try the next recipient.
 */
export async function aesKwUnwrap(
  wrappedCek: Uint8Array<ArrayBuffer>,
  kekKey: CryptoKey
): Promise<Uint8Array | undefined> {
  let cekKey: CryptoKey
  try {
    // Extractable because the caller receives bytes, not a CryptoKey.
    cekKey = await globalThis.crypto.subtle.unwrapKey('raw', wrappedCek, kekKey, 'AES-KW', 'AES-GCM', true, ['decrypt'])
  } catch (cause) {
    // RFC 3394's integrity check failing is reported as OperationError.
    if (isOperationError(cause)) {
      return undefined
    }
    throw new CryptoOperationError('AES-256 key unwrap failed before integrity could be checked.', { cause })
  }

  try {
    return new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', cekKey))
  } catch (cause) {
    throw new CryptoOperationError('Could not export the unwrapped CEK.', { cause })
  }
}
