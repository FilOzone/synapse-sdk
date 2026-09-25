/**
 * AES-256 Key Wrap (RFC 3394) for A256KW recipients (`alg -5`).
 *
 * Internal: `recipients/index.ts` does not export these helpers. This module
 * owns key wrapping, recipient parsing, and A256KW record construction.
 */
import { KEY_SIZE } from '../constants.ts'
import { ALG_A256KW, HEADER_ALG, HEADER_KID } from '../cose/constants.ts'
import type { RecipientInput } from '../cose/encode.ts'
import type { CborValue } from '../cose/headers.ts'
import { describeCborType } from '../cose/headers.ts'
import { CryptoOperationError, hasErrorName, InvalidKeyError, MalformedEnvelopeError } from '../errors.ts'

/** RFC 3394 adds one 8-byte integrity block, so a 32-byte CEK wraps to 40 bytes. */
export const WRAPPED_CEK_SIZE = KEY_SIZE + 8

function snapshotKey(value: unknown, name: string): Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidKeyError(`Invalid ${name}: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  if (value.length !== KEY_SIZE) {
    throw new InvalidKeyError(`Invalid ${name} length ${value.length}: expected exactly ${KEY_SIZE} bytes for AES-256.`)
  }

  const snapshot = new Uint8Array(value)
  if (snapshot.every((byte) => byte === 0)) {
    throw new InvalidKeyError(`Invalid ${name}: an all-zero 32-byte key is not permitted.`)
  }
  return snapshot
}

/** A validated A256KW recipient holding private copies of its KEK and `kid`. */
export interface ParsedA256KWRecipient {
  kek: Uint8Array<ArrayBuffer>
  kid?: Uint8Array
}

/**
 * Validate one caller-supplied recipient and copy its key material. Each
 * field is read once, so a getter cannot pass validation with one value and
 * be encoded with another.
 */
export function parseA256KWRecipient(
  value: unknown,
  path: string,
  remainingPayloadBudget: number
): ParsedA256KWRecipient {
  if (value === null || typeof value !== 'object') {
    throw new MalformedEnvelopeError(`Invalid ${path}: expected a recipient object, got ${describeCborType(value)}.`)
  }
  const { alg, kek, kid } = value as Record<'alg' | 'kek' | 'kid', unknown>
  if (alg !== ALG_A256KW) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}.alg: ${describeCborType(alg)} ${String(alg)}. Only A256KW (${ALG_A256KW}) recipients can be created.`
    )
  }
  if (kid !== undefined && !(kid instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid ${path}.kid: expected a Uint8Array, got ${describeCborType(kid)}.`)
  }
  const minimumPayloadSize = WRAPPED_CEK_SIZE + (kid?.length ?? 0)
  if (minimumPayloadSize > remainingPayloadBudget) {
    throw new MalformedEnvelopeError(
      `Invalid ${path}: its wrapped CEK and kid require at least ${minimumPayloadSize} bytes, ` +
        `exceeding the ${remainingPayloadBudget}-byte remaining envelope budget.`
    )
  }
  // Validated last so a rejection above leaves no KEK copy behind.
  const kekSnapshot = snapshotKey(kek, `${path}.kek`)
  return kid === undefined ? { kek: kekSnapshot } : { kek: kekSnapshot, kid: new Uint8Array(kid) }
}

/**
 * Wrap `cek` for one recipient and build its A256KW record:
 * `[h'', {1: -5, 4: kid}, wrapped_cek]`, with `kid` only when supplied.
 * RFC 9052 requires the empty protected field for A256KW.
 */
export async function createA256KWRecipientRecord(
  cek: Uint8Array,
  recipient: ParsedA256KWRecipient
): Promise<RecipientInput> {
  const unprotected = new Map<number, CborValue>([[HEADER_ALG, ALG_A256KW]])
  if (recipient.kid !== undefined) {
    unprotected.set(HEADER_KID, recipient.kid)
  }
  return {
    protectedBytes: new Uint8Array(0),
    unprotected,
    ciphertext: await wrapCek(cek, recipient.kek),
  }
}

async function importKek(kek: Uint8Array<ArrayBuffer>, usage: 'wrapKey' | 'unwrapKey'): Promise<CryptoKey> {
  try {
    return await globalThis.crypto.subtle.importKey('raw', kek, 'AES-KW', false, [usage])
  } catch (cause) {
    throw new CryptoOperationError(`Could not import the AES-256 KEK for ${usage}.`, { cause })
  }
}

/** Wrap a CEK under a KEK. Both must be 32 bytes and not all-zero. */
export async function wrapCek(cekInput: Uint8Array, kekInput: Uint8Array): Promise<Uint8Array> {
  const cek = snapshotKey(cekInput, 'CEK')
  let kek: Uint8Array<ArrayBuffer> | undefined
  try {
    kek = snapshotKey(kekInput, 'KEK')
    const kekKey = await importKek(kek, 'wrapKey')

    // Web Crypto wraps CryptoKeys, not bytes: the CEK must be extractable to
    // be wrapped, and needs one usage because an empty list is rejected.
    let cekKey: CryptoKey
    try {
      cekKey = await globalThis.crypto.subtle.importKey('raw', cek, 'AES-GCM', true, ['encrypt'])
    } catch (cause) {
      throw new CryptoOperationError('Could not import the CEK for key wrapping.', { cause })
    }

    try {
      const wrappedCek = await globalThis.crypto.subtle.wrapKey('raw', cekKey, kekKey, 'AES-KW')
      return new Uint8Array(wrappedCek)
    } catch (cause) {
      throw new CryptoOperationError('AES-256 key wrap failed.', { cause })
    }
  } finally {
    cek.fill(0)
    kek?.fill(0)
  }
}

/**
 * Unwrap a CEK. Returns `undefined` when this KEK cannot recover a CEK from
 * `wrappedCek` because the KEK is wrong or the wrapped bytes are corrupted.
 *
 * A successful unwrap that yields an all-zero CEK throws instead. The KEK
 * matched, so the recipient is this caller's, and the key inside is invalid.
 */
export async function unwrapCek(wrappedCek: Uint8Array, kekInput: Uint8Array): Promise<Uint8Array | undefined> {
  if (!(wrappedCek instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid wrapped CEK: expected a Uint8Array, got ${describeCborType(wrappedCek)}.`)
  }
  const kek = snapshotKey(kekInput, 'KEK')
  try {
    // RFC 3394 accepts any multiple of 8 bytes; only 40 can hold a 32-byte CEK.
    if (wrappedCek.length !== WRAPPED_CEK_SIZE) {
      throw new MalformedEnvelopeError(
        `Invalid wrapped CEK length ${wrappedCek.length}: A256KW requires exactly ${WRAPPED_CEK_SIZE} bytes for a 32-byte CEK.`
      )
    }
    const wrapped = new Uint8Array(wrappedCek)
    const kekKey = await importKek(kek, 'unwrapKey')

    let cekKey: CryptoKey
    try {
      // Extractable because the caller receives bytes, not a CryptoKey.
      cekKey = await globalThis.crypto.subtle.unwrapKey('raw', wrapped, kekKey, 'AES-KW', 'AES-GCM', true, ['decrypt'])
    } catch (cause) {
      // RFC 3394's integrity check failing is reported as OperationError.
      if (hasErrorName(cause, 'OperationError')) {
        return undefined
      }
      throw new CryptoOperationError('AES-256 key unwrap failed before integrity could be checked.', { cause })
    }

    let cek: Uint8Array
    try {
      cek = new Uint8Array(await globalThis.crypto.subtle.exportKey('raw', cekKey))
    } catch (cause) {
      throw new CryptoOperationError('Could not export the unwrapped CEK.', { cause })
    }
    if (cek.every((byte) => byte === 0)) {
      throw new InvalidKeyError('Invalid recovered CEK: an all-zero 32-byte key is not permitted.')
    }
    return cek
  } finally {
    kek.fill(0)
  }
}
