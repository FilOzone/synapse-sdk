/**
 * **Filecoin Encryption Envelope (FIP-1253) - Main Entry Point**
 *
 * @example
 * ```ts
 * import * as fee from '@filoz/filecoin-encryption-envelope'
 *
 * source.pipeThrough(fee.encrypt({ cek }))  // chunked stream, the default
 * encrypted.pipeThrough(fee.decrypt(cek))    // and back
 * await fee.decryptRange(object, cek, { offset: 1024, length: 4096 })  // one byte range
 * fee.aesGcm.encrypt(plaintext, { cek })     // whole-object, opt-in
 * fee.constants.ALG_A256KW
 * ```
 *
 * @module filecoin-encryption-envelope
 */
export * as aesGcm from './aes-gcm.ts'
export { type ChunkedEncryptOptions, decrypt, decryptWith, encrypt } from './aes-gcm-stream.ts'
export type { AppMetadata, CborValue } from './cose/headers.ts'
export * as cose from './cose/index.ts'
export * as errors from './errors.ts'
export { type ChunkedEnvelopeParams, type EnvelopeInfo, parse } from './inspect.ts'
export * as constants from './public-constants.ts'
export { decryptRange, decryptRangeWith, type RangeResult } from './range-decrypt.ts'
export type { ByteRange } from './range-plan.ts'
export type { RandomAccessSource } from './range-source.ts'
export * as recipients from './recipients/index.ts'
