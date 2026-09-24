/**
 * Shared byte-level helpers for the cose-*.test.ts suites. Not a test file
 * itself (mocha only picks up test/**\/*.test.ts) — just the hex/concat
 * plumbing used to hand-build CBOR fixtures without going through this
 * package's own encoder.
 */

/** Decode a hex string (no separators, even length) into bytes. */
export function hexToBytes(hex: string): Uint8Array {
  const pairs = hex.match(/.{2}/g) ?? []
  return Uint8Array.from(pairs.map((pair) => Number.parseInt(pair, 16)))
}

/** Concatenate any number of byte arrays into one. */
export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** UTF-8 bytes of a string, for building CBOR text-string fixtures. */
export function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text)
}

/**
 * `decodeProtectedHeader` returns `app_metadata` as a null-prototype object
 * (see headers.ts), so a plain object literal used as the "expected" value
 * in a `deepStrictEqual` fails on prototype identity alone even when every
 * key and value matches. Wrap the expected literal with this before
 * comparing.
 */
export function toNullProto<T extends Record<string, unknown>>(obj: T): T {
  return Object.assign(Object.create(null), obj)
}

/** The 12-byte IV used across fixtures: bytes 0x00..0x0B. */
export const FIXTURE_IV_12 = Uint8Array.from({ length: 12 }, (_, i) => i)

/** The 7-byte base nonce used across fixtures: bytes 0x00..0x06. */
export const FIXTURE_BASE_NONCE_7 = Uint8Array.from({ length: 7 }, (_, i) => i)

/**
 * Hand-built protected header for a minimal, alg-3 (whole-object
 * AES-256-GCM) envelope: `{ 1: 3, 5: <12-byte iv>, 16: "application/vnd.filecoin-encryption+cose" }`.
 *
 * Derivation, canonically encoded (RFC 8949 sorts map keys by their own
 * encoded bytes: `01` < `05` < `10`):
 *
 * ```
 * a3                        map, 3 pairs
 *   01 03                   1 (alg) => 3
 *   05 4c 000102…0b         5 (iv) => 12-byte bstr (0x40 | 12 = 0x4c)
 *   10 78 28 6170706c…      16 (typ) => 40-byte tstr (0x78 = 1-byte length follows)
 * ```
 *
 * 60 bytes. Verified against cborg's own `encode(map, rfc8949EncodeOptions)`
 * output while writing this fixture.
 */
export const MINIMAL_PROTECTED_HEADER_HEX =
  'a30103054c000102030405060708090a0b1078286170706c69636174696f6e2f766e642e66696c65636f696e2d656e6372797074696f6e2b636f7365'

/**
 * A complete minimal tag-16 (COSE_Encrypt0) envelope: `d0` (tag 16), `83`
 * (3-element array), {@link MINIMAL_PROTECTED_HEADER_HEX} as a 60-byte
 * protected bstr (`58 3c`), `a0` for the **empty** unprotected map — the v1
 * encoder writes no content unprotected parameters — and `f6` (null) for the
 * detached ciphertext. Shared between the encode and decode test suites so
 * the two agree on what "a minimal envelope" is byte for byte.
 */
export const MINIMAL_ENVELOPE_TAG16_HEX = `d083583c${MINIMAL_PROTECTED_HEADER_HEX}a0f6`
