import assert from 'assert'
import { decode, encode } from 'cborg'
import type { Address, Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import {
  authorizationHeader,
  type Claim,
  type ClaimChain,
  decodeDelivery,
  decodePresentation,
  delegateClaim,
  encodeDelivery,
  encodePresentation,
  keyCommitmentOf,
  MAX_REQUEST_LIFETIME,
  openDelivery,
  type PieceLabels,
  pickGrant,
  READ_GRANT_TYPES,
  reaches,
  rootClaim,
  signRequest,
  type VerifiedClaim,
  verifyChain,
  verifyPresentation,
} from '../src/claims.ts'
import {
  commitment,
  DOMAIN,
  deriveGroupKey,
  grantDescriptor,
  keyForEnvelope,
  keyForGroup,
  newSalt,
  nodeKind,
  readPieceMetadata,
} from '../src/derive.ts'
import { encodeGrant, publicKeyOf, wrapTo } from '../src/wrap.ts'

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
  'foc/ks': keyId,
  ...(group ? { 'foc/scope': group } : {}),
  'foc/salt': salt,
})
const labels2 = (group?: string, salt: Hex = newSalt()): PieceLabels => ({
  'foc/own': owner.address.toLowerCase(),
  'foc/ks': keyId,
  ...(group ? { 'foc/group': group } : {}),
  'foc/salt': salt,
})
const PIECE = hexToBytes('0x0155912024a8a2a4d3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3a4a3')

/** The root for `a`, signed by the owner. */
async function root(node: string, maxDepth: number) {
  const { kk, commitment: kc } = await keys()
  const { chain, nodeKey } = await rootClaim(owner, { ...ref, chainId, kk, node, bearer: a.address, maxDepth, expires })
  return { chain, kk, kc, key: nodeKey }
}

/**
 * A chain with exactly these node spellings (a group key, then groups), signed by hand: the writers
 * only write format 1, so this is how a chain written in format 2 is built.
 */
async function handChain(nodes: string[], spareDepth = 0) {
  const { kk } = await keys()
  const signers = [owner, a, b]
  const bearers = [a, b, stranger]
  const groupKeyCommitment = keyCommitmentOf(kk)
  const links: Claim[] = []
  for (const [i, node] of nodes.entries()) {
    const k = nodeKind(node)
    const key = k.kind === 'group' ? keyForGroup(kk, k.path) : kk
    const link = {
      node,
      bearer: (bearers[i] as typeof a).address,
      maxDepth: nodes.length - 1 - i + spareDepth,
      keyCommitment: keyCommitmentOf(key),
    }
    const signature = await (signers[i] as typeof a).signTypedData({
      domain: DOMAIN,
      types: READ_GRANT_TYPES,
      primaryType: 'ReadGrant',
      message: {
        v: 1,
        ...link,
        owner: owner.address,
        keyspace: keyId,
        chainId,
        keyspaceCommitment: groupKeyCommitment,
        expires: BigInt(expires),
      },
    })
    links.push({ ...link, signature })
  }
  const chain: ClaimChain = { owner: owner.address, groupKeyId: keyId, chainId, groupKeyCommitment, expires, links }
  return { chain, kk }
}

describe('claims', () => {
  it('verifies a root signed by the owner until it expires, and refuses one signed by anyone else', async () => {
    const { chain, kk, kc, key } = await root('keyspace', 1)
    assert.deepEqual(key, kk)
    assert.equal(`v1.${chain.groupKeyCommitment.slice(2)}`, kc)
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

  it('derives the root key from the group key, for a group and for one piece', async () => {
    const { kk } = await keys()
    const base = { ...ref, chainId, kk, bearer: a.address, maxDepth: 0, expires }
    const scoped = await rootClaim(owner, { ...base, node: 'scope:team' })
    assert.deepEqual(scoped.nodeKey, keyForGroup(kk, 'team'))

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
    assert.deepEqual(nodeKey, keyForGroup(kk, 'team/alice'))
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

    // A piece link: the key is the piece's own, derived through the parent's group.
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
    assert.equal(`v1.${opened.claim.groupKeyCommitment.slice(2)}`, kc)
    assert.equal(commitment(opened.key).slice(3), opened.claim.keyCommitment.slice(2))

    await assert.rejects(openDelivery(bKey, delivery, { now }), /another bearer/)
    const swapped = await wrapTo(
      publicKeyOf(aKey),
      keyForGroup(kk, 'team/bob'),
      grantDescriptor(ref, 'scope:team/alice')
    )
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
    const ungated: PieceLabels = { 'foc/ks': keyId, 'foc/salt': newSalt() }
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
    const grant = await wrapTo(publicKeyOf(bKey), keyForGroup(kk, 'x'), grantDescriptor(ref, 'scope:x'))
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
    const whole = held('keyspace')
    const team = held('scope:team')
    const alice = held('scope:team/alice')
    const alice2 = held('scope:team/alice', { expires: expires + 1 })
    const piece = held(`piece:${salt}`)
    const grants = [whole, team, alice, piece, alice2]
    const pick = (target: Parameters<typeof pickGrant>[1], from = grants, at = now) =>
      pickGrant(from, target, { chainId, now: at })

    assert.equal(pick({ piece: labels('team/alice/notes', salt) }), piece)
    assert.equal(pick({ piece: labels('team/alice/notes') }), alice2) // deepest group; on a tie, the later expiry
    assert.equal(pick({ piece: labels('team/bob') }), team)
    assert.equal(pick({ piece: labels() }), whole) // no foc/scope: only the group key reaches it
    assert.equal(pick({ ...ref, group: 'team/alice/notes' }), alice2)
    const cafe = held('scope:team/caf\u00e9')
    assert.equal(pick({ ...ref, group: 'team/cafe\u0301' }, [team, cafe]), cafe) // compared in canonical (NFC) form
    assert.equal(pick({ ...ref, group: 'team' }, [alice, piece]), undefined) // nothing wide enough: ask for one
    // Depth wins over expiry: a deeper grant expiring sooner still beats a shallower one
    const soon = held('scope:team/alice', { expires: expires - 100 })
    assert.equal(pick({ piece: labels('team/alice/notes') }, [team, soon]), soon)
    assert.equal(pick({ ...ref, group: 'team/alice' }, [whole, team, soon]), soon)

    // Skipped: expired, another network, another group key, another owner
    assert.equal(pick({ piece: labels('team/x') }, [team], expires), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('scope:team', { chainId: 314n })]), undefined)
    const elsewhere = held('scope:team', { groupKeyId: '0xffeeddccbbaa99887766554433221100' })
    assert.equal(pick({ piece: labels('team/x') }, [elsewhere]), undefined)
    assert.equal(pick({ piece: labels('team/x') }, [held('scope:team', { owner: stranger.address })]), undefined)
    assert.equal(pick({ ...ref, group: 'team/x' }, [held('scope:team', { owner: stranger.address })]), undefined)

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

  it('writes the format 1 spelling for a caller-supplied node, whichever it is given in', async () => {
    const team = await root('group:team', 1)
    assert.equal((await verifyChain(team.chain, { now })).node, 'scope:team')
    assert.deepEqual(team.key, keyForGroup(team.kk, 'team'))
    const child = await delegateClaim(a, team.chain, {
      node: 'group:team/alice',
      parentKey: team.key,
      bearer: b.address,
      maxDepth: 0,
      now,
    })
    assert.equal(child.chain.links.at(-1)?.node, 'scope:team/alice')
    assert.equal((await root('groupKey', 0)).chain.links[0]?.node, 'keyspace')
    assert.equal((await root('keyspace', 0)).chain.links[0]?.node, 'keyspace')
  })

  it('reads format 2 nodes in a chain: mixed spellings, and no widening across them', async () => {
    const v2 = await handChain(['groupKey', 'group:team', 'group:team/alice'])
    assert.equal((await verifyChain(v2.chain, { now })).node, 'group:team/alice')
    const mixed = await handChain(['keyspace', 'group:team', 'scope:team/alice'])
    assert.equal((await verifyChain(mixed.chain, { now })).node, 'scope:team/alice')
    for (const [from, to] of [
      ['scope:team/alice', 'group:team'],
      ['group:team/alice', 'scope:team'],
      ['group:team', 'keyspace'],
      ['scope:team', 'groupKey'],
    ] as const) {
      const widened = await handChain([from, to])
      await assert.rejects(
        verifyChain(widened.chain, { now }),
        new RegExp(`widens ${from.replace('/', '\\/')} to ${to}`)
      )
    }
  })

  it('delegates from a received format 2 link, writing its own link in format 1 and keeping the old one as signed', async () => {
    const { chain, kk } = await handChain(['group:team'], 1)
    const { chain: two } = await delegateClaim(a, chain, {
      node: 'group:team/alice',
      parentKey: keyForGroup(kk, 'team'),
      bearer: b.address,
      maxDepth: 0,
    })
    assert.deepEqual(
      two.links.map((l) => l.node),
      ['group:team', 'scope:team/alice']
    )
    assert.equal((await verifyChain(two, { now })).node, 'scope:team/alice')
  })

  it('opens a delivery whose claim or wrap spells the node the format 2 way, keeping the received spelling', async () => {
    const { chain, kk } = await handChain(['group:team'])
    const team = keyForGroup(kk, 'team')
    const open = async (node: string) => {
      const wrap = await wrapTo(publicKeyOf(aKey), team, { ...grantDescriptor(ref, 'scope:team'), node })
      return openDelivery(aKey, encodeDelivery(chain, wrap), { now })
    }
    for (const node of ['group:team', 'scope:team']) {
      const opened = await open(node)
      assert.deepEqual(opened.key, team)
      assert.equal(opened.grant.node, node, 'a received spelling is kept: it is bound into the wrap')
      assert.equal(opened.claim.node, 'group:team')
    }
    await assert.rejects(open('group:other'), /another node/)
  })

  it('reads either spelling when deciding what a node reaches, with labels in either format', () => {
    const v2 = labels2('team/alice')
    for (const node of ['keyspace', 'groupKey', 'scope:team', 'group:team']) {
      assert.ok(reaches(node, labels('team/alice')), node)
      assert.ok(reaches(node, v2), node)
    }
    assert.ok(reaches('scope:team/alice', v2))
    assert.ok(!reaches('scope:team/bob', v2))
    assert.ok(!reaches('group:team/bob', labels('team/alice')))
    assert.ok(!reaches('group:team/bob', v2))
    assert.ok(reaches(`piece:${v2['foc/salt']}`, v2))
  })

  it('picks the narrowest grant across spellings, and takes labels in either format', () => {
    const held = (node: string) => ({
      claim: { owner: owner.address, groupKeyId: keyId, chainId, expires, node, bearer: a.address } as VerifiedClaim,
    })
    const team = held('group:team')
    const alice = held('scope:team/alice')
    const whole = held('keyspace')
    for (const piece of [labels('team/alice/notes'), labels2('team/alice/notes')]) {
      assert.equal(pickGrant([whole, team, alice], { piece }, { chainId, now }), alice)
    }
    assert.equal(pickGrant([whole, team, alice], { ...ref, group: 'team/x' }, { chainId, now }), team)
    assert.equal(pickGrant([alice], { ...ref, group: 'team' }, { chainId, now }), undefined)
    assert.equal(pickGrant([held('groupKey'), alice], { piece: labels2() }, { chainId, now })?.claim.node, 'groupKey')
  })

  it('verifies a presentation with format 2 labels, saying `group` where format 1 says `scope`', async () => {
    const { chain } = await root('scope:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const check = (piece: PieceLabels) => verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })
    assert.equal((await check(labels2('team/x'))).node, 'scope:team')
    await assert.rejects(check(labels2('other')), /scope:team does not reach this piece \(group other\)/)
    await assert.rejects(check(labels('other')), /scope:team does not reach this piece \(scope other\)/)
  })

  it('takes the format from which labels are present, and never reads foc/v', async () => {
    const { chain } = await root('scope:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const check = (piece: unknown) =>
      verifyPresentation(bytes, { pieceCid: PIECE, piece: piece as PieceLabels, chainId, now })
    // A provider may pass it as a string (from Go or JSON), or wrongly, or not at all
    for (const v of ['1', '2', 1, 2, 7, null, undefined]) {
      assert.equal((await check({ ...labels('team/x'), 'foc/v': v })).node, 'scope:team', `v1 labels, foc/v ${v}`)
      assert.equal((await check({ ...labels2('team/x'), 'foc/v': v })).node, 'scope:team', `v2 labels, foc/v ${v}`)
    }
    assert.ok(reaches('scope:team', { ...labels('team/x'), 'foc/v': '1' } as PieceLabels))
    // Both group labels: refused, whatever foc/v says
    for (const v of [1, 2, undefined]) {
      await assert.rejects(
        check({ ...labels('team/x'), 'foc/group': 'team/x', 'foc/v': v }),
        /A format 2 envelope must not carry foc\/scope/
      )
    }
    assert.throws(
      () => reaches('scope:team', { ...labels('team/x'), 'foc/group': 'team/x' } as PieceLabels),
      /A format 2 envelope must not carry foc\/scope/
    )
  })

  it('refuses a present foc/own that is not an address, and treats a falsy one as not gated', async () => {
    const { chain } = await root('scope:team', 0)
    const bytes = encodePresentation(chain, await signRequest(a, chain, { pieceCid: PIECE, expires: now + 100, now }))
    const piece = labels('secret')
    const held = [
      {
        claim: {
          node: 'scope:team',
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
      assert.throws(() => readPieceMetadata({ ...piece, 'foc/v': 1, 'foc/own': bad }), /foc\/own must be an address/)
      const v2 = { ...labels2('secret'), 'foc/v': 2, 'foc/own': bad }
      assert.throws(() => readPieceMetadata(v2), /foc\/own must be an address/)
    }
    for (const falsy of [undefined, null, '']) {
      const ungated = { ...piece, 'foc/own': falsy } as never
      assert.equal(
        (await verifyPresentation(bytes, { pieceCid: PIECE, piece: ungated, chainId, now })).node,
        'scope:team'
      )
      assert.equal(readPieceMetadata({ ...piece, 'foc/v': 1, 'foc/own': falsy }).owner, undefined)
    }
    assert.equal(
      (await verifyPresentation(bytes, { pieceCid: PIECE, piece: {} as never, chainId, now })).node,
      'scope:team'
    )
    const rest = { 'foc/ks': keyId, 'foc/salt': 'x' } as never
    assert.equal((await verifyPresentation(bytes, { pieceCid: PIECE, piece: rest, chainId, now })).node, 'scope:team')
  })

  // Outcomes of the code at 400e56ec (0.1.0) for stored or legacy labels, which this release must keep.
  it('treats bad format 1 labels as 0.1.0 did: only the label a decision needs is read', async () => {
    const { chain: whole } = await root('keyspace', 0)
    const { chain: team } = await root('scope:team', 0)
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
      'foc/ks': keyId,
      'foc/scope': 'team/alice',
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
      ['no foc/ks', { 'foc/ks': undefined }, ['true', 'true', 'true', T, T, T, T]],
      ['bad foc/ks', { 'foc/ks': '0xzz' }, ['true', 'true', 'true', T, T, T, T]],
      ['bad salt', { 'foc/salt': 'zz' }, ['true', 'true', T, 'served', 'served', 'found', T]],
      ['no salt', { 'foc/salt': undefined }, ['true', 'true', T, 'served', 'served', 'found', T]],
      ['bad scope', { 'foc/scope': ' x' }, ['true', T, 'true', 'served', T, T, T]],
      ['scope not a string', { 'foc/scope': 1 }, ['true', T, 'true', 'served', T, T, T]],
      ['no owner', { 'foc/own': undefined }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['empty owner', { 'foc/own': '' }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['null owner', { 'foc/own': null }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
      ['owner not an address', { 'foc/own': 'nope' }, ['true', 'true', 'true', T, T, T, T]],
      ['owner a number', { 'foc/own': 1 }, ['true', 'true', 'true', T, T, T, T]],
      ['foc/v a string', { 'foc/v': '1' }, ['true', 'true', 'true', 'served', 'served', 'found', 'found']],
    ]
    for (const [name, change, want] of rows) {
      const piece = { ...base, ...change } as PieceLabels
      const present1 = (bytes: Uint8Array) => async () =>
        (await verifyPresentation(bytes, { pieceCid: PIECE, piece, chainId, now })) && 'served'
      const pick = (node: string) => async () =>
        pickGrant(grant(node), { piece }, { chainId, now }) ? 'found' : 'undefined'
      const got = [
        await outcome(() => reaches('keyspace', piece)),
        await outcome(() => reaches('scope:team', piece)),
        await outcome(() => reaches(`piece:${salt}`, piece)),
        await outcome(present1(wholeBytes)),
        await outcome(present1(teamBytes)),
        await outcome(pick('scope:team')),
        await outcome(pick(`piece:${salt}`)),
      ]
      assert.deepStrictEqual(got, want, name)
    }
  })

  it('keeps format 1 wording for malformed format 1 labels', () => {
    const base = { 'foc/v': 1, 'foc/own': owner.address, 'foc/ks': keyId, 'foc/salt': newSalt() }
    assert.throws(() => readPieceMetadata({ ...base, 'foc/scope': ' x' }), /A scope name/)
    assert.throws(() => readPieceMetadata({ ...base, 'foc/scope': 1 }), /A scope path must be a string/)
    assert.throws(() => readPieceMetadata({ ...base, 'foc/v': 2, 'foc/group': ' x' }), /A group name/)
  })
})
