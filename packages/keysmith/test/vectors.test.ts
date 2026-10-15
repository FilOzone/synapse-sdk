import assert from 'assert'
import { encode } from 'cborg'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { commitment, holdingOf, keyForEnvelope, keyspaceKeys, pieceMetadata, scopeKey } from '../src/derive.ts'
import type { PieceMetadata } from '../src/types.ts'
import { decodeGrant, publicKeyOf, unwrapWith } from '../src/wrap.ts'
import vectors from './vectors.json' with { type: 'json' }

// Every other test compares the code with itself, so a change to a derivation
// passes them all. These pin actual outputs for fixed inputs: if one fails, a
// release would orphan every key derived before it. Other implementations can
// check themselves against the same file.
describe('test vectors', () => {
  const owner = privateKeyToAccount(vectors.owner.privateKey as Hex)
  const ref = { owner: owner.address, keyspace: vectors.keyspace as Hex }

  it('pins the keyspace key and its commitment', async () => {
    assert.equal(owner.address, vectors.owner.address)
    const keys = await keyspaceKeys(owner, ref)
    assert.equal(bytesToHex(keys.kk), vectors.keyspaceKey.kk)
    assert.equal(keys.commitment, vectors.keyspaceKey.commitment)
    assert.equal(commitment(keys.kk), vectors.keyspaceKey.commitment)
  })

  it('pins the scope key, the envelope and the piece key', () => {
    const kkBytes = hexToBytes(vectors.keyspaceKey.kk as Hex)
    assert.equal(bytesToHex(scopeKey(kkBytes, vectors.scope.path)), vectors.scope.key)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.deepStrictEqual(
      pieceMetadata(ref, { salt: metadata['foc/salt'], scope: metadata['foc/scope'] as string }),
      metadata
    )
    assert.equal(bytesToHex(keyForEnvelope(kkBytes, metadata)), vectors.piece.key)
  })

  it('pins the key-agreement key, and opens the pinned grant', async () => {
    assert.equal(publicKeyOf(vectors.recipient.privateKey as Hex), vectors.recipient.publicKey)
    const bytes = hexToBytes(vectors.grant.cbor as Hex)
    const opened = await unwrapWith(vectors.recipient.privateKey as Hex, bytes)
    assert.equal(bytesToHex(opened), vectors.scope.key)
    const { v, node, owner, keyspace } = decodeGrant(bytes)
    const aad = encode([v, node, hexToBytes(owner), hexToBytes(keyspace)])
    assert.equal(
      bytesToHex(aad),
      vectors.grant.aad,
      'the authenticated bytes, as other implementations must build them'
    )
  })

  it('opens the pinned piece grant, for that piece only', async () => {
    const grant = decodeGrant(hexToBytes(vectors.pieceGrant.cbor as Hex))
    const node = await unwrapWith(vectors.recipient.privateKey as Hex, grant)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.equal(bytesToHex(keyForEnvelope(node, metadata, holdingOf(grant))), vectors.piece.key)
  })
})
