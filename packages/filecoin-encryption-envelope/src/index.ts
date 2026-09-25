/**
 * **Filecoin Encryption Envelope (FIP-1253) - Main Entry Point**
 *
 * @example
 * ```ts
 * import * as fee from '@filoz/filecoin-encryption-envelope'
 *
 * fee.cose.decodeEnvelope(bytes)
 * fee.constants.ALG_AES_256_GCM
 * ```
 *
 * @module filecoin-encryption-envelope
 */
export * as aesGcm from './aes-gcm.ts'
export * as chunkLayout from './chunk-layout.ts'
export * as constants from './constants.ts'
export * as cose from './cose/index.ts'
export * as errors from './errors.ts'
export * as nonce from './nonce.ts'
export * as recipients from './recipients/index.ts'
