import assert from 'assert'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { commitment, keyForEnvelope, keyspaceKeys, pieceMetadata, roleKey } from '../src/derive.ts'
import type { Grant, PieceMetadata } from '../src/types.ts'
import { publicKeyOf, unwrapWith } from '../src/wrap.ts'
import vectors from './vectors.json' with { type: 'json' }

// Every other test compares the code with itself, so a change to a derivation
// passes them all. These pin actual outputs for fixed inputs: if one fails, a
// release would orphan every key derived before it. Other implementations can
// check themselves against the same file.
describe('test vectors', () => {
  const owner = privateKeyToAccount(vectors.owner.privateKey as Hex)
  const ref = { owner: owner.address, keyspace: vectors.keyspace as Hex }

  it('pins the keyspace key and commitment for each epoch', async () => {
    assert.equal(owner.address, vectors.owner.address)
    for (const { epoch, kk, commitment: c } of vectors.epochs) {
      const keys = await keyspaceKeys(owner, { ...ref, epoch })
      assert.equal(bytesToHex(keys.kk), kk, `KK, epoch ${epoch}`)
      assert.equal(keys.commitment, c, `commitment, epoch ${epoch}`)
      assert.equal(commitment(keys.kk, epoch), c)
    }
  })

  it('pins the role key, the envelope and the piece key', () => {
    const kkBytes = hexToBytes(vectors.epochs[0]?.kk as Hex)
    assert.equal(bytesToHex(roleKey(kkBytes, vectors.role.path)), vectors.role.key)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.deepStrictEqual(
      pieceMetadata(ref, { salt: metadata['foc/salt'], role: metadata['foc/role'] as string }),
      metadata
    )
    assert.equal(bytesToHex(keyForEnvelope(kkBytes, metadata)), vectors.piece.key)
  })

  it('pins the key-agreement key, and opens the pinned grant', async () => {
    assert.equal(publicKeyOf(vectors.recipient.privateKey as Hex), vectors.recipient.publicKey)
    const opened = await unwrapWith(vectors.recipient.privateKey as Hex, vectors.grant as Grant)
    assert.equal(bytesToHex(opened), vectors.role.key)
  })
})
