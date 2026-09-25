/**
 * Shared helpers for the aes-gcm-stream*.test.ts suites: building sources,
 * draining `readable`, and a from-scratch decrypt for round-trip checks. Not
 * a test file itself (mocha only picks up test/**\/*.test.ts).
 */
import assert from 'node:assert'
import { chunkLayout } from '../src/chunk-layout.ts'
import { TAG_SIZE } from '../src/constants.ts'
import { decodeEnvelope } from '../src/cose/decode.ts'
import { encStructure } from '../src/cose/enc-structure.ts'
import { deriveChunkNonce } from '../src/nonce.ts'
import { concatBytes } from './cose-fixtures.ts'

/** Deterministic plaintext: byte `i` of the whole (unchunked) source is `i & 0xff`. */
export function deterministicPlaintext(length: number): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => i & 0xff)
}

/** A source that enqueues each of `blocks` from its own `pull()`, one per call. */
export function sourceOf(blocks: Uint8Array[]): ReadableStream<Uint8Array> {
  let index = 0
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < blocks.length) {
        controller.enqueue(blocks[index])
        index++
      } else {
        controller.close()
      }
    },
  })
}

export async function readAllChunks(readable: ReadableStream<Uint8Array>): Promise<Uint8Array<ArrayBuffer>[]> {
  const reader = readable.getReader()
  const chunks: Uint8Array<ArrayBuffer>[] = []
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    chunks.push(value as Uint8Array<ArrayBuffer>)
  }
  return chunks
}

/** Read one chunk, asserting the stream isn't already done. */
export async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<Uint8Array<ArrayBuffer>> {
  const { value, done } = await reader.read()
  assert.strictEqual(done, false, 'expected another chunk, got end of stream')
  if (value === undefined) {
    throw new Error('test helper: read() reported not done but returned no value')
  }
  return value as Uint8Array<ArrayBuffer>
}

/**
 * Decrypt a full chunked object using this package's own `deriveChunkNonce`
 * and `chunkLayout` (already covered by their own unit tests) with a
 * directly supplied CEK. Used only for general round-trip checks; independent
 * oracle vectors never use this.
 */
export async function decryptChunkedOutput(full: Uint8Array, cek: Uint8Array): Promise<Uint8Array> {
  const decoded = decodeEnvelope(full)
  const { chunkSize } = decoded.protectedHeader
  if (chunkSize === undefined) {
    throw new Error('test helper: expected a chunked-scheme header')
  }
  const ciphertext = full.subarray(decoded.envelopeLength)
  const layout = chunkLayout(ciphertext.length, chunkSize)
  const aad = encStructure(decoded.tag, decoded.protectedHeader.bytes)
  const key = await globalThis.crypto.subtle.importKey('raw', new Uint8Array(cek), 'AES-GCM', false, ['decrypt'])

  const parts: Uint8Array[] = []
  let offset = 0
  for (let index = 0; index < layout.chunkCount; index++) {
    const isLast = index === layout.chunkCount - 1
    const cipherLength = isLast ? layout.lastChunkCipherLength : chunkSize + TAG_SIZE
    const chunkCiphertext = ciphertext.subarray(offset, offset + cipherLength) as Uint8Array<ArrayBuffer>
    offset += cipherLength
    const nonce = deriveChunkNonce(decoded.protectedHeader.iv, index, isLast)
    const plaintext = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: aad, tagLength: 128 },
      key,
      chunkCiphertext
    )
    parts.push(new Uint8Array(plaintext))
  }
  return concatBytes(...parts)
}
