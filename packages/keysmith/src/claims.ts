/**
 * Read claims: authenticated read delegation chains.
 *
 * A claim chain is the authorization half of a grant; the wrap is the key half.
 * The metadata elements, scope concepts etc are identical.
 * Its root is an EIP-712 `ReadGrant` signed by the keyspace owner's wallet,
 * with an expiry; every later link is signed by the previous link's bearer,
 * and a request by the final bearer.
 *
 * A relying party checks the claims against the labels in a piece's FEE envelope
 * to check the encryption scope matches and is legitimately delegated all the way
 * up to the keyspace root.
 *
 * In short:
 *   - Wallet signs root delegating to session key
 *   - Session key(s) can onwardly delegate narrower scopes to other session keys
 *   - Final session key signs a request for a piece to prove it holds the key delegated to
 */
import { decode, encode } from 'cborg'
import { type Address, bytesToHex, getAddress, type Hex, hexToBytes, isAddress, recoverTypedDataAddress } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  canonicalNode,
  commitment,
  DOMAIN,
  grantDescriptor,
  holdingOf,
  keyForEnvelope,
  keyspaceId,
  writeTarget,
} from './derive.ts'
import type { Grant, GrantNode } from './types.ts'
import { decodeGrant, encodeGrant, unwrapWith } from './wrap.ts'

const STRICT = {
  strict: true,
  useMaps: true,
  rejectDuplicateMapKeys: true,
  allowIndefinite: false,
  allowUndefined: false,
  allowBigInt: false,
} as const

export const MAX_CHAIN_LENGTH = 8 // Arbitrary, but need to keep it manageable including things like presentation in an HTTP header.
export const MAX_REQUEST_LIFETIME = 300 // 5 minutes replay window
const SKEW = 60 // Tolerance for clock skew, in seconds

/**
 * EIP-712 types for every link and for a request. The domain is Keysmith's
 * {@link DOMAIN}. A link's signature covers the fields it inherits from the
 * root, so a link cannot be moved under a root that differs in any of them.
 * Links name their parent by its bearer's address, not by hash, so a parent
 * can be re-issued without invalidating the links beneath it.
 */
export const READ_GRANT_TYPES = {
  ReadGrant: [
    { name: 'v', type: 'uint8' },
    { name: 'node', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'keyspace', type: 'bytes16' },
    { name: 'bearer', type: 'address' },
    { name: 'maxDepth', type: 'uint8' },
    { name: 'chainId', type: 'uint256' },
    { name: 'keyCommitment', type: 'bytes16' },
    { name: 'keyspaceCommitment', type: 'bytes16' },
    { name: 'expires', type: 'uint64' },
  ],
} as const
export const READ_REQUEST_TYPES = {
  ReadRequest: [
    { name: 'chainId', type: 'uint256' },
    { name: 'pieceCid', type: 'bytes' },
    { name: 'expires', type: 'uint64' },
  ],
} as const

/** One link: what its bearer may read, and how much further they may delegate. */
export interface Claim {
  node: string // Canonical grant node: 'keyspace', 'scope:<path>' or 'piece:<salt>'
  bearer: Address // Who may present this link, and sign the next one
  maxDepth: number // Links the bearer may add below this one
  keyCommitment: Hex // First 16 bytes of the node key's commitment: what the bearer checks after unwrapping
  signature: Hex // EIP-712: the owner's on the root, the previous bearer's on every later link
  pieceCid?: Uint8Array // Where a piece link's piece lives. A locator only: not signed, never decided on
}

/** A chain, root first, with the fields every link inherits from the root. */
export interface ClaimChain {
  owner: Address // The keyspace owner, whose wallet signs the root
  keyspace: Hex // Spelled as in `foc/ks`
  chainId: bigint // The network the claims are for, so a header cannot be replayed on another
  keyspaceCommitment: Hex // `foc/kc` without its `v1.` prefix, so a bearer can record it on new datasets
  expires: number // Unix seconds. The whole chain stops working then
  links: Claim[] // Root first
}

/** A request for one piece, from whichever provider holds it, signed by the chain's final bearer. */
export interface ReadRequest {
  pieceCid: Uint8Array // The piece asked for, as a binary CID
  expires: number // Unix seconds; at most MAX_REQUEST_LIFETIME ahead
  signature: Hex // The final bearer's EIP-712 ReadRequest signature
}

/** The labels a provider read from a piece's FEE envelope. */
export interface PieceLabels {
  'foc/own'?: string // The keyspace owner; a piece without it is not gated
  'foc/ks': string // The keyspace
  'foc/scope'?: string // The scope path, if any
  'foc/salt': string // Names the piece for a piece link
}

/** Anything that signs EIP-712 typed data: a viem account or wallet client. */
export interface ClaimSigner {
  signTypedData: (args: any) => Promise<Hex>
}

/** A key's commitment as the 16 bytes a claim carries. */
export const keyCommitmentOf = (key: Uint8Array): Hex => `0x${commitment(key).slice('v1.'.length)}`

function depth(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > 255) throw new Error(`maxDepth must be 0 to 255, got ${value}`)
  return value
}

function unixSeconds(value: number, what: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${what} must be unix seconds, got ${value}`)
  return value
}

const grantMessage = (chain: ClaimChain, link: Omit<Claim, 'signature'>) => ({
  v: 1,
  node: link.node,
  owner: chain.owner,
  keyspace: chain.keyspace,
  bearer: link.bearer,
  maxDepth: link.maxDepth,
  chainId: chain.chainId,
  keyCommitment: link.keyCommitment,
  keyspaceCommitment: chain.keyspaceCommitment,
  expires: BigInt(chain.expires),
})

const signLink = (signer: ClaimSigner, chain: ClaimChain, link: Omit<Claim, 'signature'>) =>
  signer.signTypedData({
    domain: DOMAIN,
    types: READ_GRANT_TYPES,
    primaryType: 'ReadGrant',
    message: grantMessage(chain, link),
  })

const recoverIssuer = (chain: ClaimChain, link: Claim) =>
  recoverTypedDataAddress({
    domain: DOMAIN,
    types: READ_GRANT_TYPES,
    primaryType: 'ReadGrant',
    message: grantMessage(chain, link),
    signature: link.signature,
  })

/**
 * The key for `node`, derived from a key the caller holds for `heldNode`, so a
 * claim can only ever commit to a key that really sits below its issuer's.
 * A piece node needs the piece's FEE metadata, which must name that piece.
 */
function keyBelow(
  heldKey: Uint8Array,
  heldNode: string,
  node: string,
  ref: { owner: Address; keyspace: Hex },
  piece: PieceLabels | undefined
): Uint8Array {
  if (node.startsWith('piece:')) {
    if (!piece) throw new Error(`${node} names a piece: deriving its key needs the piece's labels`)
    if (canonicalNode(`piece:${piece['foc/salt']}`) !== node || keyspaceId(piece['foc/ks']) !== ref.keyspace) {
      throw new Error(`The piece labels given are not for ${node} in keyspace ${ref.keyspace}`)
    }
    return keyForEnvelope(heldKey, { 'foc/v': 1, ...piece }, holdingOf({ node: heldNode }))
  }
  const scope = node === 'keyspace' ? undefined : node.slice('scope:'.length)
  return writeTarget(grantDescriptor(ref, heldNode as GrantNode), heldKey, scope).key.slice()
}

/**
 * The root of a chain, signed by the owner's wallet: one EIP-712 prompt.
 * Derives the bearer's node key from the keyspace key, so the root cannot
 * commit to a wrong one, and hands it back to wrap for the bearer.
 * When the bearer is a session key, set `expires` to the session key's expiry.
 *
 * @throws If `signer` is not the owner.
 */
export async function rootClaim(
  owner: ClaimSigner,
  input: {
    owner: Address
    keyspace: Hex
    chainId: bigint
    kk: Uint8Array // The keyspace key, from keyspaceKeys()
    node: string
    bearer: Address
    maxDepth: number
    expires: number // Unix seconds. Required: providers check no revocation, so this is what ends the claim
    piece?: PieceLabels // For a piece node: the piece's envelope labels
  }
): Promise<{ chain: ClaimChain; nodeKey: Uint8Array }> {
  if (!isAddress(input.owner) || !isAddress(input.bearer)) throw new Error('owner and bearer must be addresses')
  const ref = { owner: getAddress(input.owner), keyspace: keyspaceId(input.keyspace) }
  const node = canonicalNode(input.node)
  const nodeKey = keyBelow(input.kk, 'keyspace', node, ref, input.piece)
  const link = {
    node,
    bearer: getAddress(input.bearer),
    maxDepth: depth(input.maxDepth),
    keyCommitment: keyCommitmentOf(nodeKey),
  }
  const chain: ClaimChain = {
    ...ref,
    chainId: input.chainId,
    keyspaceCommitment: keyCommitmentOf(input.kk),
    expires: unixSeconds(input.expires, 'expires'),
    links: [],
  }
  const signature = await signLink(owner, chain, link)
  const root = { ...link, signature }
  if ((await recoverIssuer(chain, root)) !== chain.owner) throw new Error(`The root must be signed by ${chain.owner}`)
  return { chain: { ...chain, links: [root] }, nodeKey }
}

/**
 * Delegate: the chain's final bearer signs a narrower link for `bearer`.
 * Takes the key the bearer holds for its own link, checks it against that
 * link's commitment, and derives the child's key from it, so an honest
 * delegate cannot commit to a wrong key. Hands the child key back to wrap.
 * A piece link needs the piece's labels, to check the parent's node reaches it.
 */
export async function delegateClaim(
  signer: ClaimSigner,
  chain: ClaimChain,
  input: {
    parentKey: Uint8Array // The key for the final link's node, as openDelivery() returned it
    node: string
    bearer: Address
    maxDepth: number
    pieceCid?: Uint8Array
    piece?: PieceLabels
  }
): Promise<{ chain: ClaimChain; nodeKey: Uint8Array }> {
  const parent = chain.links.at(-1)
  if (!parent) throw new Error('A chain has at least one link')
  if (chain.links.length >= MAX_CHAIN_LENGTH) throw new Error(`A chain has at most ${MAX_CHAIN_LENGTH} links`)
  if (keyCommitmentOf(input.parentKey) !== parent.keyCommitment) {
    throw new Error(`parentKey is not the key link ${chain.links.length - 1} commits to`)
  }
  const node = canonicalNode(input.node)
  const step = { node, bearer: getAddress(input.bearer), maxDepth: depth(input.maxDepth) }
  checkStep(parent, step, input.piece, chain.links.length)
  const nodeKey = keyBelow(input.parentKey, parent.node, node, chain, input.piece)
  const link = {
    ...step,
    keyCommitment: keyCommitmentOf(nodeKey),
    ...(input.pieceCid ? { pieceCid: input.pieceCid } : {}),
  }
  const signature = await signLink(signer, chain, link)
  return { chain: { ...chain, links: [...chain.links, { ...link, signature }] }, nodeKey }
}

/** Sign a request for one piece, as the chain's final bearer. Any provider holding it may serve it. */
export async function signRequest(
  signer: ClaimSigner,
  chain: ClaimChain,
  input: { pieceCid: Uint8Array; expires: number }
): Promise<ReadRequest> {
  const signature = await signer.signTypedData({
    domain: DOMAIN,
    types: READ_REQUEST_TYPES,
    primaryType: 'ReadRequest',
    message: {
      chainId: chain.chainId,
      pieceCid: bytesToHex(input.pieceCid),
      expires: BigInt(input.expires),
    },
  })
  return { ...input, signature }
}

// ── coverage ─────────────────────────────────────────────────────────────

const within = (parent: string, child: string) => child === parent || child.startsWith(`${parent}/`)

/** Whether `node` reaches the piece these labels describe. */
export function reaches(node: string, piece: PieceLabels): boolean {
  if (node === 'keyspace') return true
  if (node.startsWith('piece:')) return node === `piece:${piece['foc/salt']}`
  return piece['foc/scope'] != null && within(node, `scope:${piece['foc/scope']}`)
}

/** Check one step down a chain: the child no wider than its parent, and within its depth. */
function checkStep(
  parent: Pick<Claim, 'node' | 'maxDepth'>,
  child: Pick<Claim, 'node' | 'maxDepth'>,
  piece: PieceLabels | undefined,
  index: number
): void {
  if (parent.maxDepth < 1 || child.maxDepth > parent.maxDepth - 1) {
    throw new Error(`Link ${index} exceeds link ${index - 1}'s maxDepth`)
  }
  let narrower: boolean
  if (parent.node === 'keyspace') narrower = true
  else if (child.node.startsWith('piece:')) {
    if (!piece) throw new Error(`Link ${index} names a piece: checking it needs the piece's labels`)
    narrower = child.node === `piece:${piece['foc/salt']}` && reaches(parent.node, piece)
  } else narrower = !parent.node.startsWith('piece:') && child.node !== 'keyspace' && within(parent.node, child.node)
  if (!narrower) throw new Error(`Link ${index} widens ${parent.node} to ${child.node}`)
}

/** The final claim of a verified chain. */
export interface VerifiedClaim {
  owner: Address
  keyspace: Hex
  chainId: bigint
  keyspaceCommitment: Hex
  expires: number
  node: string
  bearer: Address
  keyCommitment: Hex
}

/**
 * Check a chain with nothing but the chain: the root signed by the owner and
 * unexpired, every later link signed by the previous bearer and no wider than
 * it. Pass `piece` when a link names a piece.
 *
 * @throws With the reason the chain is refused.
 */
export async function verifyChain(
  chain: ClaimChain,
  options: { now?: number; piece?: PieceLabels } = {}
): Promise<VerifiedClaim> {
  const { links } = chain
  if (links.length < 1 || links.length > MAX_CHAIN_LENGTH) throw new Error(`A chain has 1 to ${MAX_CHAIN_LENGTH} links`)
  const now = options.now ?? Math.floor(Date.now() / 1000)
  if (chain.expires < now - SKEW)
    throw new Error(`The chain expired at ${new Date(chain.expires * 1000).toISOString()}`)
  const root = links[0] as Claim
  if (root.node === 'keyspace' && root.keyCommitment !== chain.keyspaceCommitment) {
    throw new Error('A keyspace root must carry the keyspace commitment')
  }
  if ((await recoverIssuer(chain, root)) !== chain.owner) throw new Error('The root is not signed by the owner')
  for (const [i, link] of links.entries()) {
    if (i === 0) continue
    const parent = links[i - 1] as Claim
    if ((await recoverIssuer(chain, link)) !== parent.bearer) {
      throw new Error(`Link ${i} is not signed by link ${i - 1}'s bearer`)
    }
    checkStep(parent, link, options.piece, i)
  }
  const last = links.at(-1) as Claim
  return {
    owner: chain.owner,
    keyspace: chain.keyspace,
    chainId: chain.chainId,
    keyspaceCommitment: chain.keyspaceCommitment,
    expires: chain.expires,
    node: last.node,
    bearer: last.bearer,
    keyCommitment: last.keyCommitment,
  }
}

/**
 * What a gating provider checks on a request, with only the header and the
 * piece's labels: the chain, the request's piece, lifetime and signer, and that the final node reaches the piece. A piece without
 * `foc/own` is not gated.
 *
 * @throws With the reason the request is refused.
 */
export async function verifyPresentation(
  bytes: Uint8Array,
  options: {
    pieceCid: Uint8Array
    piece: PieceLabels
    chainId: bigint // The provider's chain; a header for another network is refused
    now?: number // Unix seconds; defaults to now
  }
): Promise<VerifiedClaim> {
  const { chain, request } = decodePresentation(bytes)
  const now = options.now ?? Math.floor(Date.now() / 1000)
  const claim = await verifyChain(chain, { now, piece: options.piece })
  if (chain.chainId !== options.chainId) throw new Error('The chain names another network')
  if (bytesToHex(request.pieceCid) !== bytesToHex(options.pieceCid)) throw new Error('The request names another piece')
  if (request.expires < now - SKEW || request.expires > now + MAX_REQUEST_LIFETIME + SKEW) {
    throw new Error('The request has expired, or is valid for too long')
  }
  const signer = await recoverTypedDataAddress({
    domain: DOMAIN,
    types: READ_REQUEST_TYPES,
    primaryType: 'ReadRequest',
    message: {
      chainId: chain.chainId,
      pieceCid: bytesToHex(request.pieceCid),
      expires: BigInt(request.expires),
    },
    signature: request.signature,
  })
  if (signer !== claim.bearer) throw new Error('The request is not signed by the final bearer')
  const owner = options.piece['foc/own']
  if (owner && (owner.toLowerCase() !== claim.owner.toLowerCase() || options.piece['foc/ks'] !== claim.keyspace)) {
    throw new Error('The piece belongs to another owner or keyspace')
  }
  if (owner && !reaches(claim.node, options.piece)) {
    throw new Error(`${claim.node} does not reach this piece (scope ${options.piece['foc/scope'] ?? '(none)'})`)
  }
  return claim
}

/**
 * Open a delivery as its final bearer: verify the chain, unwrap the key, and
 * check it against the commitment in its claim, which the owner (or the
 * delegate above) signed. The keyspace commitment comes back too, for a bearer
 * that writes the keyspace's first datasets.
 *
 * @throws With the reason the delivery is refused.
 */
export async function openDelivery(
  privateKey: Hex,
  bytes: Uint8Array,
  options: { now?: number; piece?: PieceLabels } = {}
): Promise<{ chain: ClaimChain; grant: Grant; claim: VerifiedClaim; key: Uint8Array }> {
  const { chain, grant } = decodeDelivery(bytes)
  const claim = await verifyChain(chain, options)
  if (claim.bearer !== privateKeyToAccount(privateKey).address) throw new Error('This delivery is for another bearer')
  assertGrantNamesClaim(grant, claim)
  const key = await unwrapWith(privateKey, grant)
  if (keyCommitmentOf(key) !== claim.keyCommitment) {
    throw new Error('The delivered key does not match the commitment in its claim')
  }
  return { chain, grant, claim, key }
}

/** A delivery's grant must name what its final link names: the wrap's descriptor and the claim are one node. */
function assertGrantNamesClaim(grant: Grant, claim: { owner: Address; keyspace: Hex; node: string }): void {
  if (
    getAddress(grant.owner) !== claim.owner ||
    grant.keyspace.toLowerCase() !== claim.keyspace ||
    canonicalNode(grant.node) !== claim.node
  ) {
    throw new Error("The delivery's key is for another node than its claim")
  }
}

// ── CBOR ─────────────────────────────────────────────────────────────────

// Link fields: 0 v · 1 node · 2 owner · 3 keyspace · 4 bearer · 5 maxDepth · 6 chainId · 7 keyCommitment
// · 8 signature · 9 pieceCid (locator) · 10 keyspaceCommitment · 11 expires. 2, 3, 6, 10 and 11 are on the root only.
const ROOT_ONLY = [2, 3, 6, 10, 11]

function encodeChainLinks(chain: ClaimChain): Map<number, unknown>[] {
  return chain.links.map((link, i) => {
    const fields = new Map<number, unknown>([
      [0, 1],
      [1, link.node],
      [4, hexToBytes(link.bearer)],
      [5, link.maxDepth],
      [7, hexToBytes(link.keyCommitment)],
      [8, hexToBytes(link.signature)],
    ])
    if (i === 0) {
      fields.set(2, hexToBytes(chain.owner))
      fields.set(3, hexToBytes(chain.keyspace))
      fields.set(6, Number(chain.chainId))
      fields.set(10, hexToBytes(chain.keyspaceCommitment))
      fields.set(11, chain.expires)
    }
    if (link.pieceCid) fields.set(9, link.pieceCid)
    return new Map([...fields].sort(([a], [b]) => a - b))
  })
}

function bytesField(map: Map<unknown, unknown>, key: number, length: number, what: string): Hex {
  const value = map.get(key)
  if (!(value instanceof Uint8Array) || value.length !== length) throw new Error(`${what} must be ${length} bytes`)
  return bytesToHex(value)
}

function uintField(map: Map<unknown, unknown>, key: number, what: string): number {
  const value = map.get(key)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${what} must be an unsigned integer`)
  }
  return value
}

function decodeChainLinks(value: unknown): ClaimChain {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_CHAIN_LENGTH) {
    throw new Error(`A chain is an array of 1 to ${MAX_CHAIN_LENGTH} links`)
  }
  const maps = value.map((link, i) => {
    if (!(link instanceof Map)) throw new Error(`Link ${i} is not a map`)
    for (const key of link.keys()) {
      if (typeof key !== 'number' || key < 0 || key > 11)
        throw new Error(`Link ${i} has an unknown field ${String(key)}`)
      if (i > 0 && ROOT_ONLY.includes(key)) throw new Error(`Link ${i} repeats a root-only field`)
    }
    if (link.get(0) !== 1) throw new Error(`Link ${i} has an unsupported version`)
    return link as Map<number, unknown>
  })
  const root = maps[0] as Map<number, unknown>
  return {
    owner: getAddress(bytesField(root, 2, 20, 'owner')),
    keyspace: bytesField(root, 3, 16, 'keyspace'),
    chainId: BigInt(uintField(root, 6, 'The root chain id')),
    keyspaceCommitment: bytesField(root, 10, 16, 'keyspaceCommitment'),
    expires: uintField(root, 11, 'The root expiry'),
    links: maps.map((link, i) => {
      const node = link.get(1)
      if (typeof node !== 'string' || canonicalNode(node) !== node)
        throw new Error(`Link ${i} has a non-canonical node`)
      const pieceCid = link.get(9)
      if (pieceCid !== undefined && !(pieceCid instanceof Uint8Array))
        throw new Error(`Link ${i}'s pieceCid must be bytes`)
      return {
        node,
        bearer: getAddress(bytesField(link, 4, 20, `Link ${i}'s bearer`)),
        maxDepth: depth(uintField(link, 5, `Link ${i}'s maxDepth`)),
        keyCommitment: bytesField(link, 7, 16, `Link ${i}'s keyCommitment`),
        signature: bytesField(link, 8, 65, `Link ${i}'s signature`),
        ...(pieceCid ? { pieceCid } : {}),
      }
    }),
  }
}

function decodeArray(bytes: Uint8Array, what: string): unknown[] {
  let value: unknown
  try {
    value = decode(bytes, STRICT)
  } catch (cause) {
    throw new Error(`Not a ${what}: the bytes are not canonical CBOR`, { cause })
  }
  if (!Array.isArray(value) || value.length !== 3 || value[0] !== 1) throw new Error(`Not a version 1 ${what}`)
  return value
}

/**
 * A delivery: sent once to a new bearer, never to a provider. Carries the v1 grant that wraps the key.
 * The grant must name the chain's final node, owner and keyspace; that the wrapped key matches the
 * link's commitment is checked by `openDelivery`, which holds the private key to unwrap it.
 */
export function encodeDelivery(chain: ClaimChain, grant: Grant): Uint8Array {
  const last = chain.links.at(-1)
  if (!last) throw new Error('A chain has at least one link')
  assertGrantNamesClaim(grant, { owner: chain.owner, keyspace: chain.keyspace, node: last.node })
  return encode([1, encodeChainLinks(chain), encodeGrant(grant)])
}

export function decodeDelivery(bytes: Uint8Array): { chain: ClaimChain; grant: Grant } {
  const [, chain, grant] = decodeArray(bytes, 'delivery')
  if (!(grant instanceof Uint8Array)) throw new Error("A delivery's grant must be bytes")
  return { chain: decodeChainLinks(chain), grant: decodeGrant(grant) }
}

/** A presentation: sent to a provider with each gated request, as `Authorization: FOC-Grant <base64url>`. */
export function encodePresentation(chain: ClaimChain, request: ReadRequest): Uint8Array {
  const req = new Map<number, unknown>([
    [0, request.pieceCid],
    [1, request.expires],
    [2, hexToBytes(request.signature)],
  ])
  return encode([1, encodeChainLinks(chain), req])
}

export function decodePresentation(bytes: Uint8Array): { chain: ClaimChain; request: ReadRequest } {
  const [, chain, req] = decodeArray(bytes, 'presentation')
  if (!(req instanceof Map)) throw new Error('A request is a map')
  const pieceCid = req.get(0)
  if (!(pieceCid instanceof Uint8Array)) throw new Error('A request needs a piece CID')
  return {
    chain: decodeChainLinks(chain),
    request: {
      pieceCid,
      expires: uintField(req, 1, "The request's expiry"),
      signature: bytesField(req as Map<number, unknown>, 2, 65, "The request's signature"),
    },
  }
}
