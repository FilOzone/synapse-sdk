/**
 * AES-256 Key Wrap (RFC 3394) for A256KW recipients (`alg -5`).
 *
 * Internal: `recipients/index.ts` does not export these helpers. This module
 * owns recipient parsing, A256KW record construction, and the profile's
 * byte-oriented unwrap (`unwrapCek`).
 */
import { KEY_SIZE } from '../constants.ts'
import { ALG_A256KW, HEADER_ALG, HEADER_KID } from '../cose/constants.ts'
import type { RecipientInput } from '../cose/encode.ts'
import type { CborValue } from '../cose/headers.ts'
import { describeCborType } from '../cose/headers.ts'
import { InvalidKeyError, MalformedEnvelopeError } from '../errors.ts'
import { assertAes256Key, assertArrayBufferBacked } from '../internal/keys.ts'
import { aesKwUnwrap, aesKwWrap, importAesKwKey } from '../internal/web-crypto.ts'

/** RFC 3394 adds one 8-byte integrity block, so a 32-byte CEK wraps to 40 bytes. */
export const WRAPPED_CEK_SIZE = KEY_SIZE + 8

/** One validated A256KW recipient, holding references into the caller's own objects. */
export interface PreparedA256KWRecipient {
  readonly kek: Uint8Array<ArrayBuffer>
  readonly kid?: Uint8Array
}

/**
 * Validate one caller-supplied recipient. Each field is read once, so a
 * getter cannot pass validation with one value and be encoded with another.
 * Returns references into the caller's own objects; nothing is copied.
 */
export function parseA256KWRecipient(
  value: unknown,
  path: string,
  remainingPayloadBudget: number
): PreparedA256KWRecipient {
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
  assertAes256Key(kek, `${path}.kek`)
  return kid === undefined ? { kek } : { kek, kid }
}

/**
 * Wrap `cekKey` for one recipient and build its A256KW record:
 * `[h'', {1: -5, 4: kid}, wrapped_cek]`, with `kid` only when supplied.
 * RFC 9052 requires the empty protected field for A256KW.
 */
export async function createA256KWRecipientRecord(
  cekKey: CryptoKey,
  recipient: PreparedA256KWRecipient
): Promise<RecipientInput> {
  const unprotected = new Map<number, CborValue>([[HEADER_ALG, ALG_A256KW]])
  if (recipient.kid !== undefined) {
    unprotected.set(HEADER_KID, recipient.kid)
  }
  const kekKey = await importAesKwKey(recipient.kek, 'wrapKey')
  return {
    protectedBytes: new Uint8Array(0),
    unprotected,
    ciphertext: await aesKwWrap(cekKey, kekKey),
  }
}

/**
 * Unwrap a CEK. Returns `undefined` when this KEK cannot recover a CEK from
 * `wrappedCek` because the KEK is wrong or the wrapped bytes are corrupted.
 *
 * A successful unwrap that yields an all-zero CEK throws instead. The KEK
 * matched, so the recipient is this caller's, and the key inside is invalid.
 */
export async function unwrapCek(wrappedCek: Uint8Array, kek: Uint8Array): Promise<Uint8Array | undefined> {
  if (!(wrappedCek instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid wrapped CEK: expected a Uint8Array, got ${describeCborType(wrappedCek)}.`)
  }
  assertArrayBufferBacked(wrappedCek, 'wrapped CEK', (message) => new MalformedEnvelopeError(message))
  // RFC 3394 accepts any multiple of 8 bytes; only 40 can hold a 32-byte CEK.
  if (wrappedCek.length !== WRAPPED_CEK_SIZE) {
    throw new MalformedEnvelopeError(
      `Invalid wrapped CEK length ${wrappedCek.length}: A256KW requires exactly ${WRAPPED_CEK_SIZE} bytes for a 32-byte CEK.`
    )
  }
  assertAes256Key(kek, 'KEK')
  const kekKey = await importAesKwKey(kek, 'unwrapKey')

  const cek = await aesKwUnwrap(wrappedCek, kekKey)
  if (cek === undefined) {
    return undefined
  }
  if (cek.every((byte) => byte === 0)) {
    throw new InvalidKeyError('Invalid recovered CEK: an all-zero 32-byte key is not permitted.')
  }
  return cek
}
