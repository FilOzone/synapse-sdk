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
import { InvalidKeyError, MalformedEnvelopeError } from '../errors.ts'
import { assertAes256Key } from '../internal/keys.ts'
import { aesKwUnwrap, aesKwWrap, importAesGcmKey, importAesKwKey } from '../internal/web-crypto.ts'

/** RFC 3394 adds one 8-byte integrity block, so a 32-byte CEK wraps to 40 bytes. */
export const WRAPPED_CEK_SIZE = KEY_SIZE + 8

function snapshotKey(value: unknown, name: string): Uint8Array<ArrayBuffer> {
  assertAes256Key(value, name)
  return new Uint8Array(value)
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

/** Wrap a CEK under a KEK. Both must be 32 bytes and not all-zero. */
export async function wrapCek(cekInput: Uint8Array, kekInput: Uint8Array): Promise<Uint8Array> {
  const cek = snapshotKey(cekInput, 'CEK')
  let kek: Uint8Array<ArrayBuffer> | undefined
  try {
    kek = snapshotKey(kekInput, 'KEK')
    const kekKey = await importAesKwKey(kek, 'wrapKey')

    // Web Crypto wraps CryptoKeys, not bytes: the CEK must be extractable to
    // be wrapped, and needs one usage because an empty list is rejected.
    const cekKey = await importAesGcmKey(cek, 'encrypt', true)

    return await aesKwWrap(cekKey, kekKey)
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
    const kekKey = await importAesKwKey(kek, 'unwrapKey')

    const cek = await aesKwUnwrap(wrapped, kekKey)
    if (cek === undefined) {
      return undefined
    }
    if (cek.every((byte) => byte === 0)) {
      throw new InvalidKeyError('Invalid recovered CEK: an all-zero 32-byte key is not permitted.')
    }
    return cek
  } finally {
    kek.fill(0)
  }
}
