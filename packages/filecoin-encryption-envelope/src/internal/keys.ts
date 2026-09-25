/**
 * Shared AES-256 key shape validation, used by `aes-gcm.ts` for the CEK and
 * by `recipients/` for each recipient's KEK.
 */
import { KEY_SIZE } from '../constants.ts'
import { describeCborType } from '../cose/headers.ts'
import { InvalidKeyError } from '../errors.ts'

/**
 * Assert that `value` is backed by a plain `ArrayBuffer`, not a
 * `SharedArrayBuffer`. Web Crypto rejects SharedArrayBuffer-backed views
 * outright, and borrowing shared memory into an async operation is unsafe
 * regardless, so this is checked up front instead of left to Web Crypto.
 */
export function assertArrayBufferBacked(
  value: Uint8Array,
  name: string,
  makeError: (message: string) => Error
): asserts value is Uint8Array<ArrayBuffer> {
  if (Object.prototype.toString.call(value.buffer) !== '[object ArrayBuffer]') {
    throw makeError(
      `Invalid ${name}: expected a Uint8Array backed by an ArrayBuffer; SharedArrayBuffer-backed views are not supported.`
    )
  }
}

/** Assert that `value` is a 32-byte, non-all-zero AES-256 key. Does not copy. */
export function assertAes256Key(value: unknown, name: string): asserts value is Uint8Array<ArrayBuffer> {
  if (!(value instanceof Uint8Array)) {
    throw new InvalidKeyError(`Invalid ${name}: expected a Uint8Array, got ${describeCborType(value)}.`)
  }
  assertArrayBufferBacked(value, name, (message) => new InvalidKeyError(message))
  if (value.length !== KEY_SIZE) {
    throw new InvalidKeyError(`Invalid ${name} length ${value.length}: expected exactly ${KEY_SIZE} bytes for AES-256.`)
  }
  if (value.every((byte) => byte === 0)) {
    throw new InvalidKeyError(`Invalid ${name}: an all-zero 32-byte key is not permitted.`)
  }
}
