import assert from 'assert'
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
import { concatBytes } from './cose-fixtures.ts'

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
  it('exposes exactly the allowlisted root runtime exports', () => {
    assert.deepStrictEqual(Object.keys(fee).sort(), [
      'aesGcm',
      'constants',
      'cose',
      'decrypt',
      'decryptRange',
      'decryptRangeWith',
      'decryptWith',
      'encrypt',
      'errors',
      'parse',
      'recipients',
    ])
  })

  it('parses and decrypts a range through the package root only, with a CEK and with a recipient', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index + 1)
    const kek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
    const plaintext = Uint8Array.from({ length: MIN_CHUNK_SIZE * 2 + 100 }, (_, index) => index & 0xff)
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext)
        controller.close()
      },
    })
    const encoded: Uint8Array[] = []
    for await (const chunk of source.pipeThrough(
      fee.encrypt({ cek, chunkSize: MIN_CHUNK_SIZE, recipients: [{ alg: ALG_A256KW, kek }] })
    )) {
      encoded.push(chunk)
    }
    const object = concatBytes(...encoded)

    const info = await fee.parse(object)
    assert.strictEqual(info.scheme, 'chunked')
    if (info.scheme !== 'chunked') return
    const range = { offset: MIN_CHUNK_SIZE - 10, length: 20 } // crosses the first chunk boundary
    const expected = plaintext.subarray(range.offset, range.offset + range.length)

    const direct = await fee.decryptRange(object, cek, range, { params: info.params })
    const directBytes: Uint8Array[] = []
    for await (const chunk of direct.stream) directBytes.push(chunk)
    assert.deepStrictEqual(concatBytes(...directBytes), expected)

    const unwrapper = await fee.recipients.createA256KWUnwrapper([{ kek }])
    const viaRecipient = await fee.decryptRangeWith(object, unwrapper, range)
    const recipientBytes: Uint8Array[] = []
    for await (const chunk of viaRecipient.stream) recipientBytes.push(chunk)
    assert.deepStrictEqual(concatBytes(...recipientBytes), expected)
  })

  it('encrypt works through the package root with pipeThrough', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index + 1)
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('hello'))
        controller.close()
      },
    })
    const chunks: Uint8Array[] = []
    for await (const chunk of source.pipeThrough(fee.encrypt({ cek, chunkSize: MIN_CHUNK_SIZE }))) {
      chunks.push(chunk)
    }
    // Envelope, then one final chunk: 5 plaintext bytes plus the 16-byte tag.
    assert.strictEqual(chunks.length, 2)
    assert.strictEqual(fee.cose.decodeEnvelope(chunks[0]).tag, 16)
    assert.strictEqual(chunks[1].length, 5 + 16)
  })

  it('round-trips through the package root only: encrypt then decrypt with a direct CEK', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index + 1)
    const plaintext = new TextEncoder().encode('hello, root barrel')
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext)
        controller.close()
      },
    })
    const chunks: Uint8Array[] = []
    for await (const chunk of source
      .pipeThrough(fee.encrypt({ cek, chunkSize: MIN_CHUNK_SIZE }))
      .pipeThrough(fee.decrypt(cek))) {
      chunks.push(chunk)
    }
    assert.deepStrictEqual(concatBytes(...chunks), plaintext)
  })

  it('round-trips through the package root only: encrypt then decryptWith an A256KW recipient', async () => {
    const cek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => index + 1)
    const kek = Uint8Array.from({ length: KEY_SIZE }, (_, index) => 0x80 + index)
    const plaintext = new TextEncoder().encode('hello, root barrel')
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(plaintext)
        controller.close()
      },
    })
    const unwrapper = await fee.recipients.createA256KWUnwrapper([{ kek }])
    const chunks: Uint8Array[] = []
    for await (const chunk of source
      .pipeThrough(fee.encrypt({ cek, chunkSize: MIN_CHUNK_SIZE, recipients: [{ alg: ALG_A256KW, kek }] }))
      .pipeThrough(fee.decryptWith(unwrapper))) {
      chunks.push(chunk)
    }
    assert.deepStrictEqual(concatBytes(...chunks), plaintext)
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
      'InvalidRangeError',
      'InvalidSourceLengthError',
      'KeyResolutionError',
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
