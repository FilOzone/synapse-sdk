/**
 * AES-256 Key Wrap (RFC 3394) for A256KW recipients (`alg -5`).
 *
 * Internal: `recipients/index.ts` does not export these helpers except
 * `createA256KWUnwrapper`. This module owns recipient parsing, A256KW record
 * construction, and the built-in unwrapper factory.
 */
import { A256KW_WRAPPED_CEK_SIZE, ALG_A256KW, HEADER_ALG, HEADER_KID } from '../cose/constants.ts'
import type { RecipientInput } from '../cose/encode.ts'
import type { CborValue } from '../cose/headers.ts'
import { describeCborType } from '../cose/headers.ts'
import { MalformedEnvelopeError, RecipientAttemptLimitError } from '../errors.ts'
import { assertAes256Key } from '../internal/keys.ts'
import { aesKwUnwrap, aesKwWrap, importAesKwKey } from '../internal/web-crypto.ts'
import type { A256KWKey, A256KWUnwrapperOptions, RecipientInfo, Unwrapper } from './types.ts'

/** Default cap on AES-KW unwrap attempts per {@link createA256KWUnwrapper} call. */
const DEFAULT_MAX_ATTEMPTS = 64

/** A validated 32-byte KEK and optional kid. The caller decides whether `kid` is a reference or a copy. */
export interface ParsedA256KWKey {
  readonly kek: Uint8Array<ArrayBuffer>
  readonly kid?: Uint8Array
}

/**
 * Validate one caller-supplied recipient. Each field is read once, so a
 * getter cannot pass validation with one value and be encoded with another.
 * Returns references into the caller's own objects; nothing is copied.
 */
export function parseA256KWRecipient(value: unknown, path: string, remainingPayloadBudget: number): ParsedA256KWKey {
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
  const minimumPayloadSize = A256KW_WRAPPED_CEK_SIZE + (kid?.length ?? 0)
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
  recipient: ParsedA256KWKey
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

/** An imported KEK and its copied kid, retained by the unwrapper. */
interface PreparedA256KWKey {
  readonly kekKey: CryptoKey
  readonly kid?: Uint8Array
}

/** Validate one entry of `createA256KWUnwrapper`'s `keys` array. Does not import anything. */
function parseA256KWKey(value: unknown, path: string): ParsedA256KWKey {
  if (value === null || typeof value !== 'object') {
    throw new MalformedEnvelopeError(`Invalid ${path}: expected an object, got ${describeCborType(value)}.`)
  }
  const { kek, kid } = value as Record<'kek' | 'kid', unknown>
  if (kid !== undefined && !(kid instanceof Uint8Array)) {
    throw new MalformedEnvelopeError(`Invalid ${path}.kid: expected a Uint8Array, got ${describeCborType(kid)}.`)
  }
  assertAes256Key(kek, `${path}.kek`)
  // Copied: the unwrapper retains kid across calls for later matching. The
  // KEK is never copied — it is imported to a CryptoKey below and discarded.
  return kid === undefined ? { kek } : { kek, kid: new Uint8Array(kid) }
}

function parseMaxAttempts(options: unknown): number {
  if (options !== undefined && (options === null || typeof options !== 'object' || Array.isArray(options))) {
    throw new MalformedEnvelopeError(`Invalid options: expected an object, got ${describeCborType(options)}.`)
  }
  const maxAttempts = (options as A256KWUnwrapperOptions | undefined)?.maxAttempts
  if (maxAttempts === undefined) {
    return DEFAULT_MAX_ATTEMPTS
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts <= 0) {
    throw new MalformedEnvelopeError(
      `Invalid options.maxAttempts: ${String(maxAttempts)}. Expected a positive safe integer.`
    )
  }
  return maxAttempts
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((byte, index) => byte === b[index])
}

/**
 * Candidates for one recipient, in try order: with a kid, keys whose kid is
 * byte-equal come first, then kid-less (wildcard) keys; a key with a
 * different kid is never tried. Without a kid, every key is a candidate.
 */
function selectCandidates(keys: readonly PreparedA256KWKey[], recipientKid: Uint8Array | undefined) {
  if (recipientKid === undefined) {
    return keys
  }
  const exact: PreparedA256KWKey[] = []
  const wildcard: PreparedA256KWKey[] = []
  for (const key of keys) {
    if (key.kid === undefined) {
      wildcard.push(key)
    } else if (bytesEqual(key.kid, recipientKid)) {
      exact.push(key)
    }
  }
  return [...exact, ...wildcard]
}

/**
 * Build an {@link Unwrapper} that recovers a CEK from A256KW recipients using
 * a fixed set of caller-held KEKs. Intended to be passed to
 * `aesGcm.decryptWith`, which supplies decoded, validated recipients; the
 * returned function trusts its input and performs no validation of its own.
 *
 * Every KEK is imported once, sequentially, while this factory's promise is
 * pending; once it settles the unwrapper holds only `CryptoKey`s and copied
 * kids, so callers may clear their KEK bytes. Duplicate keys are allowed and
 * are tried in the order given.
 */
export async function createA256KWUnwrapper(
  keys: readonly A256KWKey[],
  options?: A256KWUnwrapperOptions
): Promise<Unwrapper> {
  if (!Array.isArray(keys)) {
    throw new MalformedEnvelopeError(`Invalid keys: expected an array, got ${describeCborType(keys)}.`)
  }
  if (keys.length === 0) {
    throw new MalformedEnvelopeError('Invalid keys: an unwrapper with no keys can never recover a CEK.')
  }

  const parsed: ParsedA256KWKey[] = []
  // Indexed, not `.map`: a sparse hole must be validated, not skipped.
  for (let index = 0; index < keys.length; index++) {
    parsed.push(parseA256KWKey(keys[index], `keys[${index}]`))
  }
  const maxAttempts = parseMaxAttempts(options)

  // Import every KEK sequentially: never start more than one Web Crypto
  // operation at once.
  const preparedKeys: PreparedA256KWKey[] = []
  for (const key of parsed) {
    const kekKey = await importAesKwKey(key.kek, 'unwrapKey')
    preparedKeys.push(key.kid === undefined ? { kekKey } : { kekKey, kid: key.kid })
  }

  return async (recipients: readonly RecipientInfo[]): Promise<Uint8Array | undefined> => {
    let attempts = 0
    for (const recipient of recipients) {
      if (recipient.alg !== ALG_A256KW) {
        continue
      }
      for (const candidate of selectCandidates(preparedKeys, recipient.kid)) {
        if (attempts === maxAttempts) {
          throw new RecipientAttemptLimitError(`Recipient unwrap attempt limit reached: ${maxAttempts} attempts.`)
        }
        attempts++
        // Trusts its input: `recipients` comes from the decoder via
        // `decryptWith`, already structurally validated.
        const cek = await aesKwUnwrap(recipient.wrappedKey as Uint8Array<ArrayBuffer>, candidate.kekKey)
        if (cek !== undefined) {
          return cek
        }
      }
    }
    return undefined
  }
}
