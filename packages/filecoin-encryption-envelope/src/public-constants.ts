/**
 * Caller-facing constants only: a curated re-export list. Values stay owned
 * where they are defined; this file defines nothing. Implementation
 * constants stay internal — add a value here only when callers need it.
 */
export {
  DEFAULT_CHUNK_SIZE,
  KEY_SIZE,
  MAX_AES_GCM_PLAINTEXT_SIZE,
  MAX_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  MIN_CHUNK_SIZE,
} from './constants.ts'
export { ALG_A256KW, ENVELOPE_TYPE } from './cose/constants.ts'
