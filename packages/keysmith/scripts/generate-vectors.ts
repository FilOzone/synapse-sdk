/**
 * Regenerates the cross-implementation vectors from this implementation:
 *
 *   node scripts/generate-vectors.ts
 *
 * Writes `test/vectors.json` and `test/claims-vectors.json`. Deterministic: signatures are RFC 6979, the
 * grant wraps draw their randomness from a seeded generator, and nothing reads the clock, so a second run
 * leaves the files byte-identical. The tests read the JSON; they never call this script.
 */
import { writeFileSync } from 'node:fs'
import { sha256 } from '@noble/hashes/sha2.js'
import { decode, encode } from 'cborg'
import { type Address, bytesToHex, type Hex, hashTypedData, hexToBytes } from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import {
  type Claim,
  type ClaimChain,
  delegateClaim,
  encodePresentation,
  keyCommitmentOf,
  type PieceLabels,
  READ_GRANT_TYPES,
  READ_REQUEST_TYPES,
  rootClaim,
  verifyPresentation,
} from '../src/claims.ts'
import {
  DOMAIN,
  dataSetMetadata,
  deriveGroupKey,
  GROUP_KEY_TYPES,
  grantDescriptor,
  groupKeyMessage,
  keyForEnvelope,
  keyForGroup,
  matchesCommitment,
  pieceMetadata,
  readPieceMetadata,
} from '../src/derive.ts'
import type { GroupKeyRef } from '../src/types.ts'
import { decodeGrant, encodeGrant, publicKeyOf, wrapTo } from '../src/wrap.ts'

const DIR = new URL('../test/', import.meta.url)

const DESCRIPTION =
  'These vectors were produced by this implementation (FIP-1253 draft), so they pin it against change ' +
  'rather than independently confirm it. They are what Curio and other implementations test against. ' +
  'The private keys are the well-known Anvil/Hardhat development keys: public, never for anything of value.'

// Anvil development keys #0 (the group key owner) to #4
const KEYS = {
  owner: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  A: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  B: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  C: '0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6',
  D: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
} as const
const WHO = {
  owner: privateKeyToAccount(KEYS.owner),
  A: privateKeyToAccount(KEYS.A),
  B: privateKeyToAccount(KEYS.B),
  C: privateKeyToAccount(KEYS.C),
  D: privateKeyToAccount(KEYS.D),
}

const GROUP_KEY_ID = '0x00112233445566778899aabbccddeeff' as const
const ref: GroupKeyRef = { owner: WHO.owner.address, groupKeyId: GROUP_KEY_ID }

const writeJson = (name: string, value: unknown) =>
  writeFileSync(new URL(name, DIR), `${JSON.stringify(value, null, 2)}\n`)

/** Replaces `crypto.getRandomValues` with a seeded stream, so a wrap (ephemeral key, nonce) is reproducible. */
function seedRandom(seed: string) {
  let counter = 0
  Object.defineProperty(globalThis.crypto, 'getRandomValues', {
    configurable: true,
    value: (view: Uint8Array) => {
      for (let at = 0; at < view.length; at += 32) {
        const block = sha256(new TextEncoder().encode(`${seed}/${counter++}`))
        view.set(block.subarray(0, Math.min(32, view.length - at)), at)
      }
      return view
    },
  })
}

const typeString = (name: string, fields: readonly { name: string; type: string }[]) =>
  `${name}(${fields.map((f) => `${f.type} ${f.name}`).join(',')})`

function refusal(run: () => unknown, expected: RegExp): string {
  try {
    run()
  } catch (err) {
    const { message } = err as Error
    if (!expected.test(message)) throw new Error(`Expected a refusal matching ${expected}, got "${message}"`)
    return message
  }
  throw new Error('Expected a refusal, got none')
}

// ── vectors.json: derivation, envelope labels, wraps ─────────────────────

async function derivationVectors() {
  const recipient = KEYS.A
  const group = 'admin/finance'
  const pieceGroup = 'admin/finance/clerks'
  const salt = '0x000102030405060708090a0b0c0d0e0f' as const
  const password = 'correct horse battery staple'

  const { groupKey, commitment } = await deriveGroupKey(WHO.owner, ref)
  const locked = await deriveGroupKey(WHO.owner, ref, { password })
  const metadata = pieceMetadata(ref, { salt, group: pieceGroup })
  const groupNodeKey = keyForGroup(groupKey, group)
  const pieceKey = keyForEnvelope(groupKey, metadata)

  const aad = (cbor: Uint8Array) => {
    const { v, node, owner, groupKeyId } = decodeGrant(cbor)
    return bytesToHex(encode([v, node, hexToBytes(owner), hexToBytes(groupKeyId)]))
  }
  seedRandom('keysmith vectors: group grant')
  const grant = encodeGrant(await wrapTo(publicKeyOf(recipient), groupNodeKey, grantDescriptor(ref, `group:${group}`)))
  seedRandom('keysmith vectors: piece grant')
  const pieceGrant = encodeGrant(
    await wrapTo(publicKeyOf(recipient), pieceKey, grantDescriptor(ref, `piece:${metadata['foc/salt']}`))
  )

  // What keysmith 0.1.0 (format 1) wrote. Refused by name, before anything is derived.
  const format1Metadata = {
    'foc/v': 1,
    'foc/own': WHO.owner.address.toLowerCase(),
    'foc/ks': GROUP_KEY_ID,
    'foc/scope': pieceGroup,
    'foc/salt': salt,
  }
  const grantFields = decode(grant, { useMaps: true }) as Map<number | string, unknown>
  const format1Grant = encode(new Map(grantFields).set(0, 1).set(1, `scope:${group}`))
  const format1Commitment = `v1.${commitment.slice('v2.'.length)}`
  const format1DataSet = { 'foc/ks': GROUP_KEY_ID, 'foc/kc': format1Commitment }

  writeJson('vectors.json', {
    description: `Keysmith format 2 outputs for fixed inputs. A release that changes any of them orphans existing keys. ${DESCRIPTION}`,
    owner: { privateKey: KEYS.owner, address: WHO.owner.address },
    groupKeyId: GROUP_KEY_ID,
    groupKey: {
      typedData: {
        type: typeString('GroupKey', GROUP_KEY_TYPES.GroupKey),
        hash: hashTypedData({
          domain: DOMAIN,
          types: GROUP_KEY_TYPES,
          primaryType: 'GroupKey',
          message: groupKeyMessage(ref),
        }),
      },
      groupKey: bytesToHex(groupKey),
      commitment,
    },
    passwordGroupKey: {
      kdf: 'argon2id v0x13, m=65536 KiB, t=3, p=1, dkLen=32, salt=EIP-712 hash of the GroupKey message',
      password,
      groupKey: bytesToHex(locked.groupKey),
      commitment: locked.commitment,
    },
    group: { path: group, key: bytesToHex(groupNodeKey) },
    piece: { metadata, key: bytesToHex(pieceKey) },
    dataSet: dataSetMetadata(ref, commitment),
    // Not refused: a lookup across a wallet's data sets skips it.
    format1DataSet: {
      what: 'groupKeyIdOf of a data set from keysmith 0.1.0 (foc/ks) is undefined',
      dataSet: format1DataSet,
    },
    recipient: { privateKey: recipient, publicKey: publicKeyOf(recipient) },
    grant: { cbor: bytesToHex(grant), aad: aad(grant) },
    pieceGrant: { cbor: bytesToHex(pieceGrant), aad: aad(pieceGrant) },
    refused: [
      {
        what: 'An envelope from keysmith 0.1.0 (foc/v 1)',
        metadata: format1Metadata,
        reason: refusal(
          () => readPieceMetadata(format1Metadata),
          /format 1\) data is not supported: this piece is labelled foc\/v 1/
        ),
      },
      {
        what: 'A grant from keysmith 0.1.0 (v 1)',
        cbor: bytesToHex(format1Grant),
        reason: refusal(() => decodeGrant(format1Grant), /format 1\) data is not supported: a grant with v 1/),
      },
      {
        what: 'A group key commitment from keysmith 0.1.0 (v1.)',
        commitment: format1Commitment,
        reason: refusal(
          () => matchesCommitment(groupKey, format1Commitment),
          /format 1\) data is not supported: a v1 commitment/
        ),
      },
    ],
  })
}

// ── claims-vectors.json: presentations a gating provider must serve or refuse ──

const CHAIN_ID = 314159n
const NOW = 1792285200
const ROOT_EXPIRES = 1792886400
const REQUEST_LIFETIME = 300
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n

// The pieces: binary CID, as the header example shows it, and the salt in its envelope
const P1 = {
  cid: '0x015591202233045cbb956831a8e247ed06f7f293fadf1a1b646bec8542ac6a4cd2292913636927',
  text: 'bafkzcibcgmcfzo4vnay2rysh5udpp4ut7lprug3enpwikqvmnjgnekjjcnrwsjy',
  salt: '0x3b7e0c9a51f24d86a0d1e7c45b29f803',
} as const
const P2 = {
  cid: '0x01559120223304b2c4dd41e92b4d46d452afe621873a223132c7ac9408f6df6f8e7c4cb676f43c',
  text: 'bafkzcibcgmclfrg5ihuswtkg2rjk7zrbq45cemjsy6wjichw35xy47cmwz3pipa',
  salt: '0xc04a6f19e83b5d27f61c0a9e4d38b725',
} as const
const P3 = {
  cid: '0x0155912023f40104b6897abe85884c3a69cae59791aae986b7d4861f77fc636dfeb410230eae9435',
  text: 'bafkzcibd6qaqjnujpk7ilccmhju4vzmxsgvotbvx2sdb6574mnw75naqemhk5fbv',
  salt: '0x9f3c41d2e07b6a58c1f20e4d7b93a6c5',
} as const

type Piece = typeof P1 | typeof P2 | typeof P3
const FORMAT1 = /keysmith 0\.1\.0 \(format 1\) data is not supported/
type Step = 'decode' | 'root' | 'link' | 'request' | 'piece'
type Who = keyof typeof WHO
type Parts = { version: number; links: Map<number | string, unknown>[]; request: Map<number, unknown> }

const labels = (group: string | undefined, piece: Piece): Record<string, unknown> => ({
  'foc/own': WHO.owner.address.toLowerCase(),
  'foc/gkid': GROUP_KEY_ID,
  ...(group === undefined ? {} : { 'foc/group': group }),
  'foc/salt': piece.salt,
})

const grantMessage = (chain: ClaimChain, link: Omit<Claim, 'signature'>) => ({
  v: 2,
  node: link.node,
  owner: chain.owner,
  groupKeyId: chain.groupKeyId,
  bearer: link.bearer,
  maxDepth: link.maxDepth,
  chainId: chain.chainId,
  keyCommitment: link.keyCommitment,
  groupKeyCommitment: chain.groupKeyCommitment,
  expires: BigInt(chain.expires),
})

/** One link signed by hand, so a vector can carry a link the writers would refuse to make. */
async function signed(
  signer: PrivateKeyAccount,
  chain: ClaimChain,
  link: Omit<Claim, 'signature'>,
  domain: { name: string; version: string } = DOMAIN
): Promise<Claim> {
  const signature = await signer.signTypedData({
    domain,
    types: READ_GRANT_TYPES,
    primaryType: 'ReadGrant',
    message: grantMessage(chain, link),
  })
  return { ...link, signature }
}

const requestMessage = (pieceCid: Hex, expires: number) => ({
  chainId: CHAIN_ID,
  pieceCid,
  expires: BigInt(expires),
})

async function signedRequest(
  signer: PrivateKeyAccount,
  pieceCid: Hex,
  expires: number,
  domain: { name: string; version: string } = DOMAIN
) {
  const signature = await signer.signTypedData({
    domain,
    types: READ_REQUEST_TYPES,
    primaryType: 'ReadRequest',
    message: requestMessage(pieceCid, expires),
  })
  return { pieceCid: hexToBytes(pieceCid), expires, signature }
}

const link = (node: string, bearer: Who, maxDepth: number, key: Uint8Array) => ({
  node,
  bearer: WHO[bearer].address,
  maxDepth,
  keyCommitment: keyCommitmentOf(key),
})

const cbor = (parts: Parts, extra: unknown[] = []) =>
  encode([parts.version, parts.links, parts.request, ...extra]) as Uint8Array

const parts = (bytes: Uint8Array): Parts => {
  const [version, links, request] = decode(bytes, { useMaps: true }) as [
    number,
    Map<number | string, unknown>[],
    Map<number, unknown>,
  ]
  return { version, links: links.map((l) => new Map(l)), request: new Map(request) }
}

const concat = (...chunks: Uint8Array[]) => Uint8Array.from(chunks.flatMap((c) => [...c]))

/** CBOR map or array with the entries exactly as given, which `encode()` of a Map would reorder. */
const rawMap = (pairs: [unknown, unknown][]) =>
  concat(Uint8Array.of(0xa0 + pairs.length), ...pairs.flatMap(([k, v]) => [encode(k), encode(v)]))
const rawArray = (items: Uint8Array[]) => concat(Uint8Array.of(0x80 + items.length), ...items)
const reversed = (m: Map<number | string, unknown>) => rawMap([...m].reverse())

async function claimVectors() {
  const { groupKey, commitment } = await deriveGroupKey(WHO.owner, ref)
  const base = { ...ref, chainId: CHAIN_ID, groupKey, expires: ROOT_EXPIRES, now: NOW }

  // Example 1: the group key to A (depth 1); A gives B one group
  const e1Root = await rootClaim(WHO.owner, { ...base, node: 'groupKey', bearer: WHO.A.address, maxDepth: 1 })
  const e1 = await delegateClaim(WHO.A, e1Root.chain, {
    node: 'group:agent-memory',
    parentKey: e1Root.nodeKey,
    bearer: WHO.B.address,
    maxDepth: 0,
    now: NOW,
  })
  // Example 2: A gives B `admin`, B gives C `admin/finance`
  const e2Root = await rootClaim(WHO.owner, { ...base, node: 'groupKey', bearer: WHO.A.address, maxDepth: 2 })
  const e2Mid = await delegateClaim(WHO.A, e2Root.chain, {
    node: 'group:admin',
    parentKey: e2Root.nodeKey,
    bearer: WHO.B.address,
    maxDepth: 1,
    now: NOW,
  })
  const e2 = await delegateClaim(WHO.B, e2Mid.chain, {
    node: 'group:admin/finance',
    parentKey: e2Mid.nodeKey,
    bearer: WHO.C.address,
    maxDepth: 0,
    now: NOW,
  })
  // Example 3: A gives B one piece, with a locator for where it lives
  const e3Piece = labels('super-secret', P3) as PieceLabels
  const e3Root = await rootClaim(WHO.owner, { ...base, node: 'groupKey', bearer: WHO.A.address, maxDepth: 1 })
  const e3 = await delegateClaim(WHO.A, e3Root.chain, {
    node: `piece:${P3.salt}`,
    parentKey: e3Root.nodeKey,
    bearer: WHO.B.address,
    maxDepth: 0,
    piece: e3Piece,
    pieceCid: hexToBytes(P3.cid),
    now: NOW,
  })

  const fresh = (at: number) => at + REQUEST_LIFETIME
  const present = async (chain: ClaimChain, signer: Who, piece: Piece, at = NOW) =>
    encodePresentation(chain, await signedRequest(WHO[signer], piece.cid, fresh(at)))

  const e1Bytes = await present(e1.chain, 'B', P1)
  const e2Bytes = await present(e2.chain, 'C', P2)
  const e3Bytes = await present(e3.chain, 'B', P3)

  const cases: {
    name: string
    presentation: Uint8Array
    piece: Piece
    labels: Record<string, unknown>
    chainId?: bigint
    now?: number
    expect: 'served' | Step
    reason?: RegExp
  }[] = []
  const add = (
    name: string,
    presentation: Uint8Array,
    piece: Piece,
    labelSet: Record<string, unknown>,
    expect: 'served' | Step,
    reason?: RegExp,
    more: { chainId?: bigint; now?: number } = {}
  ) => cases.push({ name, presentation, piece, labels: labelSet, expect, reason, ...more })

  const L1 = labels('agent-memory', P1)
  const L2 = labels('admin/finance/clerks', P2)
  const L3 = labels('super-secret', P3)

  // Examples
  add('Example 1: B fetches an agent-memory piece', e1Bytes, P1, L1, 'served')
  add(
    'Example 1: B asks for a super-secret piece',
    e1Bytes,
    P1,
    labels('super-secret', P1),
    'piece',
    /does not reach this piece/
  )
  const e1Extra = await signed(WHO.B, e1.chain, link('group:agent-memory', 'D', 0, e1.nodeKey))
  const overDepth = { ...e1.chain, links: [...e1.chain.links, e1Extra] }
  add(
    'Example 1: B adds a link for D (B has maxDepth 0)',
    await present(overDepth, 'D', P1),
    P1,
    L1,
    'link',
    /exceeds link 1's maxDepth/
  )
  add('Example 2: C fetches an admin/finance/clerks piece', e2Bytes, P2, L2, 'served')
  add(
    'Example 2: C asks for an admin/legal piece',
    e2Bytes,
    P2,
    labels('admin/legal', P2),
    'piece',
    /does not reach this piece/
  )
  add(
    'Example 2: C asks for an unlabelled piece',
    e2Bytes,
    P2,
    labels(undefined, P2),
    'piece',
    /does not reach this piece/
  )

  // Attacks on the chain
  const e2Links = e2.chain.links as [Claim, Claim, Claim]
  const widened = {
    ...e2.chain,
    links: [e2Links[0], e2Links[1], await signed(WHO.B, e2.chain, link('groupKey', 'C', 0, groupKey))],
  }
  add(
    'Widening: B issues C the whole group key',
    await present(widened, 'C', P2),
    P2,
    L2,
    'link',
    /widens group:admin to groupKey/
  )
  const forgedLink = await signed(
    WHO.C,
    e2.chain,
    link('group:admin/finance', 'C', 0, keyForGroup(groupKey, 'admin/finance'))
  )
  const forged = { ...e2.chain, links: [e2Links[0], e2Links[1], forgedLink] }
  add(
    'Forged link: C signs its own link',
    await present(forged, 'C', P2),
    P2,
    L2,
    'link',
    /is not signed by link 1's bearer/
  )
  add(
    "Stolen header used to fetch a different piece of C's group",
    e2Bytes,
    P1,
    labels('admin/finance/clerks', P1),
    'request',
    /names another piece/
  )
  add('Header replayed ten minutes after it was sent', e2Bytes, P2, L2, 'request', /request has expired/, {
    now: NOW + 600,
  })
  add(
    'Five days later: the same links, with a fresh request',
    await present(e2.chain, 'C', P2, NOW + 432000),
    P2,
    L2,
    'served',
    undefined,
    { now: NOW + 432000 }
  )
  add(
    "Eight days later: past the root's expiry, with a fresh request",
    await present(e2.chain, 'C', P2, NOW + 691200),
    P2,
    L2,
    'root',
    /chain expired/,
    { now: NOW + 691200 }
  )

  const ring: Who[] = ['A', 'B', 'C', 'D', 'A', 'B', 'C', 'D', 'A']
  const nine: ClaimChain = { ...e1Root.chain, links: [] }
  for (const [i, bearer] of ring.entries()) {
    const signer = i === 0 ? WHO.owner : WHO[ring[i - 1] as Who]
    nine.links.push(await signed(signer, nine, link('groupKey', bearer, ring.length - 1 - i, groupKey)))
  }
  add('Too long: a chain of nine links', await present(nine, 'A', P1), P1, L1, 'decode', /array of 1 to 8 links/)

  // Example 3, one piece
  add('Example 3: B fetches the one piece it was given', e3Bytes, P3, L3, 'served')
  add(
    'Example 3: B asks for a different super-secret piece',
    await present(e3.chain, 'B', P2),
    P2,
    labels('super-secret', P2),
    'piece',
    /does not reach this piece/
  )
  const swapped = {
    ...e3.chain,
    links: [e3.chain.links[0] as Claim, { ...(e3.chain.links[1] as Claim), pieceCid: hexToBytes(P2.cid) }],
  }
  add(
    "Example 3: the piece link's CID locator is swapped for another piece's",
    await present(swapped, 'B', P3),
    P3,
    L3,
    'served'
  )
  const agentRoot = await rootClaim(WHO.owner, {
    ...base,
    node: 'group:agent-memory',
    bearer: WHO.A.address,
    maxDepth: 1,
  })
  const reachLink = await signed(
    WHO.A,
    agentRoot.chain,
    link(`piece:${P3.salt}`, 'B', 0, keyForEnvelope(groupKey, { ...e3Piece, 'foc/v': 2 }))
  )
  const overReach = { ...agentRoot.chain, links: [...agentRoot.chain.links, reachLink] }
  add(
    'Example 3: A held only agent-memory, but gives B a super-secret piece',
    await present(overReach, 'B', P3),
    P3,
    L3,
    'link',
    /widens group:agent-memory to piece/
  )

  // Attacks on the root: A re-signs it, so the signature is well formed but not the owner's
  const rootSignedByA = async (change: Partial<Claim>, expires = ROOT_EXPIRES) => {
    const chain = { ...e2.chain, expires }
    const root = await signed(WHO.A, chain, { ...link('groupKey', 'A', 2, groupKey), ...change })
    return { ...chain, links: [root, ...e2.chain.links.slice(1)] }
  }
  add(
    'A raises its own root from maxDepth 2 to 5',
    await present(await rootSignedByA({ maxDepth: 5 }), 'C', P2),
    P2,
    L2,
    'root',
    /root is not signed by the owner/
  )
  add(
    "A extends its root's expiry by a year",
    await present(await rootSignedByA({}, ROOT_EXPIRES + 31536000), 'C', P2),
    P2,
    L2,
    'root',
    /root is not signed by the owner/
  )
  add(
    'A signs its own root, naming the owner',
    await present(await rootSignedByA({}), 'C', P2),
    P2,
    L2,
    'root',
    /root is not signed by the owner/
  )
  add("The owner revokes A's session key: Example 2 again, no chain read", e2Bytes, P2, L2, 'served')

  // Signed under the 0.1.0 domain, which no longer verifies
  const oldDomain = { name: 'FOC Encryption', version: '1' }
  const oldRoot = await signed(WHO.owner, e1.chain, e1.chain.links[0] as Claim, oldDomain)
  add(
    'A root signed under the 0.1.0 EIP-712 domain',
    await present({ ...e1.chain, links: [oldRoot, e1.chain.links[1] as Claim] }, 'B', P1),
    P1,
    L1,
    'root',
    /root is not signed by the owner/
  )
  const oldRequest = await signedRequest(WHO.B, P1.cid, fresh(NOW), oldDomain)
  add(
    'A request signed under the 0.1.0 EIP-712 domain',
    encodePresentation(e1.chain, oldRequest),
    P1,
    L1,
    'request',
    /not signed by the final bearer/
  )

  // Encoding: what a strict decoder refuses. All start from Example 1.
  const e1Parts = () => parts(e1Bytes)
  const refuse = (name: string, bytes: Uint8Array, reason: RegExp) => add(name, bytes, P1, L1, 'decode', reason)
  const mutate = (from: Uint8Array, change: (p: Parts) => unknown) => {
    const p = parts(from)
    change(p)
    return cbor(p)
  }
  const withParts = (change: (p: Parts) => unknown) => mutate(e1Bytes, change)
  refuse(
    'Map keys in reverse order (not the deterministic encoding)',
    concat(Uint8Array.of(0x83), encode(2), rawArray(e1Parts().links.map(reversed)), reversed(e1Parts().request)),
    /not canonical CBOR/
  )
  refuse(
    'Integers in a longer form than needed',
    concat(e1Bytes.subarray(0, 1), Uint8Array.of(0x18, 0x02), e1Bytes.subarray(2)),
    /not canonical CBOR/
  )
  refuse(
    'Indefinite-length arrays',
    concat(Uint8Array.of(0x9f), e1Bytes.subarray(1), Uint8Array.of(0xff)),
    /not canonical CBOR/
  )
  refuse('A byte after the presentation', concat(e1Bytes, Uint8Array.of(0)), /not canonical CBOR/)
  refuse('The presentation inside a CBOR tag', concat(Uint8Array.of(0xd8, 0x18), e1Bytes), /not canonical CBOR/)
  const req = e1Parts().request
  refuse(
    'A request map with key 2 twice',
    concat(
      Uint8Array.of(0x83),
      encode(2),
      encode(e1Parts().links),
      rawMap([
        [0, req.get(0)],
        [1, req.get(1)],
        [2, req.get(2)],
        [2, req.get(2)],
      ])
    ),
    /not canonical CBOR/
  )
  const nodeBytes = new TextEncoder().encode('group:agent-memory')
  const at = indexOf(e1Bytes, nodeBytes)
  const illFormed = e1Bytes.slice()
  illFormed[at + nodeBytes.length - 1] = 0xff
  refuse('Ill-formed UTF-8 in a node string', illFormed, /not canonical CBOR/)
  refuse(
    'A request with an unknown field 3',
    withParts((p) => p.request.set(3, 0)),
    /request has an unknown field 3/
  )
  refuse(
    'A link with an unknown field 12',
    withParts((p) => p.links[1]?.set(12, 0)),
    /Link 1 has an unknown field 12/
  )
  refuse(
    'A link with a text key',
    withParts((p) => p.links[1]?.set('x', 0)),
    /Link 1 has an unknown field x/
  )
  refuse(
    'A later link repeating the root-only field 2 (owner)',
    withParts((p) => p.links[1]?.set(2, hexToBytes(WHO.owner.address))),
    /Link 1 repeats a root-only field/
  )
  refuse('A presentation array of 4 items', cbor(e1Parts(), [0]), /Not a version 2 presentation/)
  refuse(
    'Format version 1 (keysmith 0.1.0)',
    withParts((p) => (p.version = 1)),
    /keysmith 0\.1\.0 \(format 1\) data is not supported: a version 1 presentation/
  )
  refuse(
    'Format version 3',
    withParts((p) => (p.version = 3)),
    /Not a version 2 presentation/
  )
  refuse(
    'A link with v = 1 (keysmith 0.1.0)',
    withParts((p) => p.links[0]?.set(0, 1)),
    /keysmith 0\.1\.0 \(format 1\) data is not supported: link 0 has v 1/
  )
  refuse(
    'A link with v = 3',
    withParts((p) => p.links[0]?.set(0, 3)),
    /Link 0 has an unsupported version/
  )
  refuse(
    'chainId of 2^53, beyond the integer range',
    withParts((p) => p.links[0]?.set(6, 2n ** 53n)),
    /not canonical CBOR/
  )
  refuse(
    'maxDepth of 256',
    withParts((p) => p.links[1]?.set(5, 256)),
    /maxDepth must be 0 to 255/
  )
  refuse(
    'A node that is not canonical ("group:agent-memory/")',
    withParts((p) => p.links[1]?.set(1, 'group:agent-memory/')),
    /A group name must be non-empty/
  )
  add(
    'A piece node with a 1-byte salt',
    mutate(e3Bytes, (p) => p.links[1]?.set(1, 'piece:0xab')),
    P3,
    L3,
    'decode',
    /names a 16-byte salt/
  )
  const highS = (sig: Uint8Array) => {
    const out = sig.slice()
    out.set(hexToBytes(`0x${(N - BigInt(bytesToHex(sig.subarray(32, 64)))).toString(16).padStart(64, '0')}`), 32)
    out[64] = sig[64] === 27 ? 28 : 27
    return out
  }
  refuse(
    'A request signature with a high s',
    withParts((p) => p.request.set(2, highS(p.request.get(2) as Uint8Array))),
    /must have a low s/
  )
  refuse(
    'A request signature with v = 0 or 1',
    withParts((p) => {
      const sig = (p.request.get(2) as Uint8Array).slice()
      sig[64] = (sig[64] as number) - 27
      p.request.set(2, sig)
    }),
    /must have a low s/
  )

  // Network, and the labels as an envelope spells them
  add(
    'A presentation for another network (verifier on chain 314)',
    e1Bytes,
    P1,
    L1,
    'request',
    /names another network/,
    { chainId: 314n }
  )
  add(
    'Labels: foc/gkid in uppercase hex (compared as bytes)',
    e1Bytes,
    P1,
    { ...L1, 'foc/gkid': GROUP_KEY_ID.toUpperCase().replace('0X', '0x') },
    'served'
  )
  add(
    'Labels: foc/own checksummed (compared as an address)',
    e1Bytes,
    P1,
    { ...L1, 'foc/own': WHO.owner.address },
    'served'
  )
  add(
    'Labels: foc/group decomposed (compared after NFC)',
    e1Bytes,
    P1,
    { ...L1, 'foc/group': 'agent-memory/café' },
    'served'
  )
  add(
    'Labels: foc/salt in uppercase hex, for a piece link',
    e3Bytes,
    P3,
    { ...L3, 'foc/salt': P3.salt.toUpperCase().replace('0X', '0x') },
    'served'
  )
  add('Labels: foc/v as the string "2" is ignored', e1Bytes, P1, { ...L1, 'foc/v': '2' }, 'served')
  const withKey = parts(e1Bytes)
  withKey.links[1]?.set(9, hexToBytes(P1.cid))
  add('A pieceCid locator (key 9) on a group link is ignored', cbor(withKey), P1, L1, 'served')
  const ungated = without({ ...L1, 'foc/group': 'something-else' }, 'foc/own')
  add('A piece with no foc/own is not gated: served without checking the group', e1Bytes, P1, ungated, 'served')
  const format1 = { ...without(L1, 'foc/gkid', 'foc/group'), 'foc/ks': GROUP_KEY_ID, 'foc/scope': 'agent-memory' }
  add('Labels from keysmith 0.1.0 (foc/v 1) are refused', e1Bytes, P1, { ...format1, 'foc/v': 1 }, 'piece', FORMAT1)
  add('Labels from keysmith 0.1.0 (foc/ks, no foc/v) are refused', e1Bytes, P1, format1, 'piece', FORMAT1)

  // Run every case through the implementation; its answer is the vector
  const out = []
  for (const c of cases) {
    const chainId = c.chainId ?? CHAIN_ID
    const now = c.now ?? NOW
    const run = verifyPresentation(c.presentation, {
      pieceCid: hexToBytes(c.piece.cid),
      piece: c.labels as PieceLabels,
      chainId,
      now,
    })
    let expect: { result: 'served'; node: string; bearer: Address } | { result: 'refused'; step: Step; reason: string }
    try {
      const claim = await run
      expect = { result: 'served', node: claim.node, bearer: claim.bearer }
    } catch (err) {
      expect = { result: 'refused', step: c.expect as Step, reason: (err as Error).message }
    }
    if ((expect.result === 'served') !== (c.expect === 'served')) {
      throw new Error(`${c.name}: expected ${c.expect}, got ${JSON.stringify(expect)}`)
    }
    if (expect.result === 'refused' && !c.reason?.test(expect.reason)) {
      throw new Error(`${c.name}: expected a reason matching ${c.reason}, got "${expect.reason}"`)
    }
    out.push({
      name: c.name,
      presentation: bytesToHex(c.presentation),
      pieceCid: c.piece.cid,
      labels: c.labels,
      chainId: chainId.toString(),
      now,
      expect,
    })
  }

  const message = (m: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v]))
  const [l0, l1] = e1.chain.links as [Claim, Claim]
  const e1Req = decodeRequest(e1Bytes)
  const digest = (what: string, typed: Parameters<typeof hashTypedData>[0], signature: Hex, signer: Address) => ({
    what,
    message: message(typed.message as Record<string, unknown>),
    hash: hashTypedData(typed),
    signature,
    signer,
  })
  const grantTyped = (l: Claim) => ({
    domain: DOMAIN,
    types: READ_GRANT_TYPES,
    primaryType: 'ReadGrant',
    message: grantMessage(e1.chain, l),
  })
  const header = (bytes: Uint8Array) => `Authorization: FOC-Grant ${Buffer.from(bytes).toString('base64url')}`

  writeJson('claims-vectors.json', {
    description:
      'Keysmith claim chains: presentations a gating provider must serve or refuse. Every case is the output of ' +
      `verifyPresentation() from @filoz/keysmith. ${DESCRIPTION} Byte strings are 0x-prefixed lowercase hex; ` +
      'integers too large for JSON are decimal strings.',
    domain: DOMAIN,
    types: {
      ReadGrant: typeString('ReadGrant', READ_GRANT_TYPES.ReadGrant),
      ReadRequest: typeString('ReadRequest', READ_REQUEST_TYPES.ReadRequest),
    },
    keys: Object.fromEntries(
      (Object.keys(WHO) as Who[]).map((k) => [k, { address: WHO[k].address, privateKey: KEYS[k] }])
    ),
    groupKeyId: GROUP_KEY_ID,
    groupKeyCommitment: commitment,
    chainId: CHAIN_ID.toString(),
    now: NOW,
    rootExpires: ROOT_EXPIRES,
    examples: {
      e1: { header: header(e1Bytes), pieceCid: P1.text, labels: L1 },
      e2: { header: header(e2Bytes), pieceCid: P2.text, labels: L2 },
      e3: { header: header(e3Bytes), pieceCid: P3.text, labels: L3 },
    },
    digests: [
      digest('Example 1, link 0 (ReadGrant, signed by the owner)', grantTyped(l0), l0.signature, WHO.owner.address),
      digest('Example 1, link 1 (ReadGrant, signed by A)', grantTyped(l1), l1.signature, WHO.A.address),
      digest(
        'Example 1, request (ReadRequest, signed by B)',
        {
          domain: DOMAIN,
          types: READ_REQUEST_TYPES,
          primaryType: 'ReadRequest',
          message: requestMessage(P1.cid, e1Req.expires),
        },
        e1Req.signature,
        WHO.B.address
      ),
    ],
    cases: out,
  })
}

const without = (o: Record<string, unknown>, ...keys: string[]) =>
  Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)))

function decodeRequest(bytes: Uint8Array) {
  const { request } = parts(bytes)
  return { expires: request.get(1) as number, signature: bytesToHex(request.get(2) as Uint8Array) }
}

function indexOf(haystack: Uint8Array, needle: Uint8Array): number {
  for (let i = 0; i + needle.length <= haystack.length; i++) {
    if (needle.every((b, j) => haystack[i + j] === b)) return i
  }
  throw new Error('needle not found')
}

await derivationVectors()
await claimVectors()
