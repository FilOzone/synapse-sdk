import assert from 'assert'
import { encode } from 'cborg'
import { bytesToHex, type Hex, hashTypedData, hexToBytes } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  commitment,
  DOMAIN,
  dataSetMetadata,
  deriveGroupKey,
  GROUP_KEY_TYPES,
  groupKeyIdOf,
  groupKeyMessage,
  holdingOf,
  keyForEnvelope,
  keyForGroup,
  matchesCommitment,
  pieceMetadata,
  readPieceMetadata,
} from '../src/derive.ts'
import type { PieceMetadata } from '../src/types.ts'
import { decodeGrant, publicKeyOf, unwrapWith } from '../src/wrap.ts'
import vectors from './vectors.json' with { type: 'json' }

// Every other test compares the code with itself, so a change to a derivation
// passes them all. These pin actual outputs for fixed inputs: if one fails, a
// release would orphan every key derived before it. Other implementations can
// check themselves against the same file. Regenerate with scripts/generate-vectors.ts.
describe('test vectors', () => {
  const owner = privateKeyToAccount(vectors.owner.privateKey as Hex)
  const ref = { owner: owner.address, groupKeyId: vectors.groupKeyId as Hex }

  it('pins the group key and its commitment', async function () {
    this.timeout(30_000) // one Argon2id pass
    assert.equal(owner.address, vectors.owner.address)
    assert.equal(
      hashTypedData({ domain: DOMAIN, types: GROUP_KEY_TYPES, primaryType: 'GroupKey', message: groupKeyMessage(ref) }),
      vectors.groupKey.typedData.hash
    )
    const keys = await deriveGroupKey(owner, ref)
    assert.equal(bytesToHex(keys.groupKey), vectors.groupKey.groupKey)
    assert.equal(keys.commitment, vectors.groupKey.commitment)
    assert.equal(commitment(keys.groupKey), vectors.groupKey.commitment)
    const locked = await deriveGroupKey(owner, ref, { password: vectors.passwordGroupKey.password })
    assert.equal(bytesToHex(locked.groupKey), vectors.passwordGroupKey.groupKey)
    assert.equal(locked.commitment, vectors.passwordGroupKey.commitment)
  })

  it('pins the data set metadata, the group key, the envelope and the piece key', () => {
    const groupKeyBytes = hexToBytes(vectors.groupKey.groupKey as Hex)
    assert.deepStrictEqual(dataSetMetadata(ref, vectors.groupKey.commitment), vectors.dataSet)
    assert.equal(groupKeyIdOf(vectors.dataSet), vectors.groupKeyId)
    assert.equal(groupKeyIdOf(vectors.format1DataSet.dataSet), undefined)
    assert.equal(bytesToHex(keyForGroup(groupKeyBytes, vectors.group.path)), vectors.group.key)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.deepStrictEqual(
      pieceMetadata(ref, { salt: metadata['foc/salt'], group: metadata['foc/group'] as string }),
      metadata
    )
    assert.equal(bytesToHex(keyForEnvelope(groupKeyBytes, metadata)), vectors.piece.key)
  })

  it('pins the key-agreement key, the group grant and its authenticated bytes', async () => {
    assert.equal(publicKeyOf(vectors.recipient.privateKey as Hex), vectors.recipient.publicKey)
    const bytes = hexToBytes(vectors.grant.cbor as Hex)
    assert.equal(bytesToHex(await unwrapWith(vectors.recipient.privateKey as Hex, bytes)), vectors.group.key)
    const { v, node, owner, groupKeyId } = decodeGrant(bytes)
    assert.equal(node, `group:${vectors.group.path}`)
    assert.equal(
      bytesToHex(encode([v, node, hexToBytes(owner), hexToBytes(groupKeyId)])),
      vectors.grant.aad,
      'the authenticated bytes, as other implementations must build them'
    )
  })

  it('opens the pinned piece grant, for that piece only', async () => {
    const grant = decodeGrant(hexToBytes(vectors.pieceGrant.cbor as Hex))
    const node = await unwrapWith(vectors.recipient.privateKey as Hex, grant)
    const metadata = vectors.piece.metadata as PieceMetadata
    assert.equal(bytesToHex(keyForEnvelope(node, metadata, holdingOf(grant))), vectors.piece.key)
    const { v, node: n, owner, groupKeyId } = grant
    assert.equal(bytesToHex(encode([v, n, hexToBytes(owner), hexToBytes(groupKeyId)])), vectors.pieceGrant.aad)
  })

  describe('refuses what keysmith 0.1.0 wrote, by name', () => {
    const [envelope, grant, commitmentCase] = vectors.refused as unknown as [
      { metadata: Record<string, unknown>; reason: string },
      { cbor: string; reason: string },
      { commitment: string; reason: string },
    ]

    it('an envelope with foc/v 1', () => {
      assert.throws(
        () => readPieceMetadata(envelope.metadata),
        (err: Error) => err.message === envelope.reason
      )
      assert.throws(
        () => keyForEnvelope(new Uint8Array(32), envelope.metadata),
        (err: Error) => err.message === envelope.reason
      )
    })

    it('a grant with v 1', async () => {
      const bytes = hexToBytes(grant.cbor as Hex)
      assert.throws(
        () => decodeGrant(bytes),
        (err: Error) => err.message === grant.reason
      )
      await assert.rejects(
        unwrapWith(vectors.recipient.privateKey as Hex, bytes),
        (err: Error) => err.message === grant.reason
      )
    })

    it('a v1 commitment', () => {
      const groupKeyBytes = hexToBytes(vectors.groupKey.groupKey as Hex)
      assert.throws(
        () => matchesCommitment(groupKeyBytes, commitmentCase.commitment),
        (err: Error) => err.message === commitmentCase.reason
      )
    })
  })
})
