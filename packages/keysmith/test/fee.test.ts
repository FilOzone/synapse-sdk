import assert from 'assert'
import * as fee from 'filecoin-encryption-envelope'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keyForEnvelope, keyResolver, keyspaceKeys, newSalt, pieceKey, pieceMetadata, scopeKey } from '../src/derive.ts'
import type { KeyspaceRef } from '../src/types.ts'

const account = privateKeyToAccount(generatePrivateKey())
const ref: KeyspaceRef = { owner: account.address, keyspace: '0x00112233445566778899aabbccddeeff' }

/**
 * Run bytes through a FEE stream and collect the output. Read directly: a
 * browser's Response turns a stream error into a bare "Failed to fetch".
 */
async function through(bytes: Uint8Array, stream: ReadableWritablePair<Uint8Array, Uint8Array>): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(stream).getReader()
  const chunks: Uint8Array[] = []
  for (let next = await reader.read(); !next.done; next = await reader.read()) chunks.push(next.value)
  const out = new Uint8Array(chunks.reduce((n, chunk) => n + chunk.length, 0))
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** An in-memory object FEE can read the envelope of. */
const source = (bytes: Uint8Array): fee.RandomAccessSource => ({
  size: bytes.length,
  openRange: async (offset, length) => new Blob([bytes.subarray(offset, offset + length) as BlobPart]).stream(),
})

describe('with the real FEE', () => {
  it('writes a piece under Keysmith keys and labels, and reads it back by resolving the key from the envelope', async () => {
    const { kk } = await keyspaceKeys(account, ref)
    const salt = newSalt()
    const metadata = pieceMetadata(ref, { salt, scope: 'agent-memory' })
    const plaintext = new TextEncoder().encode('agent-memory: notes')
    const cek = keyForEnvelope(kk, metadata)
    const encrypted = await through(
      plaintext,
      fee.encrypt({ cek, appMetadata: metadata, contentLength: plaintext.length })
    )

    const info = await fee.parse(source(encrypted))
    // FEE hands back a null-prototype object, so compare the contents
    assert.deepStrictEqual({ ...info.appMetadata }, metadata, 'the labels travel in the envelope unchanged')
    assert.deepStrictEqual(await through(encrypted, fee.decrypt(keyResolver(kk))), plaintext, 'the keyspace holder')
    const scoped = keyResolver(scopeKey(kk, 'agent-memory'), { scope: 'agent-memory' })
    assert.deepStrictEqual(await through(encrypted, fee.decrypt(scoped)), plaintext, 'a scope holder')
    assert.deepStrictEqual(
      await through(encrypted, fee.decrypt(keyResolver(cek, { piece: salt }))),
      plaintext,
      'a piece holder'
    )
    assert.deepStrictEqual(pieceKey(scopeKey(kk, 'agent-memory'), salt), cek)

    // A range read: derive the key from FEE's own parse of the envelope, as the README shows.
    if (info.scheme !== 'chunked') throw new Error('expected a chunked object')
    const ranged = await fee.decryptRange(
      source(encrypted),
      keyForEnvelope(kk, info.appMetadata),
      { offset: 0, length: 12 },
      { params: info.params }
    )
    const bytes = new Uint8Array(await new Response(ranged.stream).arrayBuffer())
    assert.equal(new TextDecoder().decode(bytes), 'agent-memory', 'the first 12 bytes, by range')
  })

  it('refuses a key the node does not reach, before decrypting anything', async () => {
    const { kk } = await keyspaceKeys(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'super-secret' })
    const encrypted = await through(
      new Uint8Array([1, 2, 3]),
      fee.encrypt({ cek: keyForEnvelope(kk, metadata), appMetadata: metadata })
    )
    const sibling = keyResolver(scopeKey(kk, 'agent-memory'), { scope: 'agent-memory' })
    await assert.rejects(through(encrypted, fee.decrypt(sibling)), (err: Error) =>
      [err.message, String((err as { cause?: Error }).cause?.message)].some((m) => /does not contain/.test(m))
    )
  })

  it('fails on a tampered label: the labels are authenticated', async () => {
    const { kk } = await keyspaceKeys(account, ref)
    const metadata = pieceMetadata(ref, { salt: newSalt(), scope: 'agent-memory' })
    const encrypted = await through(
      new TextEncoder().encode('secret'),
      fee.encrypt({ cek: keyForEnvelope(kk, metadata), appMetadata: metadata })
    )
    const label = new TextEncoder().encode('agent-memory')
    const at = encrypted.findIndex((_, i) => label.every((byte, j) => encrypted[i + j] === byte))
    assert.ok(at > 0)
    const tampered = encrypted.slice()
    tampered[at] ^= 0x01 // "agent-memory" → "`gent-memory": a scope the keyspace holder can still derive a key for
    await assert.rejects(through(tampered, fee.decrypt(keyResolver(kk))))
  })
})
