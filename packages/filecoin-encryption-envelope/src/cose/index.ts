/**
 * COSE decode-only inspection surface (FIP-1253): read an untrusted envelope
 * into its typed protected header, unprotected header, and recipient list.
 * See docs/tech-spec.md, "Wire profile" and "CDDL".
 *
 * @module cose
 */

export type { DecodedEnvelope, DecodedRecipient } from './decode.ts'
export { decodeEnvelope } from './decode.ts'
export type { Alg, CborValue, DecodedProtectedHeader, UnprotectedHeaderMap } from './headers.ts'
