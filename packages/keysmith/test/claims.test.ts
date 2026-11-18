import assert from 'assert'
import { decode, encode } from 'cborg'
import type { Address, Hex } from 'viem'
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
  reaches,
  rootClaim,
  signRequest,
  type VerifiedClaim,
  verifyChain,
  verifyPresentation,
} from '../src/claims.ts'
import {
  commitment,
  deriveGroupKey,
  grantDescriptor,
  keyForEnvelope,
  keyForGroup,
  newSalt,
  readPieceMetadata,
} from '../src/derive.ts'
import { decodeGrant, encodeGrant, publicKeyOf, wrapTo } from '../src/wrap.ts'

const owner = privateKeyToAccount(generatePrivateKey())
const aKey = generatePrivateKey()
const bKey = generatePrivateKey()
const a = privateKeyToAccount(aKey)
const b = privateKeyToAccount(bKey)
const stranger = privateKeyToAccount(generatePrivateKey())
const keyId = '0x00112233445566778899aabbccddeeff' as Hex
const chainId = 314159n
const ref = { owner: owner.address, groupKeyId: keyId }
const now = 1_800_000_000
const expires = now + 7 * 86400

const keys = async () => deriveGroupKey(owner, ref)
const labels = (group?: string, salt: Hex = newSalt()): PieceLabels => ({
  'foc/own': owner.address.toLowerCase(),
  'foc/gkid': keyId,
  ...(group ? { 'foc/group': group } : {}),
  'foc/salt': salt,
})
const without = (o: Record<string, unknown>, key: string) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => k !== key)) as PieceLabels
const PIECE = hexToBytes('0x0155912024a8a2a4d3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3')

/** The root for `a`, signed by the owner. */
async function root(node: string, maxDepth: number) {
  const { groupKey, commitment: kc } = await keys()
  const { chain, nodeKey } = await rootClaim(owner, {
    ...ref,
    chainId,
    groupKey,
    node,
    bearer: a.address,
    maxDepth,
    expires,
  })
  return { chain, groupKey, kc, key: nodeKey }
}

describe('claims', () => {
  it('verifies a root signed by the owner until it expires, and refuses one signed by anyone else', async () => {
    const { chain, groupKey, kc, key } = await root('groupKey', 1)
    assert.deepEqual(key, groupKey)
    assert.equal(`v2.${chain.groupKeyCommitment.slice(2)}`, kc)
    const claim = await verifyChain(chain, { now })
    assert.equal(claim.bearer, a.address)
    assert.equal(claim.node, 'groupKey')
    assert.equal(claim.expires, expires)
    await assert.rejects(verifyChain(chain, { now: expires + 3600 }), /expired/)
    await assert.rejects(verifyChain({ ...chain, expires: expires + 86400 }, { now }), /not signed by the owner/)

    const input = { ...ref, chainId, groupKey, node: 'groupKey', bearer: a.address, maxDepth: 1, expires }
    await assert.rejects(rootClaim(stranger, input), /must be signed by/)
    const forged = await rootClaim(stranger, { ...input, owner: stranger.address })
    await assert.rejects(verifyChain({ ...forged.chain, owner: owner.address }, { now }), /not signed by the owner/)
    await assert.rejects(rootClaim(owner, { ...input, expires: undefined as never }), /expires must be unix seconds/)
  })

  it('derives the root key from the group key, for a group and for one piece', async () => {
    const { groupKey } = await keys()
    const base = { ...ref, chainId, groupKey, bearer: a.address, maxDepth: 0, expires }
    const grouped = await rootClaim(owner, { ...base, node: 'group:team' })
    assert.deepEqual(grouped.nodeKey, keyForGroup(groupKey, 'team'))

    const piece = labels('team', newSalt())
    const one = await rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}`, piece })
    assert.deepEqual(one.nodeKey, keyForEnvelope(groupKey, { 'foc/v': 2, ...piece }))
    await assert.rejects(rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}` }), /needs the piece's labels/)
    await assert.rejects(
      rootClaim(owner, { ...base, node: `piece:${piece['foc/salt']}`, piece: labels('team') }),
      /not for piece:/
    )
  })

  it('delegates narrower links with keys derived from the parent, and refuses wider, deeper or forged ones', async () => {
    const { chain, groupKey, key: team } = await root('group:team', 1)
    const alice = { node: 'group:team/alice', maxDepth: 0 }
    const { chain: two, nodeKey } = await delegateClaim(a, chain, { ...alice, parentKey: team, bearer: b.address })
    assert.deepEqual(nodeKey, keyForGroup(groupKey, 'team/alice'))
    const claim = await verifyChain(two, { now })
    assert.equal(claim.node, 'group:team/alice')
    assert.equal(claim.expires, expires)

    // A key that is not the parent's cannot be delegated from: the honest path cannot mint a wrong key.
    const random = crypto.getRandomValues(new Uint8Array(32))
    await assert.rejects(
      delegateClaim(a, chain, { ...alice, parentKey: random, bearer: b.address }),
      /parentKey is not the key link 0 commits to/
    )
    await assert.rejects(
      delegateClaim(a, chain, { node: 'group:other', parentKey: team, bearer: b.address, maxDepth: 0 }),
      /widens group:team to group:other/
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

    // A piece link: the key is the piece's own, derived through the parent's group.
    const piece = labels('team/notes', newSalt())
    const one = await delegateClaim(a, chain, {
      node: `piece:${piece['foc/salt']}`,
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
      piece,
    })
    assert.deepEqual(one.nodeKey, keyForEnvelope(groupKey, { 'foc/v': 2, ...piece }))
  })

  it('opens a delivery, checking bearer, node and the key against its commitment', async () => {
    const { chain, groupKey, kc, key: aliceKey } = await root('group:team/alice', 0)
    const grant = await wrapTo(publicKeyOf(aKey), aliceKey, grantDescriptor(ref, 'group:team/alice'))
    const delivery = encodeDelivery(chain, grant)
    const opened = await openDelivery(aKey, delivery, { now })
    assert.deepEqual(opened.key, aliceKey)
    assert.equal(`v2.${opened.claim.groupKeyCommitment.slice(2)}`, kc)
    assert.equal(commitment(opened.key).slice(3), opened.claim.keyCommitment.slice(2))

    await assert.rejects(openDelivery(bKey, delivery, { now }), /another bearer/)
    const swapped = await wrapTo(
      publicKeyOf(aKey),
      keyForGroup(groupKey, 'team/bob'),
      grantDescriptor(ref, 'group:team/alice')
    )
    await assert.rejects(openDelivery(aKey, encodeDelivery(chain, swapped), { now }), /does not match the commitment/)
    const otherNode = await wrapTo(publicKeyOf(aKey), aliceKey, grantDescriptor(ref, 'group:team'))
    assert.throws(() => encodeDelivery(chain, otherNode), /another node/)
    // Built elsewhere, without encodeDelivery's check: the bearer still refuses it.
    const [, links] = decode(delivery, { useMaps: true }) as [number, unknown]
    await assert.rejects(openDelivery(aKey, encode([2, links, encodeGrant(otherNode)]), { now }), /another node/)
    assert.equal(opened.expired, false)
  })

  it('refuses a delivery whose inner grant is not canonical CBOR', async () => {
    const { chain, key } = await root('group:team', 0)
    const grant = encodeGrant(await wrapTo(publicKeyOf(aKey), key, grantDescriptor(ref, 'group:team')))
    const [, links] = decode(encodeDelivery(chain, decodeGrant(grant)), { useMaps: true }) as [number, unknown]
    const wrap = (inner: Uint8Array) => encode([2, links, inner])
    // `v` 2 as a double: the outer delivery is canonical, only the grant inside is not
    const double = new Uint8Array([0xa7, 0x00, 0xfb, 0x40, 0, 0, 0, 0, 0, 0, 0, ...grant.subarray(3)])
    assert.deepStrictEqual([...grant.subarray(0, 3)], [0xa7, 0x00, 0x02])
    assert.throws(() => decodeDelivery(wrap(double)), /Not a grant: the bytes are not canonical CBOR/)
    await assert.rejects(openDelivery(aKey, wrap(double), { now }), /Not a grant: the bytes are not canonical CBOR/)
    const fields = [...(decode(grant, { useMaps: true }) as Map<number, unknown>)].reverse()
    const reordered = new Uint8Array([0xa7, ...fields.flatMap(([k, v]) => [...encode(k), ...encode(v)])])
    assert.throws(() => decodeDelivery(wrap(reordered)), /Not a grant: the bytes are not canonical CBOR/)
    assert.equal((await openDelivery(aKey, wrap(grant), { now })).claim.node, 'group:team')
  })

  it('opens an expired delivery for its key, but refuses to use its claim', async () => {
    const { chain, key: team } = await root('group:team', 1)
    const delivery = encodeDelivery(chain, await wrapTo(publicKeyOf(aKey), team, grantDescriptor(ref, 'group:team')))
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
      delegateClaim(a, chain, { node: 'group:team/x', parentKey: team, bearer: b.address, maxDepth: 0, now: later }),
      /get a new grant to delegate/
    )
    await assert.rejects(verifyChain(chain, { now: later }), /expired/)
    const { groupKey } = await keys()
    await assert.rejects(
      rootClaim(owner, {
        ...ref,
        chainId,
        groupKey,
        node: 'groupKey',
        bearer: a.address,
        maxDepth: 0,
        expires,
        now: later,
      }),
      /get a new grant to issue a root/
    )
  })

  it('verifies a presentation the way a gating provider would', async () => {
    const { chain, key: team } = await root('group:team', 1)
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'group:team/alice',
      parentKey: team,
      bearer: b.address,
      maxDepth: 0,
    })
    const present = async (signer = b, at = now + 120, signedAt = now) =>
      encodePresentation(two, await signRequest(signer, two, { pieceCid: PIECE, expires: at, now: signedAt }))
    const check = (bytes: Uint8Array, piece: PieceLabels, at = now, network = chainId) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId: network, now: at })

    assert.equal((await check(await present(), labels('team/alice'))).bearer, b.address)
    assert.equal((await check(await present(), labels('team/alice/notes'))).node, 'group:team/alice')
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
    const ungated: PieceLabels = { 'foc/gkid': keyId, 'foc/salt': newSalt() }
    assert.ok(await check(await present(), ungated))
  })

  it('signs only a request expiry the gate accepts', async () => {
    const { chain } = await root('groupKey', 0)
    const sign = (at: number) => signRequest(a, chain, { pieceCid: PIECE, expires: at, now })
    const longest = now + MAX_REQUEST_LIFETIME + 60
    assert.ok(await sign(longest))
    await assert.rejects(sign(longest + 1), /must expire within 300 seconds/)
    assert.ok(await sign(now - 60))
    await assert.rejects(sign(now - 61), /not in the past/)
  })

  it('round-trips CBOR, and refuses links that repeat root fields, carry unknown ones or lack a signature', async () => {
    const { chain, groupKey } = await root('groupKey', 1)
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'group:x',
      parentKey: groupKey,
      bearer: b.address,
      maxDepth: 0,
    })
    const grant = await wrapTo(publicKeyOf(bKey), keyForGroup(groupKey, 'x'), grantDescriptor(ref, 'group:x'))
    assert.deepEqual(decodeDelivery(encodeDelivery(two, grant)).chain, two)
    const request = await signRequest(b, two, { pieceCid: PIECE, expires: now + 120, now })
    assert.deepEqual(decodePresentation(encodePresentation(two, request)), { chain: two, request })

    const [, links, grantBytes] = decode(encodeDelivery(two, grant), { useMaps: true }) as [
      number,
      Map<number, unknown>[],
      Uint8Array,
    ]
    const [l0, l1] = links as [Map<number, unknown>, Map<number, unknown>]
    const redo = (r: Map<number, unknown>, l: Map<number, unknown>) => encode([2, [r, l], grantBytes])
    const without = (m: Map<number, unknown>, k: number) => new Map([...m].filter(([key]) => key !== k))
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(2, hexToBytes(owner.address)))), /root-only field/)
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(11, expires))), /root-only field/)
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(12, 1))), /unknown field/)
    assert.throws(() => decodeDelivery(redo(without(l0, 8), l1)), /signature must be 65 bytes/)
    assert.throws(() => decodeDelivery(redo(without(l0, 11), l1)), /root expiry/)
    assert.throws(() => decodeDelivery(encode([3, links, grantBytes])), /Unsupported delivery version: 3/)
    const old = /keysmith 0\.1\.0 \(format 1\) data is not supported/
    assert.throws(() => decodeDelivery(encode([1, links, grantBytes])), old, 'a version 1 delivery')
    assert.throws(() => decodeDelivery(redo(new Map(l0).set(0, 1), l1)), old, 'a version 1 link')
    assert.throws(() => decodeDelivery(redo(l0, new Map(l1).set(0, 3))), /Unsupported claim link 1 version: 3/)
    assert.throws(
      () => decodePresentation(encode([1, [l0, l1], new Map([[0, PIECE]])])),
      old,
      'a version 1 presentation'
    )
    assert.throws(
      () => decodePresentation(encode([3, [l0, l1], new Map([[0, PIECE]])])),
      /Unsupported presentation version: 3/
    )
  })

  it('builds the Authorization header a gating provider verifies', async () => {
    const { chain } = await root('groupKey', 0)
    const header = await authorizationHeader(a, chain, { pieceCid: PIECE, now })
    const [scheme, token = ''] = header.split(' ')
    assert.equal(scheme, 'FOC-Grant')
    assert.match(token, /^[A-Za-z0-9_-]+$/) // base64url, unpadded
    // Pieces of other lengths give payloads that base64 would pad
    for (const cut of [1, 2]) {
      const other = await authorizationHeader(a, chain, { pieceCid: PIECE.subarray(cut), now })
      assert.match(other, /^FOC-Grant [A-Za-z0-9_-]+$/)
    }
    const bytes = Uint8Array.from(atob(token.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
    assert.equal(decodePresentation(bytes).request.expires, now + MAX_REQUEST_LIFETIME - 60)
    const claim = await verifyPresentation(bytes, { pieceCid: PIECE, piece: labels(), chainId, now })
    assert.equal(claim.bearer, a.address)

    // Refused before signing, as signRequest refuses: too long, or an expired chain
    await assert.rejects(authorizationHeader(a, chain, { pieceCid: PIECE, now, expiresIn: 3600 }), /must expire within/)
    assert.ok(await authorizationHeader(a, chain, { pieceCid: PIECE, now, expiresIn: MAX_REQUEST_LIFETIME + 60 }))
    await assert.rejects(
      authorizationHeader(a, chain, { pieceCid: PIECE, now, expiresIn: MAX_REQUEST_LIFETIME + 61 }),
      /must expire within/
    )
    await assert.rejects(authorizationHeader(a, chain, { pieceCid: PIECE, now, expiresIn: 1.5 }), /whole Unix seconds/)
    await assert.rejects(authorizationHeader(a, chain, { pieceCid: PIECE, now: now + 0.5 }), /whole Unix seconds/)
    await assert.rejects(
      authorizationHeader(a, chain, { pieceCid: PIECE, now: expires + 1 }),
      /get a new grant to fetch from a gating provider/
    )
  })

  it('picks the narrowest live grant that reaches a piece or group', () => {
    const held = (node: string, more: Partial<VerifiedClaim> = {}) => ({
      claim: {
        owner: owner.address,
        groupKeyId: keyId,
        chainId,
        expires,
        node,
        bearer: a.address,
        ...more,
      } as VerifiedClaim,
    })
    const salt = newSalt()
    const whole = held('groupKey')
    const team = held('group:team')
    const alice = held('group:team/alice')
    const alice2 = held('group:team/alice', { expires: expires + 1 })
    const piece = held(`piece:${salt}`)
    const grants = [whole, team, alice, piece, alice2]
    const pick = (target: Parameters<typeof pickGrant>[1], from = grants, at = now) =>
      pickGrant(from, target, { chainId, now: at })

    assert.equal(pick({ piece: labels('team/alice/notes', salt) }), piece)
    assert.equal(pick({ piece: labels('team/alice/notes') }), alice2) // deepest group; on a tie, the later expiry
    assert.equal(pick({ piece: labels('team/bob') }), team)
    assert.equal(pick({ piece: labels() }), whole) // no foc/group: only the group key reaches it
    assert.equal(pick({ ...ref, group: 'team/alice/notes' }), alice2)
    const cafe = held('group:team/caf\u00e9')
    assert.equal(pick({ ...ref, group: 'team/cafe\u0301' }, [team, cafe]), cafe) // compared in canonical (NFC) form
    assert.equal(pick({ ...ref, group: 'team' }, [alice, piece]), undefined) // nothing wide enough: ask for one
    // Depth wins over expiry: a deeper grant expiring sooner still beats a shallower one
    const soon = held('group:team/alice', { expires: expires - 100 })
    assert.equal(pick({ piece: labels('team/alice/notes') }, [team, soon]), soon)
    assert.equal(pick({ ...ref, group: 'team/alice' }, [whole, team, soon]), soon)

    // Skipped: expired, another network, another group key, another owner
    assert.equal(pick({ piece: labels('team/x') }, [team], expires), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('group:team', { chainId: 314n })]), undefined)
    const elsewhere = held('group:team', { groupKeyId: '0xffeeddccbbaa99887766554433221100' })
    assert.equal(pick({ piece: labels('team/x') }, [elsewhere]), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('group:team', { owner: stranger.address })]), undefined)
    assert.equal(pick({ ...ref, group: 'team/x' }, [held('group:team', { owner: stranger.address })]), undefined)

    // A bad target fails the same way whatever is held
    for (const from of [[whole], [whole, team], []]) {
      assert.throws(() => pick({ ...ref, group: '' }, from))
      assert.throws(() => pick({ ...ref, group: 'team/' }, from))
      assert.throws(() => pick({ ...ref, owner: '0xnope' as Address, group: 'team' }, from))
    }

    // A stale `scope` would read as "no group" and could pick a grant that is too broad
    for (const from of [[whole], []]) {
      assert.throws(() => pick({ ...ref, scope: 'team' } as never, from), /takes `group`, not `scope`/)
    }
  })

  it('skips a held grant whose node does not parse, rather than throwing', () => {
    const held = (node: string) => ({
      claim: { owner: owner.address, groupKeyId: keyId, chainId, expires, node, bearer: a.address } as VerifiedClaim,
    })
    const team = held('group:team')
    for (const bad of ['keyspace', 'scope:team', 'piece:0xab', '']) {
      const stale = held(bad)
      for (const target of [{ piece: labels('team/x') }, { ...ref, group: 'team/x' }]) {
        assert.equal(pickGrant([stale, team], target, { chainId, now }), team, `${bad} before`)
        assert.equal(pickGrant([team, stale], target, { chainId, now }), team, `${bad} after`)
        assert.equal(pickGrant([stale], target, { chainId, now }), undefined, `${bad} alone`)
      }
    }
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
    const { groupKey } = await keys()
    const { chain: fromLoose } = await rootClaim(loose, {
      ...ref,
      chainId,
      groupKey,
      node: 'groupKey',
      bearer: a.address,
      maxDepth: 0,
      expires,
    })
    assert.deepEqual(
      decodeDelivery(
        encodeDelivery(fromLoose, await wrapTo(publicKeyOf(aKey), groupKey, grantDescriptor(ref, 'groupKey')))
      ).chain,
      fromLoose
    )
    assert.ok(await verifyChain(fromLoose, { now }))
  })

  it("carries a piece root's locator, unsigned, through a delivery", async () => {
    const { groupKey } = await keys()
    const piece = labels('team', newSalt())
    const node = `piece:${piece['foc/salt']}` as const
    const { chain, nodeKey } = await rootClaim(owner, {
      ...ref,
      chainId,
      groupKey,
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

  it('writes a caller-supplied node in canonical form', async () => {
    const team = await root('group:team/cafe\u0301', 1)
    assert.equal((await verifyChain(team.chain, { now })).node, 'group:team/caf\u00e9')
    assert.deepEqual(team.key, keyForGroup(team.groupKey, 'team/caf\u00e9'))
    assert.equal((await root('groupKey', 0)).chain.links[0]?.node, 'groupKey')
    await assert.rejects(root('keyspace', 0), /Unrecognised grant node/)
  })

  it('decides what a node reaches from the group label', () => {
    const piece = labels('team/alice')
    for (const node of ['groupKey', 'group:team', 'group:team/alice']) assert.ok(reaches(node, piece), node)
    assert.ok(!reaches('group:team/bob', piece))
    assert.ok(!reaches('group:team/bob', labels()))
    assert.ok(reaches(`piece:${piece['foc/salt']}`, piece))
  })

  it('verifies a presentation, saying which group the piece is in when it is refused', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const check = (piece: PieceLabels) => verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })
    assert.equal((await check(labels('team/x'))).node, 'group:team')
    await assert.rejects(check(labels('other')), /group:team does not reach this piece \(group other\)/)
    await assert.rejects(check(labels()), /group:team does not reach this piece \(group \(none\)\)/)
  })

  it('accepts foc/v absent, 2 or "2", and refuses 0.1.0 labels and any other foc/v', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const check = (piece: unknown) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece: piece as PieceLabels, chainId, now })
    // A provider may pass it as a string (from Go or JSON), or not at all
    for (const v of ['2', 2, undefined]) {
      assert.equal((await check({ ...labels('team/x'), 'foc/v': v })).node, 'group:team', `foc/v ${v}`)
    }
    for (const v of [3, '3', 0, 'x', null, 2.5]) {
      const bad = { ...labels('team/x'), 'foc/v': v }
      const unsupported = new RegExp(`Unsupported piece label version: ${JSON.stringify(v)}`)
      await assert.rejects(check(bad), unsupported)
    }
    const old = /keysmith 0\.1\.0 \(format 1\) data is not supported/
    const held = [
      { claim: { node: 'group:team', owner: owner.address, groupKeyId: keyId, chainId, expires, bearer: a.address } },
    ] as { claim: VerifiedClaim }[]
    const format1 = (v?: 1 | '1') => {
      const { 'foc/gkid': id, 'foc/group': group, ...rest } = labels('team/x')
      return { ...rest, 'foc/ks': id, 'foc/scope': group, ...(v === undefined ? {} : { 'foc/v': v }) }
    }
    for (const piece of [format1(1), format1('1'), format1(), { ...labels('team/x'), 'foc/v': 1 }]) {
      await assert.rejects(check(piece), old)
      assert.throws(() => pickGrant(held, { piece: piece as PieceLabels }, { chainId, now }), old)
    }
  })

  it('claim-side labels accept foc/v absent or "2" where the envelope side is strict, on purpose: providers may parse labels from Go/JSON', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    for (const v of [undefined, '2']) {
      const piece = { ...labels('team/x'), 'foc/v': v } as PieceLabels
      assert.equal((await verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })).node, 'group:team')
      assert.throws(() => readPieceMetadata(piece as never), /Unsupported piece label version/, `envelope foc/v ${v}`)
    }
  })

  it('names keysmith 0.1.0 for foc/ks labels without foc/v or foc/gkid, on both sides', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const old = /keysmith 0\.1\.0 \(format 1\) data is not supported: a piece with foc\/ks labels/
    const ks = { 'foc/own': owner.address.toLowerCase(), 'foc/ks': keyId, 'foc/salt': newSalt() } // gated, or the labels are not read
    assert.throws(() => readPieceMetadata(ks), old)
    assert.throws(() => keyForEnvelope(new Uint8Array(32), ks), old)
    await assert.rejects(verifyPresentation(bytes, { pieceCid: PIECE, piece: ks as never, chainId, now }), old)
  })

  it('reads the group key id from foc/gkid', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const other = '0xffeeddccbbaa99887766554433221100' as Hex
    const piece = labels('team/x')
    assert.equal((await verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })).node, 'group:team')
    const wrong = { ...piece, 'foc/gkid': other }
    await assert.rejects(
      verifyPresentation(bytes, { pieceCid: PIECE, piece: wrong, chainId, now }),
      /belongs to another owner or group key/
    )
  })

  it('refuses a present foc/own that is not an address, and treats a falsy one as not gated', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const piece = labels('secret')
    const held = [
      {
        claim: {
          node: 'group:team',
          owner: owner.address,
          groupKeyId: keyId,
          chainId,
          expires,
          bearer: a.address,
        } as VerifiedClaim,
      },
    ]
    for (const bad of [1, true, ['x'], {}, 'nope']) {
      const bent = { ...piece, 'foc/own': bad } as never
      await assert.rejects(
        verifyPresentation(bytes, { pieceCid: PIECE, piece: bent, chainId, now }),
        /foc\/own must be an address/
      )
      assert.throws(() => pickGrant(held, { piece: bent }, { chainId, now }), /foc\/own must be an address/)
      assert.throws(() => readPieceMetadata({ ...piece, 'foc/v': 2, 'foc/own': bad }), /foc\/own must be an address/)
    }
    for (const falsy of [undefined, null, '']) {
      const ungated = { ...piece, 'foc/own': falsy } as never
      assert.equal(
        (await verifyPresentation(bytes, { pieceCid: PIECE, piece: ungated, chainId, now })).node,
        'group:team'
      )
      assert.equal(readPieceMetadata({ ...piece, 'foc/v': 2, 'foc/own': falsy }).owner, undefined)
    }
    assert.equal(
      (await verifyPresentation(bytes, { pieceCid: PIECE, piece: {} as never, chainId, now })).node,
      'group:team'
    )
    const rest = { 'foc/gkid': keyId, 'foc/salt': 'x' } as never
    assert.equal((await verifyPresentation(bytes, { pieceCid: PIECE, piece: rest, chainId, now })).node, 'group:team')
  })

  it('reads only the label a decision needs, so a bad label throws only where it is used', async () => {
    const { chain: whole } = await root('groupKey', 0)
    const { chain: team } = await root('group:team', 0)
    const present = async (chain: typeof whole) =>
      encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const [wholeBytes, teamBytes] = [await present(whole), await present(team)]
    const grant = (node: string) => [
      {
        claim: { owner: owner.address, groupKeyId: keyId, chainId, expires, node, bearer: a.address } as VerifiedClaim,
      },
    ]
    const salt = newSalt()
    const base = {
      'foc/own': owner.address.toLowerCase(),
      'foc/gkid': keyId,
      'foc/group': 'team/alice',
      'foc/salt': salt,
    }
    const outcome = async (f: () => unknown) => {
      try {
        return String(await f())
      } catch {
        return 'throw'
      }
    }
    // [labels, reaches: group key, group, piece; presented to a group key root, a group root; picked for: group, piece]
    const T = 'throw'
    const rows: [string, Record<string, unknown>, string[]][] = [
      ['good', {}, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['no foc/gkid', { 'foc/gkid': undefined }, ['true', 'true', 'true', T, T, T, T]],
      ['bad foc/gkid', { 'foc/gkid': '0xzz' }, ['true', 'true', 'true', T, T, T, T]],
      ['bad salt', { 'foc/salt': 'zz' }, ['true', 'true', T, T, T, T, T]],
      ['no salt', { 'foc/salt': undefined }, ['true', 'true', T, T, T, T, T]],
      ['bad group', { 'foc/group': ' x' }, ['true', T, 'true', 'served', T, T, T]],
      ['group not a string', { 'foc/group': 1 }, ['true', T, 'true', 'served', T, T, T]],
      ['no owner', { 'foc/own': undefined }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['empty owner', { 'foc/own': '' }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['null owner', { 'foc/own': null }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['owner not an address', { 'foc/own': 'nope' }, ['true', 'true', 'true', T, T, T, T]],
      ['owner a number', { 'foc/own': 1 }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v 1', { 'foc/v': 1 }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v 1 as a string', { 'foc/v': '1' }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v absent', { 'foc/v': undefined }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['foc/v 2', { 'foc/v': 2 }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['foc/v 2 as a string', { 'foc/v': '2' }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['foc/v 3', { 'foc/v': 3 }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v 3 as a string', { 'foc/v': '3' }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v null', { 'foc/v': null }, ['true', 'true', 'true', T, T, T, T]],
    ]
    for (const [name, change, want] of rows) {
      const piece = { ...base, ...change } as PieceLabels
      const present1 = (bytes: Uint8Array) => async () =>
        (await verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })) && 'served'
      const pick = (node: string) => async () =>
        pickGrant(grant(node), { piece }, { chainId, now, owner: owner.address }) ? 'found' : 'undefined'
      const got = [
        await outcome(() => reaches('groupKey', piece)),
        await outcome(() => reaches('group:team', piece)),
        await outcome(() => reaches(`piece:${salt}`, piece)),
        await outcome(present1(wholeBytes)),
        await outcome(present1(teamBytes)),
        await outcome(pick('group:team')),
        await outcome(pick(`piece:${salt}`)),
      ]
      assert.deepStrictEqual(got, want, name)
    }
  })

  it('refuses malformed group labels', () => {
    const base = { 'foc/v': 2, 'foc/own': owner.address, 'foc/gkid': keyId, 'foc/salt': newSalt() }
    assert.throws(() => readPieceMetadata({ ...base, 'foc/group': ' x' }), /A group name/)
    assert.throws(() => readPieceMetadata({ ...base, 'foc/group': 1 }), /A group path must be a string/)
  })

  it('picks only the expected owner: a grant rooted by another wallet under the same group key id is never picked', () => {
    const salt = newSalt()
    const held = (node: string, who: Address) => ({
      claim: { owner: who, groupKeyId: keyId, chainId, expires, node, bearer: a.address } as VerifiedClaim,
    })
    const mine = held('group:team', owner.address)
    // The attacker's grant is public-id compatible and narrower, so it wins unless the owner is pinned
    const theirs = held(`piece:${salt}`, stranger.address)
    const pick = (target: Parameters<typeof pickGrant>[1], options: { owner?: Address } = {}) =>
      pickGrant([theirs, mine], target, { chainId, now, ...options })
    const ungated = { ...labels('team', salt), 'foc/own': '' }

    assert.equal(pick({ piece: ungated }, { owner: owner.address }), mine)
    assert.equal(pick({ piece: ungated }, { owner: owner.address.toLowerCase() as Address }), mine)
    assert.equal(pick({ piece: ungated }, { owner: stranger.address }), theirs, 'the caller decides who it trusts')
    assert.throws(() => pick({ piece: ungated }), /needs the expected owner for a piece without foc\/own/)
    assert.throws(() => pick({ piece: without(ungated, 'foc/own') }), /needs the expected owner/)
    assert.throws(() => pick({ piece: ungated }, { owner: '' as Address }), /options\.owner must be an address/)
    assert.throws(() => pick({ piece: ungated }, { owner: '0xnope' as Address }), /options\.owner must be an address/)

    // A gated piece names its owner, so no option is needed, and a contradicting one is refused
    assert.equal(pick({ piece: labels('team', salt) }), mine)
    assert.equal(pick({ piece: labels('team', salt) }, { owner: owner.address }), mine)
    assert.throws(() => pick({ piece: labels('team', salt) }, { owner: stranger.address }), /does not match the owner/)

    // A group target must name a real owner: '' or nothing would match any owner's grants
    for (const bad of ['', undefined, null, '0xnope']) {
      assert.throws(() => pick({ ...ref, owner: bad as never, group: 'team' }), /pickGrant needs the group key owner/)
    }
    assert.equal(pick({ ...ref, group: 'team' }), mine)
    assert.throws(() => pick({ ...ref, group: 'team' }, { owner: stranger.address }), /does not match the owner/)
  })

  it('reads a piece salt as exactly 16 bytes of hex, wherever claims read one', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const good = labels('team/x')
    const check = (piece: unknown) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece: piece as PieceLabels, chainId, now })
    assert.equal((await check(good)).node, 'group:team')
    for (const salt of ['0xab', `0x${'ab'.repeat(17)}`, 5, undefined]) {
      const piece = { ...good, 'foc/salt': salt } as PieceLabels
      await assert.rejects(check(piece), /piece salt/, `verifyPresentation ${salt}`)
      assert.throws(() => reaches(`piece:${newSalt()}`, piece), /piece salt/, `reaches ${salt}`)
      assert.throws(() => pickGrant([], { piece }, { chainId, now }), /piece salt/, `pickGrant ${salt}`)
      const { groupKey } = await keys()
      await assert.rejects(
        rootClaim(owner, {
          ...ref,
          chainId,
          groupKey,
          node: `piece:${newSalt()}`,
          bearer: a.address,
          maxDepth: 0,
          expires,
          piece,
        }),
        /piece salt/,
        `rootClaim ${salt}`
      )
    }
    // An ungated piece is not checked: nothing is gated, so nothing is read
    assert.equal((await check({ ...good, 'foc/own': '', 'foc/salt': '0xab' })).node, 'group:team')
  })

  it('reads labels as own properties only: an inherited label is not a label', async () => {
    const { chain } = await root('group:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const check = (piece: unknown) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece: piece as PieceLabels, chainId, now })
    const noGroup = labels()
    const inheriting = (inherited: Record<string, unknown>, own: Record<string, unknown>) =>
      Object.assign(Object.create(inherited), own) as PieceLabels

    // An inherited group is ignored: the piece has no group, so a group grant does not reach it
    const viaProto = inheriting({ 'foc/group': 'team/x' }, noGroup)
    assert.equal(reaches('group:team', viaProto), false)
    await assert.rejects(check(viaProto), /does not reach this piece \(group \(none\)\)/)
    // An inherited foc/gkid is no foc/gkid: refused
    const { 'foc/gkid': _gkid, ...rest } = labels('team/x')
    await assert.rejects(check(inheriting({ 'foc/gkid': keyId }, rest)), /group key id/)
    // An inherited foc/own does not gate, or ungate
    assert.equal(
      (await check(inheriting({ 'foc/own': stranger.address }, without(noGroup, 'foc/own')))).node,
      'group:team'
    )

    // The same through a polluted Object.prototype, cleaned up even if an assertion fails
    const polluted = Object.prototype as Record<string, unknown>
    try {
      polluted['foc/group'] = 'team/x'
      polluted['foc/own'] = stranger.address
      assert.equal(reaches('group:team', noGroup), false)
      await assert.rejects(check(noGroup), /does not reach this piece \(group \(none\)\)/)
      assert.equal((await check({ ...without(noGroup, 'foc/own') })).node, 'group:team')
    } finally {
      delete polluted['foc/group']
      delete polluted['foc/own']
    }

    // A null-prototype object, as FEE returns, still works
    const bare = Object.assign(Object.create(null), labels('team/x')) as PieceLabels
    assert.equal(reaches('group:team', bare), true)
    assert.equal((await check(bare)).node, 'group:team')
  })
})
