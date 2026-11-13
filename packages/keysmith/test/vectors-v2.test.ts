import assert from 'assert'
import { encode } from 'cborg'
import { bytesToHex, type Hex, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  deriveGroupKey,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  keyForGroup,
  pieceMetadata,
  readPieceMetadata,
} from '../src/derive.ts'
import type { PieceMetadata } from '../src/types.ts'
import { decodeGrant, publicKeyOf, unwrapWith } from '../src/wrap.ts'
import legacy from './vectors.json' with { type: 'json' }
import vectors from './vectors-v2.json' with { type: 'json' }

// Format 2 labels and grant nodes. These vectors were produced by this implementation
// (FIP-1253 draft), so they are not independent of it: they pin it against change.
// vectors.json is the legacy-read suite; the keys here equal its keys, since a key never
// depends on a label name or a node prefix.
describe('format 2 test vectors', () => {
  const owner = privateKeyToAccount(vectors.owner.privateKey as Hex)
  const ref = { owner: owner.address, groupKeyId: vectors.groupKeyId as Hex }

  it('pins the envelope, and its key is the one the format 1 envelope gave', async function () {
    this.timeout(30_000)
    const { kk } = await deriveGroupKey(owner, ref)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.deepStrictEqual(
      pieceMetadata(ref, { salt: metadata['foc/salt'], group: metadata['foc/group'] as string }),
      metadata
    )
    assert.equal(bytesToHex(keyForEnvelope(kk, metadata)), vectors.piece.key)
    assert.equal(vectors.piece.key, legacy.piece.key)
    assert.equal(bytesToHex(keyForGroup(kk, vectors.group.path)), vectors.group.key)
    assert.equal(vectors.group.key, legacy.scope.key)
  })

  it('pins the group grant, its authenticated bytes, and opens it', async () => {
    const bytes = hexToBytes(vectors.grant.cbor as Hex)
    assert.equal(bytesToHex(await unwrapWith(vectors.recipient.privateKey as Hex, bytes)), vectors.group.key)
    assert.equal(publicKeyOf(vectors.recipient.privateKey as Hex), vectors.recipient.publicKey)
    const { v, node, owner, groupKeyId } = decodeGrant(bytes)
    assert.equal(node, `group:${vectors.group.path}`)
    assert.equal(bytesToHex(encode([v, node, hexToBytes(owner), hexToBytes(groupKeyId)])), vectors.grant.aad)
  })

  it('opens the pinned piece grant, for that piece only', async () => {
    const grant = decodeGrant(hexToBytes(vectors.pieceGrant.cbor as Hex))
    const node = await unwrapWith(vectors.recipient.privateKey as Hex, grant)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.equal(bytesToHex(keyForEnvelope(node, metadata, holdingOf(grant))), vectors.piece.key)
    const { v, node: n, owner, groupKeyId } = grant
    assert.equal(bytesToHex(encode([v, n, hexToBytes(owner), hexToBytes(groupKeyId)])), vectors.pieceGrant.aad)
  })

  it('reads the format 1 and format 2 envelopes of one piece as the same labels', () => {
    const { version: a, ...v1 } = readPieceMetadata(legacy.piece.metadata)
    const { version: b, ...v2 } = readPieceMetadata(vectors.piece.metadata)
    assert.deepStrictEqual([a, b], [1, 2])
    assert.deepStrictEqual(v2, v1)
    // and a group grant names the same group under either spelling
    assert.deepStrictEqual(
      holdingOf(grantDescriptor(ref, `scope:${vectors.group.path}`)),
      holdingOf({ node: `scope:${vectors.group.path}` })
    )
  })
})
