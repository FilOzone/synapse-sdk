/**
 * Integration test of the tag-16 key resolver flow through the public API,
 * with a fake key library standing in for a real key service.
 */
import assert from 'assert'
import type { AppMetadata, ByteRange, KeyResolver } from '../src/index.ts'
import * as fee from '../src/index.ts'
import { deterministicPlaintext, readAllChunks } from './aes-gcm-stream-fixtures.ts'
import { concatBytes, hexToBytes } from './cose-fixtures.ts'
import { pipeBytes, recordingSource } from './helpers.ts'

const { MIN_CHUNK_SIZE } = fee.constants

/** Encrypt via the public root API and drive the stream to completion. */
async function encryptFull(plaintext: Uint8Array, options: Parameters<typeof fee.encrypt>[0]): Promise<Uint8Array> {
  return pipeBytes(fee.encrypt(options), plaintext)
}

/** Decrypt via the public root API (a direct key or a resolver) and drive the stream to completion. */
async function decryptFull(encoded: Uint8Array, key: Parameters<typeof fee.decrypt>[0]): Promise<Uint8Array> {
  return pipeBytes(fee.decrypt(key), encoded)
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/** The plaintext bytes `range` describes, from the documented semantics only -- not from planRange. */
function expectedSlice(fullPlaintext: Uint8Array, range: ByteRange): Uint8Array {
  const total = fullPlaintext.length
  if (range.offset < 0) {
    return fullPlaintext.subarray(Math.max(0, total + range.offset))
  }
  const end = range.length === undefined ? total : Math.min(total, range.offset + range.length)
  return fullPlaintext.subarray(range.offset, end)
}

interface FakeKeyLibrary {
  newObjectMetadata(scope: string): AppMetadata
  deriveKey(metadata: AppMetadata): Promise<Uint8Array>
  resolver: KeyResolver
  calls: { resolver: number; derive: number }
}

/**
 * Stand-in for a real key service: derives a per-object CEK from a master
 * secret via HKDF-SHA256, keyed by metadata the object itself carries
 * (`salt`, `scope`). `resolver` checks `scope` membership before deriving,
 * the shape a real gatekeeping key service would have.
 */
function createFakeKeyLibrary(masterSecret: Uint8Array, allowedScopes: string[]): FakeKeyLibrary {
  const calls = { resolver: 0, derive: 0 }

  function newObjectMetadata(scope: string): AppMetadata {
    return { salt: toHex(crypto.getRandomValues(new Uint8Array(16))), scope }
  }

  async function deriveKey(metadata: AppMetadata): Promise<Uint8Array> {
    calls.derive++
    const salt = hexToBytes(metadata.salt as string) as Uint8Array<ArrayBuffer>
    const info = new TextEncoder().encode(metadata.scope as string)
    const baseKey = await crypto.subtle.importKey('raw', masterSecret as Uint8Array<ArrayBuffer>, 'HKDF', false, [
      'deriveBits',
    ])
    const bits = await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, baseKey, 256)
    return new Uint8Array(bits)
  }

  const resolver: KeyResolver = async (envelopeInfo) => {
    calls.resolver++
    const metadata = envelopeInfo.appMetadata
    if (
      metadata === undefined ||
      typeof metadata.salt !== 'string' ||
      typeof metadata.scope !== 'string' ||
      !allowedScopes.includes(metadata.scope)
    ) {
      throw new Error(`fake key library: rejected scope ${JSON.stringify(metadata?.scope)}`)
    }
    return deriveKey(metadata)
  }

  return { newObjectMetadata, deriveKey, resolver, calls }
}

const MASTER_SECRET = Uint8Array.from({ length: 32 }, (_, index) => index + 1)
const SCOPE = 'project-42'
// A partial last chunk, then an exact multiple of MIN_CHUNK_SIZE.
const SIZES = [MIN_CHUNK_SIZE * 2 + 100, MIN_CHUNK_SIZE * 2]
const RANGES: Array<[string, ByteRange]> = [
  ['crossing a chunk boundary', { offset: MIN_CHUNK_SIZE - 50, length: 100 }],
  ['a suffix', { offset: -100 }],
]

describe('key resolver flow (tag 16, through the public API)', () => {
  describe('stream flow', () => {
    for (const size of SIZES) {
      for (const withContentLength of [true, false]) {
        it(`round-trips with a resolver-derived key (size ${size}, contentLength ${withContentLength})`, async () => {
          const lib = createFakeKeyLibrary(MASTER_SECRET, [SCOPE])
          const appMetadata = lib.newObjectMetadata(SCOPE)
          const cek = await lib.deriveKey(appMetadata)
          const plaintext = deterministicPlaintext(size)
          const encoded = await encryptFull(plaintext, {
            cek,
            appMetadata,
            chunkSize: MIN_CHUNK_SIZE,
            ...(withContentLength ? { contentLength: size } : {}),
          })

          const decrypted = await decryptFull(encoded, lib.resolver)
          assert.deepStrictEqual(decrypted, plaintext)
          assert.strictEqual(lib.calls.resolver, 1)
        })
      }
    }
  })

  describe('range flow', () => {
    for (const size of SIZES) {
      for (const withContentLength of [true, false]) {
        for (const [label, range] of RANGES) {
          it(`reads a range (${label}) after parse (size ${size}, contentLength ${withContentLength})`, async () => {
            const lib = createFakeKeyLibrary(MASTER_SECRET, [SCOPE])
            const appMetadata = lib.newObjectMetadata(SCOPE)
            const cek = await lib.deriveKey(appMetadata)
            const plaintext = deterministicPlaintext(size)
            const encoded = await encryptFull(plaintext, {
              cek,
              appMetadata,
              chunkSize: MIN_CHUNK_SIZE,
              ...(withContentLength ? { contentLength: size } : {}),
            })

            const { source, calls } = recordingSource(encoded)
            const info = await fee.parse(source)
            assert.strictEqual(info.scheme, 'chunked')
            if (info.scheme !== 'chunked') return
            const callsAfterParse = calls.length
            assert.ok(info.appMetadata !== undefined)

            const key = await lib.resolver(info)
            const result = await fee.decryptRange(source, key, range, { params: info.params })
            const bytes = concatBytes(...(await readAllChunks(result.stream)))

            assert.deepStrictEqual(bytes, expectedSlice(plaintext, range))
            // Exactly one more call than parse made, and it's the ciphertext
            // span -- proving `options.params` skipped a second envelope read.
            assert.strictEqual(calls.length, callsAfterParse + 1)
            assert.deepStrictEqual(calls[calls.length - 1], result.ciphertextSpan)
          })
        }
      }
    }
  })

  it('fails a scope outside allowedScopes with KeyResolutionError, deriving nothing', async () => {
    const buildLib = createFakeKeyLibrary(MASTER_SECRET, [])
    const appMetadata = buildLib.newObjectMetadata('scope-not-allowed')
    const cek = await buildLib.deriveKey(appMetadata)
    const encoded = await encryptFull(deterministicPlaintext(500), { cek, appMetadata, chunkSize: MIN_CHUNK_SIZE })

    const lib = createFakeKeyLibrary(MASTER_SECRET, [SCOPE]) // does not allow 'scope-not-allowed'
    await assert.rejects(
      decryptFull(encoded, lib.resolver),
      (error: unknown) =>
        error instanceof fee.errors.KeyResolutionError &&
        error.cause instanceof Error &&
        error.cause.message.includes('scope-not-allowed')
    )
    assert.strictEqual(lib.calls.resolver, 1)
    assert.strictEqual(lib.calls.derive, 0)
  })
})
