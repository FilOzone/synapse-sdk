/**
 * Decode Filecoin Encryption Envelope headers and recipient entries without
 * decrypting the content. Decoding does not authenticate the envelope.
 *
 * @module cose
 */

export type { DecodedEnvelope, DecodedRecipient } from './decode.ts'
export { decodeEnvelope } from './decode.ts'
export type { Alg, CborValue, DecodedProtectedHeader, UnprotectedHeaderMap } from './headers.ts'
