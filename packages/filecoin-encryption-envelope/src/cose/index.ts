/**
 * COSE wire-format layer (FIP-1253): typed structures ↔ bytes for the
 * envelope's protected/unprotected headers, `Enc_structure` (AAD), and the
 * tagged CBOR envelope itself. See docs/tech-spec.md, "Wire profile" and
 * "CDDL". No AEAD, no key wrap, no chunk framing — those live above this.
 *
 * @module cose
 */
export * from './constants.ts'
export * from './decode.ts'
export * from './enc-structure.ts'
export * from './encode.ts'

export type {
  Alg,
  CborValue,
  CborValueObject,
  DecodedProtectedHeader,
  ProtectedHeaderFields,
  UnprotectedHeaderMap,
} from './headers.ts'

export {
  assertValidRecipientHeaders,
  decodeProtectedHeader,
  decodeUnprotectedHeader,
  describeCborType,
  encodeProtectedHeader,
  encodeUnprotectedHeader,
  ivLengthForAlg,
} from './headers.ts'
