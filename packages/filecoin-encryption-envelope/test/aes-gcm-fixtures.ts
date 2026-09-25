import assert from 'node:assert'
import { BASE_NONCE_SIZE, KEY_SIZE, NONCE_SIZE } from '../src/constants.ts'
import { FIXTURE_BASE_NONCE_7, FIXTURE_IV_12, MINIMAL_ENVELOPE_TAG16_HEX } from './cose-fixtures.ts'

export const FIXED_CEK = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index)
export const HELLO = new TextEncoder().encode('hello')

// Key 000102...1f, IV 000102...0b, plaintext "hello", and the minimal
// tag-16 Enc_structure. The final 21 bytes are 5 bytes of ciphertext plus
// the 16-byte GCM tag.
export const HELLO_VECTOR_HEX = `${MINIMAL_ENVELOPE_TAG16_HEX}2f67ba77aa3e5b52d043203a731722e538ba0f0538`

export async function withRandomValues<T>(
  implementation: Crypto['getRandomValues'],
  action: () => Promise<T>
): Promise<T> {
  const original = globalThis.crypto.getRandomValues
  globalThis.crypto.getRandomValues = implementation
  try {
    return await action()
  } finally {
    globalThis.crypto.getRandomValues = original
  }
}

export const fixedRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
  assert.strictEqual(array.length, NONCE_SIZE)
  array.set(FIXTURE_IV_12)
  return array
}) as Crypto['getRandomValues']

/** `getRandomValues` stub for the chunked scheme's 7-byte base nonce, drawn once per `aesGcmStream.encrypt` call. */
export const fixedBaseNonceRandomValues = ((array: Uint8Array<ArrayBuffer>) => {
  assert.strictEqual(array.length, BASE_NONCE_SIZE)
  array.set(FIXTURE_BASE_NONCE_7)
  return array
}) as Crypto['getRandomValues']
