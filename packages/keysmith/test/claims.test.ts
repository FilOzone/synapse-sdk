import assert from 'assert'
import { decode, encode } from 'cborg'
import type { Hex } from 'viem'
import { hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  decodeDelivery,
  decodePresentation,
  delegateClaim,
  encodeDelivery,
  encodePresentation,
  openDelivery,
  type PieceLabels,
  rootClaim,
  signRequest,
  verifyChain,
  verifyPresentation,
} from '../src/claims.ts'
import { commitment, grantDescriptor, keyspaceKeys, newSalt, scopeKey } from '../src/derive.ts'
import { encodeGrant, publicKeyOf, wrapTo } from '../src/wrap.ts'

const owner = privateKeyToAccount(generatePrivateKey())
const aKey = generatePrivateKey()
const bKey = generatePrivateKey()
const a = privateKeyToAccount(aKey)
const b = privateKeyToAccount(bKey)
const stranger = privateKeyToAccount(generatePrivateKey())
const keyspace = '0x00112233445566778899aabbccddeeff' as Hex
const chainId = 314159n
const ref = { owner: owner.address, keyspace }
const now = 1_800_000_000
const expires = now + 7 * 86400

const keys = async () => keyspaceKeys(owner, ref)
const labels = (scope?: string, salt: Hex = newSalt()): PieceLabels => ({
  'foc/own': owner.address.toLowerCase(),
  'foc/ks': keyspace,
  ...(scope ? { 'foc/scope': scope } : {}),
  'foc/salt': salt,
})
const PIECE = hexToBytes('0x0155912024a8a2a4d3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3')

/** The root for `a`, signed by the owner. */
async function root(node: string, maxDepth: number) {
  const { kk, commitment: kc } = await keys()
  const key = node === 'keyspace' ? kk : scopeKey(kk, node.slice('scope:'.length))
  const chain = await rootClaim(owner, {
    ...ref,
    chainId,
    keyspaceCommitment: kc,
    node,
    bearer: a.address,
    maxDepth,
    nodeKey: key,
    expires,
  })
  return { chain, kk, kc, key }
}

describe('claims', () => {
  it('verifies a root signed by the owner until it expires, and refuses one signed by anyone else', async () => {
    const { chain, kk, kc } = await root('keyspace', 1)
    const claim = await verifyChain(chain, { now })
    assert.equal(claim.bearer, a.address)
    assert.equal(claim.node, 'keyspace')
    assert.equal(claim.expires, expires)
    await assert.rejects(verifyChain(chain, { now: expires + 3600 }), /expired/)
    await assert.rejects(verifyChain({ ...chain, expires: expires + 86400 }, { now }), /not signed by the owner/)

    const input = {
      ...ref,
      chainId,
      keyspaceCommitment: kc,
      node: 'keyspace',
      bearer: a.address,
      maxDepth: 1,
      nodeKey: kk,
      expires,
    }
    await assert.rejects(rootClaim(stranger, input), /must be signed by/)
    const forged = await rootClaim(stranger, { ...input, owner: stranger.address })
    await assert.rejects(verifyChain({ ...forged, owner: owner.address }, { now }), /not signed by the owner/)
    await assert.rejects(
      rootClaim(owner, { ...input, nodeKey: scopeKey(kk, 'team') }),
      /keyspace root carries the keyspace key/
    )
  })

  it('delegates narrower links, and refuses wider, deeper or forged ones', async () => {
    const { chain, kk } = await root('scope:team', 1)
    const alice = { node: 'scope:team/alice', maxDepth: 0, nodeKey: scopeKey(kk, 'team/alice') }
    const two = await delegateClaim(a, chain, { ...alice, bearer: b.address })
    const claim = await verifyChain(two, { now })
    assert.equal(claim.node, 'scope:team/alice')
    assert.equal(claim.expires, expires)

    await assert.rejects(
      delegateClaim(a, chain, { node: 'scope:other', bearer: b.address, maxDepth: 0, nodeKey: scopeKey(kk, 'other') }),
      /widens scope:team to scope:other/
    )
    await assert.rejects(delegateClaim(b, two, { ...alice, bearer: stranger.address }), /exceeds link 1's maxDepth/)
    const forged = await delegateClaim(stranger, chain, { ...alice, bearer: b.address })
    await assert.rejects(verifyChain(forged, { now }), /not signed by link 0's bearer/)
    const deepened = { ...two, links: [two.links[0], { ...two.links[1], maxDepth: 3 }] } as typeof two
    await assert.rejects(verifyChain(deepened, { now }), /not signed by link 0's bearer/)
    await assert.rejects(verifyChain(two, { now: expires + 3600 }), /expired/)
  })

  it('opens a delivery, checking bearer, node and the key against its commitment', async () => {
    const { chain, kk, kc, key: role } = await root('scope:team/alice', 0)
    const grant = await wrapTo(publicKeyOf(aKey), role, grantDescriptor(ref, 'scope:team/alice'))
    const delivery = encodeDelivery(chain, grant)
    const opened = await openDelivery(aKey, delivery, { now })
    assert.deepEqual(opened.key, role)
    assert.equal(`v1.${opened.claim.keyspaceCommitment.slice(2)}`, kc)
    assert.equal(commitment(opened.key).slice(3), opened.claim.keyCommitment.slice(2))

    await assert.rejects(openDelivery(bKey, delivery, { now }), /another bearer/)
    const swapped = await wrapTo(publicKeyOf(aKey), scopeKey(kk, 'team/bob'), grantDescriptor(ref, 'scope:team/alice'))
    await assert.rejects(openDelivery(aKey, encodeDelivery(chain, swapped), { now }), /does not match the commitment/)
    const otherNode = await wrapTo(publicKeyOf(aKey), role, grantDescriptor(ref, 'scope:team'))
    assert.throws(() => encodeDelivery(chain, otherNode), /another node/)
    // Built elsewhere, without encodeDelivery's check: the bearer still refuses it.
    const [, links] = decode(delivery, { useMaps: true }) as [number, unknown]
    await assert.rejects(openDelivery(aKey, encode([1, links, encodeGrant(otherNode)]), { now }), /another node/)
    await assert.rejects(openDelivery(aKey, delivery, { now: expires + 3600 }), /expired/)
  })

  it('verifies a presentation the way a gating provider would', async () => {
    const { chain, kk } = await root('scope:team', 1)
    const two = await delegateClaim(a, chain, {
      node: 'scope:team/alice',
      bearer: b.address,
      maxDepth: 0,
      nodeKey: scopeKey(kk, 'team/alice'),
    })
    const present = async (signer = b, at = now + 120, providerId = 7n) =>
      encodePresentation(two, await signRequest(signer, two, { providerId, pieceCid: PIECE, expires: at }))
    const check = (bytes: Uint8Array, piece: PieceLabels, at = now) =>
      verifyPresentation(bytes, { providerId: 7n, pieceCid: PIECE, piece, chainId, now: at })

    assert.equal((await check(await present(), labels('team/alice'))).bearer, b.address)
    assert.equal((await check(await present(), labels('team/alice/notes'))).node, 'scope:team/alice')
    await assert.rejects(check(await present(), labels('team/bob')), /does not reach this piece/)
    await assert.rejects(check(await present(), labels()), /does not reach this piece/)
    await assert.rejects(check(await present(a), labels('team/alice')), /not signed by the final bearer/)
    await assert.rejects(check(await present(b, now - 3600), labels('team/alice')), /expired/)
    await assert.rejects(check(await present(b, now + 3600), labels('team/alice')), /too long/)
    await assert.rejects(check(await present(b, now + 120, 8n), labels('team/alice')), /another provider/)
    await assert.rejects(
      check(await present(), { ...labels('team/alice'), 'foc/own': stranger.address }),
      /another owner/
    )
    const late = expires + 3600
    await assert.rejects(check(await present(b, late + 120), labels('team/alice'), late), /chain expired/)
    const ungated: PieceLabels = { 'foc/ks': keyspace, 'foc/salt': newSalt() }
    assert.ok(await check(await present(), ungated))
  })

  it('round-trips CBOR, and refuses links that repeat root fields, carry unknown ones or lack a signature', async () => {
    const { chain, kk } = await root('keyspace', 1)
    const two = await delegateClaim(a, chain, {
      node: 'scope:x',
      bearer: b.address,
      maxDepth: 0,
      nodeKey: scopeKey(kk, 'x'),
    })
    const grant = await wrapTo(publicKeyOf(bKey), scopeKey(kk, 'x'), grantDescriptor(ref, 'scope:x'))
    assert.deepEqual(decodeDelivery(encodeDelivery(two, grant)).chain, two)
    const request = await signRequest(b, two, { providerId: 7n, pieceCid: PIECE, expires: 1 })
    assert.deepEqual(decodePresentation(encodePresentation(two, request)), { chain: two, request })

    const [, links, grantBytes] = decode(encodeDelivery(two, grant), { useMaps: true }) as [
      number,
      Map<number, unknown>[],
      Uint8Array,
    ]
    const [l0, l1] = links as [Map<number, unknown>, Map<number, unknown>]
    const redo = (r: Map<number, unknown>, l: Map<number, unknown>) => encode([1, [r, l], grantBytes])
    const without = (m: Map<number, unknown>, k: number) => new Map([...m].filter(([key]) => key !== k))
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(2, hexToBytes(owner.address)))), /root-only field/)
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(11, expires))), /root-only field/)
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(12, 1))), /unknown field/)
    assert.throws(() => decodeDelivery(redo(without(l0, 8), l1)), /signature must be 65 bytes/)
    assert.throws(() => decodeDelivery(redo(without(l0, 11), l1)), /root expiry/)
    assert.throws(() => decodeDelivery(encode([2, links, grantBytes])), /version 1 delivery/)
  })
})
