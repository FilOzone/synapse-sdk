/**
 * Random-access support for chunked encryption (scheme 2).
 *
 * `parse` inspects an encoded object without a key and, for chunked objects,
 * returns the parameters `decryptRange` can reuse. It can also inspect
 * scheme-1 objects, returning their scheme and envelope metadata, but range
 * decryption is supported only for the chunked scheme.
 *
 * The implementation details used by these APIs (`paramsState`, `planRange`,
 * `readEnvelope`, and `openExactRange`) are kept in separate modules.
 */
export { decryptRange, decryptRangeWith, type RangeResult } from './decrypt.ts'
export { type ChunkedEnvelopeParams, type EnvelopeInfo, parse } from './inspect.ts'
export type { ByteRange } from './plan.ts'
export type { RandomAccessSource } from './source.ts'
