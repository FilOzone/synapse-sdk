/**
 * Shared AES-256 key shape validation, used by both `aes-gcm.ts` (the CEK)
 * and `recipients/a256kw.ts` (the CEK and each recipient's KEK).
 */
import { KEY_SIZE } from '../constants.ts'
import { describeCborType } from '../cose/headers.ts'
import { InvalidKeyError } from '../errors.ts'

/**
 * Assert that `value` is a 32-byte, non-all-zero AES-256 key. Does not copy;
 * callers that need a private snapshot take one after this passes.
 */
export function assertAes256Key(value: unknown, name: string): asserts value is Uint8Array {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidKeyError(`Invalid ${name}: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  if (value.length !== KEY_SIZE) {
    throw new InvalidKeyError(`Invalid ${name} length ${value.length}: expected exactly ${KEY_SIZE} bytes for AES-256.`)
  }
  if (value.every((byte) => byte === 0)) {
    throw new InvalidKeyError(`Invalid ${name}: an all-zero 32-byte key is not permitted.`)
  }
}
