import assert from 'assert'
import { decode, encode } from 'cborg'
import type { Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  authorizationHeader,
  decodeDelivery,
  decodePresentation,
  delegateClaim,
  encodeDelivery,
  encodePresentation,
  MAX_REQUEST_LIFETIME,
  openDelivery,
  type PieceLabels,
  pickGrant,
  rootClaim,
  signRequest,
  type VerifiedClaim,
  verifyChain,
  verifyPresentation,
} from '../src/claims.ts'
import { commitment, grantDescriptor, keyForEnvelope, keyspaceKeys, newSalt, scopeKey } from '../src/derive.ts'
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
    const present = async (signer = b, at = now + 120, signedAt = now) =>
      encodePresentation(two, await signRequest(signer, two, { pieceCid: PIECE, expires: at, now: signedAt }))
    const check = (bytes: Uint8Array, piece: PieceLabels, at = now, network = chainId) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId: network, now: at })

    assert.equal((await check(await present(), labels('team/alice'))).bearer, b.address)
    assert.equal((await check(await present(), labels('team/alice/notes'))).node, 'scope:team/alice')
    await assert.rejects(check(await present(), labels('team/bob')), /does not reach this piece/)
    await assert.rejects(check(await present(), labels()), /does not reach this piece/)
    await assert.rejects(check(await present(a), labels('team/alice')), /not signed by the final bearer/)
    await assert.rejects(check(await present(b, now - 3600, now - 3700), labels('team/alice')), /expired/)
    await assert.rejects(check(await present(b, now + 3600, now + 3500), labels('team/alice')), /too long/)
    await assert.rejects(check(await present(), labels('team/alice'), now, 314n), /another network/)
    const otherPiece = PIECE.slice()
    otherPiece[otherPiece.length - 1] ^= 1
    const elsewhere = encodePresentation(
      two,
      await signRequest(b, two, { pieceCid: otherPiece, expires: now + 120, now })
    )
    await assert.rejects(check(elsewhere, labels('team/alice')), /another piece/)
    await assert.rejects(
      check(await present(), { ...labels('team/alice'), 'foc/own': stranger.address }),
      /another owner/
    )
    const ungated: PieceLabels = { 'foc/ks': keyspace, 'foc/salt': newSalt() }
    assert.ok(await check(await present(), ungated))
  })

  it('signs only a request expiry the gate accepts', async () => {
    const { chain } = await root('keyspace', 0)
    const sign = (at: number) => signRequest(a, chain, { pieceCid: PIECE, expires: at, now })
    const longest = now + MAX_REQUEST_LIFETIME + 60
    assert.ok(await sign(longest))
    await assert.rejects(sign(longest + 1), /must expire within 300 seconds/)
    assert.ok(await sign(now - 60))
    await assert.rejects(sign(now - 61), /not in the past/)
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
    const request = await signRequest(b, two, { pieceCid: PIECE, expires: now + 120, now })
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

  it('builds the Authorization header a gating provider verifies', async () => {
    const { chain } = await root('keyspace', 0)
    const header = await authorizationHeader(a, chain, { pieceCid: PIECE, now })
    const [scheme, token = ''] = header.split(' ')
    assert.equal(scheme, 'FOC-Grant')
    assert.match(token, /^[A-Za-z0-9_-]+$/) // base64url, unpadded
    const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    assert.equal(decodePresentation(bytes).request.expires, now + MAX_REQUEST_LIFETIME - 60)
    const claim = await verifyPresentation(bytes, { pieceCid: PIECE, piece: labels(), chainId, now })
    assert.equal(claim.bearer, a.address)

    // Refused before signing, as signRequest refuses: too long, or an expired chain
    await assert.rejects(authorizationHeader(a, chain, { pieceCid: PIECE, now, expiresIn: 3600 }), /must expire within/)
    await assert.rejects(
      authorizationHeader(a, chain, { pieceCid: PIECE, now: expires + 1 }),
      /get a new grant to fetch from a gating provider/
    )
  })

  it('picks the narrowest live grant that reaches a piece or scope', () => {
    const held = (node: string, more: Partial<VerifiedClaim> = {}) => ({
      claim: { owner: owner.address, keyspace, chainId, expires, node, bearer: a.address, ...more } as VerifiedClaim,
    })
    const salt = newSalt()
    const whole = held('keyspace')
    const team = held('scope:team')
    const alice = held('scope:team/alice')
    const alice2 = held('scope:team/alice', { expires: expires + 1 })
    const piece = held(`piece:${salt}`)
    const grants = [whole, team, alice, piece, alice2]
    const pick = (target: Parameters<typeof pickGrant>[1], from = grants, at = now) =>
      pickGrant(from, target, { chainId, now: at })

    assert.equal(pick({ piece: labels('team/alice/notes', salt) }), piece)
    assert.equal(pick({ piece: labels('team/alice/notes') }), alice2) // deepest scope; on a tie, the later expiry
    assert.equal(pick({ piece: labels('team/bob') }), team)
    assert.equal(pick({ piece: labels() }), whole) // no foc/scope: only the keyspace reaches it
    assert.equal(pick({ ...ref, scope: 'team/alice/notes' }), alice2)
    const cafe = held('scope:team/caf\u00e9')
    assert.equal(pick({ ...ref, scope: 'team/cafe\u0301' }, [team, cafe]), cafe) // compared in canonical (NFC) form
    assert.equal(pick({ ...ref, scope: 'team' }, [alice, piece]), undefined) // nothing wide enough: ask for one

    // Skipped: expired, another network, another keyspace, another owner
    assert.equal(pick({ piece: labels('team/x') }, [team], expires), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('scope:team', { chainId: 314n })]), undefined)
    const elsewhere = held('scope:team', { keyspace: '0xffeeddccbbaa99887766554433221100' })
    assert.equal(pick({ piece: labels('team/x') }, [elsewhere]), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('scope:team', { owner: stranger.address })]), undefined)
  })

  it('normalizes a signer that returns v = 0/1 or a high s to the one accepted form', async () => {
    const n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
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

  it("carries a piece root's locator, unsigned, through a delivery", async () => {
    const { kk } = await keys()
    const piece = labels('team', newSalt())
    const node = `piece:${piece['foc/salt']}` as const
    const { chain, nodeKey } = await rootClaim(owner, {
      ...ref,
      chainId,
      kk,
      node,
      bearer: a.address,
      maxDepth: 0,
      expires,
      piece,
      pieceCid: PIECE,
    })
    assert.deepEqual(chain.links[0]?.pieceCid, PIECE)
    const delivery = encodeDelivery(chain, await wrapTo(publicKeyOf(aKey), nodeKey, grantDescriptor(ref, node)))
    assert.deepEqual(decodeDelivery(delivery).chain, chain)
    assert.deepEqual((await openDelivery(aKey, delivery, { now })).key, nodeKey)
  })
})
