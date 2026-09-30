import assert from 'assert'
import { type ChunkedEncryptOptions, decrypt, encrypt, type KeyResolver } from '../src/aes-gcm-stream.ts'
import { KEY_SIZE, MIN_CHUNK_SIZE } from '../src/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { AuthenticationError, InvalidKeyError, KeyResolutionError } from '../src/errors.ts'
import { type EnvelopeInfo, parse } from '../src/range/inspect.ts'
import { deterministicPlaintext, readAllChunks } from './aes-gcm-stream-fixtures.ts'
import { concatBytes } from './cose-fixtures.ts'
import { a256kwRecipient as recipient } from './helpers.ts'

const CHUNK_SIZE = MIN_CHUNK_SIZE

function testKey(fill: number): Uint8Array {
  return Uint8Array.from({ length: KEY_SIZE }, (_, index) => fill + index)
}

/** Encrypt via the production writer and drive it to completion. */
async function encryptFull(
  plaintext: Uint8Array,
  cek: Uint8Array,
  extra: Partial<ChunkedEncryptOptions> = {}
): Promise<Uint8Array> {
  const { writable, readable } = encrypt({ cek: new Uint8Array(cek), chunkSize: CHUNK_SIZE, ...extra })
  const writer = writable.getWriter()
  const writeDone = writer.write(plaintext)
  const closeDone = writer.close()
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return concatBytes(...chunks)
}

/** Drive decrypt() to completion (or rejection) with `encoded` delivered in one write. */
async function decryptChunks(encoded: Uint8Array, key: Uint8Array | KeyResolver): Promise<Uint8Array<ArrayBuffer>[]> {
  const { writable, readable } = decrypt(key)
  const writer = writable.getWriter()
  const writeDone = writer.write(encoded)
  const closeDone = writer.close()
  writeDone.catch(() => {
    // Surfaced via readAllChunks below either way; avoid an unhandled rejection.
  })
  closeDone.catch(() => {
    // Same: an incomplete/invalid object rejects close(), read already reports it.
  })
  const chunks = await readAllChunks(readable)
  await writeDone
  await closeDone
  return chunks
}

async function decryptBytes(encoded: Uint8Array, key: Uint8Array | KeyResolver): Promise<Uint8Array> {
  return concatBytes(...(await decryptChunks(encoded, key)))
}

/** A deterministic stand-in for a KMS-derived key: SHA-256 of salt || scope. */
async function deriveKeyFromMetadata(appMetadata: Record<string, unknown> | undefined): Promise<Uint8Array> {
  const salt = appMetadata?.salt
  const scope = appMetadata?.scope
  if (!(salt instanceof Uint8Array) || typeof scope !== 'string') {
    throw new Error('test helper: appMetadata is missing salt/scope')
  }
  const material = concatBytes(salt, new TextEncoder().encode(scope)) as Uint8Array<ArrayBuffer>
  const digest = await globalThis.crypto.subtle.digest('SHA-256', material)
  return new Uint8Array(digest)
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  outer: for (let offset = 0; offset <= haystack.length - needle.length; offset++) {
    for (let index = 0; index < needle.length; index++) {
      if (haystack[offset + index] !== needle[index]) continue outer
    }
    return offset
  }
  throw new Error('test helper: subsequence not found')
}

describe('aesGcmStream.decrypt with a KeyResolver', () => {
  it('derives the key from appMetadata and round-trips (keysmith flow)', async () => {
    const appMetadata = { salt: Uint8Array.from({ length: 16 }, (_, i) => i + 1), scope: 'tenant-42' }
    const cek = await deriveKeyFromMetadata(appMetadata)
    const plaintext = deterministicPlaintext(CHUNK_SIZE + 100)
    const encoded = await encryptFull(plaintext, cek, { appMetadata })

    const resolver: KeyResolver = (info) => deriveKeyFromMetadata(info.appMetadata as Record<string, unknown>)
    assert.deepStrictEqual(await decryptBytes(encoded, resolver), plaintext)
  })

  it('gives the resolver info deep-equal to parse() of the same bytes, called exactly once', async () => {
    const cek = testKey(1)
    const appMetadata = { note: 'hello' }
    const encoded = await encryptFull(deterministicPlaintext(200), cek, { appMetadata, contentType: 'text/plain' })
    const expected = await parse(encoded)

    let calls = 0
    let seen: EnvelopeInfo | undefined
    const resolver: KeyResolver = (info) => {
      calls++
      seen = info
      return cek
    }
    await decryptBytes(encoded, resolver)
    assert.strictEqual(calls, 1)
    assert.deepStrictEqual(seen, expected)
    // Explicit values too: parse() and the resolver share the same builder.
    assert.ok(seen !== undefined)
    assert.strictEqual(seen.scheme, 'chunked')
    assert.strictEqual(seen.contentType, 'text/plain')
    assert.strictEqual((seen.appMetadata as Record<string, unknown>).note, 'hello')
    assert.deepStrictEqual(seen.recipients, [])
  })

  it('works with a synchronous resolver', async () => {
    const cek = testKey(2)
    const plaintext = deterministicPlaintext(50)
    const encoded = await encryptFull(plaintext, cek)
    const resolver: KeyResolver = () => cek
    assert.deepStrictEqual(await decryptBytes(encoded, resolver), plaintext)
  })

  it('works with a tag-96 object through a resolver that ignores recipients', async () => {
    const cek = testKey(3)
    const kek = testKey(0x80)
    const plaintext = deterministicPlaintext(50)
    const encoded = await encryptFull(plaintext, cek, { recipients: [recipient(kek)] })
    const resolver: KeyResolver = () => cek
    assert.deepStrictEqual(await decryptBytes(encoded, resolver), plaintext)
  })

  it('still calls the resolver on tampered appMetadata, but decryption fails with AuthenticationError', async () => {
    const cek = testKey(4)
    const appMetadata = { note: 'hello' }
    const plaintext = deterministicPlaintext(50)
    const encoded = await encryptFull(plaintext, cek, { appMetadata })
    const envelopeLength = decodeEnvelope(encoded).envelopeLength
    // Flip a byte inside app_metadata's own string content: same length, so
    // the envelope still decodes, but the authenticated bytes now differ.
    const marker = new TextEncoder().encode('hello')
    const offset = findBytes(encoded.subarray(0, envelopeLength), marker)
    const tampered = new Uint8Array(encoded)
    tampered[offset] ^= 0x01

    let calls = 0
    const resolver: KeyResolver = () => {
      calls++
      return cek
    }
    await assert.rejects(decryptBytes(tampered, resolver), AuthenticationError)
    assert.strictEqual(calls, 1)
  })

  describe('a resolver returning an invalid key', () => {
    const badKeys: Array<[string, unknown]> = [
      ['wrong length', new Uint8Array(KEY_SIZE - 1)],
      ['all-zero', new Uint8Array(KEY_SIZE)],
      ['not a Uint8Array', 'nope'],
    ]
    for (const [label, badKey] of badKeys) {
      it(`rejects a resolver returning a key that is ${label}`, async () => {
        const cek = testKey(5)
        const encoded = await encryptFull(deterministicPlaintext(20), cek)
        const resolver: KeyResolver = () => badKey as Uint8Array
        await assert.rejects(decryptBytes(encoded, resolver), InvalidKeyError)
      })
    }
  })

  describe('a failing resolver', () => {
    it('wraps a synchronously thrown error as KeyResolutionError with the exact cause', async () => {
      const cek = testKey(6)
      const encoded = await encryptFull(deterministicPlaintext(20), cek)
      const boom = new Error('boom')
      const resolver: KeyResolver = () => {
        throw boom
      }
      await assert.rejects(
        decryptBytes(encoded, resolver),
        (error: unknown) => error instanceof KeyResolutionError && error.cause === boom
      )
    })

    it('wraps a rejected promise as KeyResolutionError with the exact cause', async () => {
      const cek = testKey(7)
      const encoded = await encryptFull(deterministicPlaintext(20), cek)
      const boom = new Error('boom')
      const resolver: KeyResolver = async () => {
        throw boom
      }
      await assert.rejects(
        decryptBytes(encoded, resolver),
        (error: unknown) => error instanceof KeyResolutionError && error.cause === boom
      )
    })
  })

  describe('malformed input', () => {
    const badInputs: Array<[string, unknown]> = [
      ['a string', 'nope'],
      ['null', null],
      ['a plain object', {}],
    ]
    for (const [label, value] of badInputs) {
      it(`throws InvalidKeyError synchronously for ${label}`, () => {
        assert.throws(() => decrypt(value as Uint8Array), InvalidKeyError)
      })
    }
  })

  describe('cancel and abort', () => {
    it('does not call the resolver when input fails before the first read', async () => {
      const cek = testKey(8)
      const encoded = await encryptFull(deterministicPlaintext(20), cek)
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      let calls = 0
      const resolver: KeyResolver = () => {
        calls++
        return cek
      }
      const { writable, readable } = decrypt(resolver)
      const writer = writable.getWriter()
      await writer.write(encoded.subarray(0, envelopeLength)) // envelope only, framer created

      const reason = new Error('abort after envelope, before any read')
      await writer.abort(reason)
      await assert.rejects(readable.getReader().read(), (err) => err === reason)
      assert.strictEqual(calls, 0)
    })

    it('rejects a pending read with the abort reason when aborted while the resolver is pending', async () => {
      const cek = testKey(9)
      const encoded = await encryptFull(deterministicPlaintext(20), cek)
      const envelopeLength = decodeEnvelope(encoded).envelopeLength
      let releaseResolver: (() => void) | undefined
      const gate = new Promise<void>((resolve) => {
        releaseResolver = resolve
      })
      let resolveEntered: (() => void) | undefined
      const entered = new Promise<void>((resolve) => {
        resolveEntered = resolve
      })
      let calls = 0
      const resolver: KeyResolver = async () => {
        calls++
        resolveEntered?.()
        await gate
        return cek
      }
      const { writable, readable } = decrypt(resolver)
      const writer = writable.getWriter()
      await writer.write(encoded.subarray(0, envelopeLength)) // envelope only

      const reader = readable.getReader()
      const pending = reader.read() // triggers the handoff, then the gated resolver call
      await entered // wait until the resolver has actually started and is blocked on `gate`

      const reason = new Error('abort while resolver pending')
      const abortDone = writer.abort(reason) // signal fires synchronously, before this settles
      releaseResolver?.() // let the (now-pointless) resolver call finish after the abort

      await assert.rejects(pending, (err) => err === reason)
      await abortDone
      assert.strictEqual(calls, 1)
    })
  })
})

describe('aesGcmStream.decrypt with a resolver that never settles', () => {
  it('still ends a pending read when the writable is aborted', async () => {
    const cek = testKey(10)
    const encoded = await encryptFull(deterministicPlaintext(100), cek)
    let signalEntered: (() => void) | undefined
    const entered = new Promise<void>((resolve) => {
      signalEntered = resolve
    })
    const { writable, readable } = decrypt(() => {
      signalEntered?.()
      return new Promise<Uint8Array>(() => {
        // A KMS call that never answers.
      })
    })
    const writer = writable.getWriter()
    const read = readable.getReader().read()
    await writer.write(encoded.subarray(0, decodeEnvelope(encoded).envelopeLength))
    await entered // the resolver is now pending

    const reason = new Error('abort while the resolver hangs')
    await writer.abort(reason)
    await assert.rejects(read, (err) => err === reason)
  })
})
