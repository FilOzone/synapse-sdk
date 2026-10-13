/**
 * **Filecoin Encryption Envelope (FIP-1253) - Main Entry Point**
 *
 * @example
 * ```ts
 * import * as fee from '@filoz/filecoin-encryption-envelope'
 *
 * fee.aesGcm.encrypt(...)
 * fee.constants.ALG_A256KW
 * ```
 *
 * @module filecoin-encryption-envelope
 */
export * as aesGcm from './aes-gcm.ts'
export type { AppMetadata, CborValue } from './cose/headers.ts'
export * as cose from './cose/index.ts'
export * as errors from './errors.ts'
export * as constants from './public-constants.ts'
export * as recipients from './recipients/index.ts'
