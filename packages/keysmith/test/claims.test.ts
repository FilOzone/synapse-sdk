import assert from 'assert'
import { decode, encode } from 'cborg'
import type { Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
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
import {
  canonicalNode,
  commitment,
  grantDescriptor,
  keyForEnvelope,
  keyspaceKeys,
  newSalt,
  scopeKey,
} from '../src/derive.ts'
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
  const { chain, nodeKey } = await rootClaim(owner, { ...ref, chainId, kk, node, bearer: a.address, maxDepth, expires })
  return { chain, kk, kc, key: nodeKey }
}

describe('claims', () => {
  it('verifies a root signed by the owner until it expires, and refuses one signed by anyone else', async () => {
    const { chain, kk, kc, key } = await root('keyspace', 1)
    assert.deepEqual(key, kk)
    assert.equal(`v1.${chain.keyspaceCommitment.slice(2)}`, kc)
    const claim = await verifyChain(chain, { now })
    assert.equal(claim.bearer, a.address)
    assert.equal(claim.node, 'keyspace')
    assert.equal(claim.expires, expires)
    await assert.rejects(verifyChain(chain, { now: expires + 3600 }), /expired/)
    await assert.rejects(verifyChain({ ...chain, expires: expires + 86400 }, { now }), /not signed by the owner/)

    const input = { ...ref, chainId, kk, node: 'keyspace', bearer: a.address, maxDepth: 1, expires }
    await assert.rejects(rootClaim(stranger, input), /must be signed by/)
    const forged = await rootClaim(stranger, { ...input, owner: stranger.address })
    await assert.rejects(verifyChain({ ...forged.chain, owner: owner.address }, { now }), /not signed by the owner/)
    await assert.rejects(rootClaim(owner, { ...input, expires: undefined as never }), /expires must be unix seconds/)
  })

  it('derives the root key from the keyspace key, for a scope and for one piece', async () => {
    const { kk } = await keys()
    const base = { ...ref, chainId, kk, bearer: a.address, maxDepth: 0, expires }
    const scoped = await rootClaim(owner, { ...base, node: 'scope:team' })
    assert.deepEqual(scoped.nodeKey, scopeKey(kk, 'team'))

    const piece = labels('team', newSalt())
    const one = await rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}`, piece })
    assert.deepEqual(one.nodeKey, keyForEnvelope(kk, { 'foc/v': 1, ...piece }))
    await assert.rejects(rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}` }), /needs the piece's labels/)
    await assert.rejects(
      rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}`, piece: labels('team') }),
      /not for piece:/
    )
  })

  it('delegates narrower links with keys derived from the parent, and refuses wider, deeper or forged ones', async () => {
    const { chain, kk, key: team } = await root('scope:team', 1)
    const alice = { node: 'scope:team/alice', maxDepth: 0 }
    const { chain: two, nodeKey } = await delegateClaim(a, chain, { ...alice, parentKey: team, bearer: b.address })
    assert.deepEqual(nodeKey, scopeKey(kk, 'team/alice'))
    const claim = await verifyChain(two, { now })
    assert.equal(claim.node, 'scope:team/alice')
    assert.equal(claim.expires, expires)

    // A key that is not the parent's cannot be delegated from: the honest path cannot mint a wrong key.
    const random = crypto.getRandomValues(new Uint8Array(32))
    await assert.rejects(
      delegateClaim(a, chain, { ...alice, parentKey: random, bearer: b.address }),
      /parentKey is not the key link 0 commits to/
    )
    await assert.rejects(
      delegateClaim(a, chain, { node: 'scope:other', parentKey: team, bearer: b.address, maxDepth: 0 }),
      /widens scope:team to scope:other/
    )
    await assert.rejects(
      delegateClaim(b, two, { ...alice, parentKey: nodeKey, bearer: stranger.address }),
      /exceeds link 1's maxDepth/
    )
    const forged = await delegateClaim(stranger, chain, { ...alice, parentKey: team, bearer: b.address })
    await assert.rejects(verifyChain(forged.chain, { now }), /not signed by link 0's bearer/)
    const deepened = { ...two, links: [two.links[0], { ...two.links[1], maxDepth: 3 }] } as typeof two
    await assert.rejects(verifyChain(deepened, { now }), /not signed by link 0's bearer/)
    await assert.rejects(verifyChain(two, { now: expires + 3600 }), /expired/)

    // A piece link: the key is the piece's own, derived through the parent's scope.
    const piece = labels('team/notes', newSalt())
    const one = await delegateClaim(a, chain, {
      node: `piece:${piece['foc/salt']}`,
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
      piece,
    })
    assert.deepEqual(one.nodeKey, keyForEnvelope(kk, { 'foc/v': 1, ...piece }))
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
    assert.equal(opened.expired, false)
  })

  it('opens an expired delivery for its key, but refuses to use its claim', async () => {
    const { chain, key: team } = await root('scope:team', 1)
    const delivery = encodeDelivery(chain, await wrapTo(publicKeyOf(aKey), team, grantDescriptor(ref, 'scope:team')))
    const later = expires + 3600

    // A key does not expire: the bearer can still decrypt with it.
    const opened = await openDelivery(aKey, delivery, { now: later })
    assert.equal(opened.expired, true)
    assert.deepEqual(opened.key, team)

    // The claim does: anything that would present or pass it on refuses, before a provider has to.
    await assert.rejects(
      signRequest(a, chain, { pieceCid: PIECE, expires: later + 120, now: later }),
      /The claim expired at .*: get a new grant to fetch from a gating provider/
    )
    await assert.rejects(
      delegateClaim(a, chain, { node: 'scope:team/x', parentKey: team, bearer: b.address, maxDepth: 0, now: later }),
      /get a new grant to delegate/
    )
    await assert.rejects(verifyChain(chain, { now: later }), /expired/)
    const { kk } = await keys()
    await assert.rejects(
      rootClaim(owner, { ...ref, chainId, kk, node: 'keyspace', bearer: a.address, maxDepth: 0, expires, now: later }),
      /get a new grant to issue a root/
    )
  })

  it('verifies a presentation the way a gating provider would', async () => {
    const { chain, key: team } = await root('scope:team', 1)
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'scope:team/alice',
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
    })
    const present = async (signer = b, at = now + 120) =>
      encodePresentation(two, await signRequest(signer, two, { pieceCid: PIECE, expires: at }))
    const check = (bytes: Uint8Array, piece: PieceLabels, at = now, network = chainId) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId: network, now: at })

    assert.equal((await check(await present(), labels('team/alice'))).bearer, b.address)
    assert.equal((await check(await present(), labels('team/alice/notes'))).node, 'scope:team/alice')
    await assert.rejects(check(await present(), labels('team/bob')), /does not reach this piece/)
    await assert.rejects(check(await present(), labels()), /does not reach this piece/)
    await assert.rejects(check(await present(a), labels('team/alice')), /not signed by the final bearer/)
    await assert.rejects(check(await present(b, now - 3600), labels('team/alice')), /expired/)
    await assert.rejects(check(await present(b, now + 3600), labels('team/alice')), /too long/)
    await assert.rejects(check(await present(), labels('team/alice'), now, 314n), /another network/)
    const otherPiece = PIECE.slice()
    otherPiece[otherPiece.length - 1] ^= 1
    const elsewhere = encodePresentation(two, await signRequest(b, two, { pieceCid: otherPiece, expires: now + 120 }))
    await assert.rejects(check(elsewhere, labels('team/alice')), /another piece/)
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
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'scope:x',
      parentKey: kk,
      bearer: b.address,
      maxDepth: 0,
    })
    const grant = await wrapTo(publicKeyOf(bKey), scopeKey(kk, 'x'), grantDescriptor(ref, 'scope:x'))
    assert.deepEqual(decodeDelivery(encodeDelivery(two, grant)).chain, two)
    const request = await signRequest(b, two, { pieceCid: PIECE, expires: 1 })
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

  it('accepts only the one encoding: core deterministic CBOR, known request fields, low-s v=27/28 signatures', async () => {
    const { chain, key: team } = await root('scope:team', 1)
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'scope:team/alice',
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
    })
    const bytes = encodePresentation(two, await signRequest(b, two, { pieceCid: PIECE, expires: now + 120 }))
    const check = (presentation: Uint8Array, piece = labels('team/alice')) =>
      verifyPresentation(presentation, { pieceCid: PIECE, piece, chainId, now })
    assert.ok(await check(bytes))
    const [, links, req] = decode(bytes, { useMaps: true }) as [number, Map<number, unknown>[], Map<number, unknown>]

    // A request field nobody defined.
    await assert.rejects(check(encode([1, links, new Map([...req, [3, 0]])])), /The request has an unknown field 3/)
    // Map keys out of order: decodes, but is not the deterministic encoding.
    const reversed = new Uint8Array([
      0x83, // an array of 3
      ...encode(1),
      ...encode(links),
      0xa3,
      ...encode(2),
      ...encode(req.get(2)),
      ...encode(1),
      ...encode(req.get(1)),
      ...encode(0),
      ...encode(req.get(0)),
    ])
    await assert.rejects(check(reversed), /not canonical CBOR/)
    // Ill-formed UTF-8 in a node: would decode to U+FFFD, the same text as a different encoding.
    const node = new TextEncoder().encode('scope:team/alice')
    const start = bytes.findIndex((_, i) => node.every((byte, j) => bytes[i + j] === byte))
    const at = start + node.length - 1
    const badUtf8 = bytes.slice()
    badUtf8[at] = 0xff
    await assert.rejects(check(badUtf8), /not canonical CBOR/)

    // Signatures: the same signature with a high s, or with v = 0/1, is refused.
    const signature = req.get(2) as Uint8Array
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
    const highS = hexToBytes(
      `0x${bytesToHex(signature.subarray(0, 32)).slice(2)}${(n - BigInt(bytesToHex(signature.subarray(32, 64)))).toString(16).padStart(64, '0')}${signature[64] === 27 ? '1c' : '1b'}`
    )
    await assert.rejects(check(encode([1, links, new Map([...req, [2, highS]])])), /low s and v = 27 or 28/)
    const v01 = signature.slice()
    v01[64] = (v01[64] as number) - 27
    await assert.rejects(check(encode([1, links, new Map([...req, [2, v01]])])), /low s and v = 27 or 28/)

    // A signer that returns v = 0/1 or a high s still produces the one accepted form.
    const loose = {
      signTypedData: async (args: Parameters<typeof owner.signTypedData>[0]) => {
        const sig = hexToBytes(await owner.signTypedData(args))
        const s = BigInt(bytesToHex(sig.subarray(32, 64)))
        const high = (n - s).toString(16).padStart(64, '0')
        return `${bytesToHex(sig.subarray(0, 32))}${high}${sig[64] === 27 ? '01' : '00'}` as Hex
      },
    }
    const { kk } = await keys()
    const { chain: fromLoose } = await rootClaim(loose, {
      ...ref,
      chainId,
      kk,
      node: 'keyspace',
      bearer: a.address,
      maxDepth: 0,
      expires,
    })
    assert.deepEqual(
      decodeDelivery(encodeDelivery(fromLoose, await wrapTo(publicKeyOf(aKey), kk, grantDescriptor(ref, 'keyspace'))))
        .chain,
      fromLoose
    )
    assert.ok(await verifyChain(fromLoose, { now }))
  })

  it('compares piece labels in canonical form, and names a piece by a 16-byte salt', async () => {
    const { chain, key: team } = await root('scope:team', 1)
    const { chain: cafe } = await delegateClaim(a, chain, {
      node: 'scope:team/caf\u00e9',
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
    })
    const bytes = encodePresentation(cafe, await signRequest(b, cafe, { pieceCid: PIECE, expires: now + 120 }))
    const check = (piece: PieceLabels) => verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })
    assert.ok(await check(labels('team/cafe\u0301'))) // the same scope, decomposed
    assert.ok(await check({ ...labels('team/caf\u00e9'), 'foc/ks': keyspace.toUpperCase().replace('0X', '0x') }))

    const piece = labels('team', newSalt())
    const one = await delegateClaim(a, chain, {
      node: `piece:${piece['foc/salt']}`,
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
      piece,
    })
    const upper = { ...piece, 'foc/salt': piece['foc/salt'].toUpperCase().replace('0X', '0x') }
    const request = await signRequest(b, one.chain, { pieceCid: PIECE, expires: now + 120 })
    assert.ok(
      await verifyPresentation(encodePresentation(one.chain, request), { pieceCid: PIECE, piece: upper, chainId, now })
    )
    assert.throws(() => canonicalNode('piece:0xab'), /16-byte salt/)
  })
})
