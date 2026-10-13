import assert from 'node:assert'
import {
  DEFAULT_CHUNK_SIZE,
  KEY_SIZE,
  MAX_AES_GCM_PLAINTEXT_SIZE,
  MAX_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  MIN_CHUNK_SIZE,
} from '../src/constants.ts'
import { ALG_A256KW, ENVELOPE_TYPE } from '../src/cose/constants.ts'
import { EnvelopeError } from '../src/errors.ts'
// `../src/index.ts` (the root barrel) is the file under test here; every
// other test file in this package imports source files directly instead.
import * as fee from '../src/index.ts'

const EXPECTED_PUBLIC_CONSTANTS: Record<string, unknown> = {
  ALG_A256KW,
  DEFAULT_CHUNK_SIZE,
  ENVELOPE_TYPE,
  KEY_SIZE,
  MAX_AES_GCM_PLAINTEXT_SIZE,
  MAX_CHUNK_SIZE,
  MAX_ENCODED_OBJECT_SIZE,
  MIN_CHUNK_SIZE,
}

describe('public surface (src/index.ts)', () => {
  it('exposes exactly the allowlisted root runtime namespaces', () => {
    assert.deepStrictEqual(Object.keys(fee).sort(), ['aesGcm', 'constants', 'cose', 'errors', 'recipients'])
  })

  it('aesGcm exposes exactly decrypt, decryptWith, and encrypt', () => {
    assert.deepStrictEqual(Object.keys(fee.aesGcm).sort(), ['decrypt', 'decryptWith', 'encrypt'])
  })

  it('cose is decode-only: exposes exactly decodeEnvelope', () => {
    assert.deepStrictEqual(Object.keys(fee.cose).sort(), ['decodeEnvelope'])
  })

  it('recipients exposes exactly createA256KWUnwrapper', () => {
    assert.deepStrictEqual(Object.keys(fee.recipients), ['createA256KWUnwrapper'])
  })

  it('constants exposes exactly the curated public list, matching the owning modules', () => {
    assert.deepStrictEqual(Object.keys(fee.constants).sort(), Object.keys(EXPECTED_PUBLIC_CONSTANTS).sort())
    for (const [name, value] of Object.entries(EXPECTED_PUBLIC_CONSTANTS)) {
      assert.strictEqual((fee.constants as Record<string, unknown>)[name], value, name)
    }
  })

  it('errors exposes exactly the current error classes, each an EnvelopeError, and no hasErrorName helper', () => {
    const errors = fee.errors as unknown as Record<string, unknown>
    assert.deepStrictEqual(Object.keys(errors).sort(), [
      'AuthenticationError',
      'ChunkCountExceededError',
      'CriticalHeaderError',
      'CryptoOperationError',
      'EnvelopeError',
      'InvalidChunkSizeError',
      'InvalidCiphertextLengthError',
      'InvalidKeyError',
      'InvalidNonceError',
      'InvalidPlaintextError',
      'InvalidPlaintextLengthError',
      'MalformedEnvelopeError',
      'NoUsableRecipientError',
      'RecipientAttemptLimitError',
      'RecipientUnwrapError',
      'UnsupportedSchemeError',
    ])
    assert.strictEqual('hasErrorName' in errors, false)

    for (const [name, value] of Object.entries(errors)) {
      assert.strictEqual(typeof value, 'function', name)
      const ctor = value as new (...args: never[]) => unknown
      assert.ok(ctor === EnvelopeError || ctor.prototype instanceof EnvelopeError, `${name} must extend EnvelopeError`)
    }
  })
})
