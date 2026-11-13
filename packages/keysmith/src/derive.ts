/**
 * Derivation: one wallet signature per group key, then HKDF all the way down.
 *
 * ```text
 * sig = signTypedData(KeyspaceKey{owner, keyspace})
 * KK  = HKDF(r‖s, "foc/acl/keyspace/v1")      the group key: the root of everything below
 *       (salt = Argon2id(password, hash(sig message)) if a password is given)
 * RK  = HKDF(KK,  "foc/acl/role/v1"‖group)     a group's key
 * PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
 * ```
 *
 * The wire names (`KeyspaceKey`, `keyspace`, `foc/ks`, `foc/scope`, `scope:<path>`)
 * keep their original spelling: they are signed or hashed, so renaming them would
 * orphan existing keys. In the API, a "keyspace" is a group key (its id is the group key id)
 * and a "scope" is a group.
 *
 * @module
 */
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { Address, Hex } from 'viem'
import { bytesToHex, hashTypedData, hexToBytes, recoverAddress } from 'viem'
import type {
  DerivedGroupKey,
  DeriveGroupKeyOptions,
  GrantDescriptor,
  GrantNode,
  GroupKeyMessage,
  GroupKeyRef,
  Holding,
  PieceMetadata,
  TypedDataSigner,
  WriteTarget,
} from './types.ts'

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
/** Half the secp256k1 group order; an `s` above this is the malleable form. */
const HALF_N = N / 2n

/**
 * Sparse EIP-712 message block to be signed by the root wallet.
 * Note: Deliberately carries neither `chainId` nor `verifyingContract`
 * as out primary concern is long-term access to the stored pieces,
 * no matter what chain or contract they were initially associated with.
 *
 * **Never add a field here, and never zero-fill one.** The separator is
 * hashed over the fields that are present, so `{name, version}` and
 * `{name, version, chainId: 0, verifyingContract: 0x00…}` are different
 * domains, different signatures, and different keys. Any change orphans
 * every key ever derived, with no migration path.
 */
export const DOMAIN = { name: 'FOC Encryption', version: '1' } as const

/**
 * Parameters of the typed data signature that roots a group key.
 * `KeyspaceKey` and `keyspace` are wire names: do not rename.
 */
export const GROUP_KEY_TYPES = {
  KeyspaceKey: [
    { name: 'owner', type: 'address' },
    { name: 'keyspace', type: 'bytes16' },
  ],
} as const

const INFO = {
  groupKey: 'foc/acl/keyspace/v1',
  group: 'foc/acl/role/v1',
  piece: 'foc/acl/piece/v1',
  commitment: 'foc/kc/v1',
} as const

/** The FWSS data-set metadata key the commitment is written to. */
export const COMMITMENT_KEY = 'foc/kc'
/** The FWSS data-set metadata key naming the group key, so the chain alone can list them. */
export const GROUP_KEY_ID_KEY = 'foc/ks'

const derive = (ikm: Uint8Array, info: string, length = 32, salt?: Uint8Array): Uint8Array =>
  hkdf(sha256, ikm, salt, utf8ToBytes(info), length)

/**
 * Argon2id cost for a group key password: RFC 9106's second recommended
 * option (64 MiB, 3 passes), with one lane since JS runs single-threaded.
 * The commitment is public, so a phished signature lets an attacker test
 * guesses offline; this is what makes each one expensive.
 *
 * **Never change these**, the version included: any change orphans every
 * password-protected group key.
 */
const PASSWORD_KDF = { t: 3, m: 65536, p: 1, dkLen: 32, version: 0x13 } as const

/**
 * A password in the form it is stretched from: UTF-8 of its Unicode NFC form.
 *
 * @throws If it is empty or not well-formed Unicode.
 */
function passwordBytes(password: unknown): Uint8Array {
  const pw = text(password, 'A password')
  if (/\p{Cs}/u.test(pw) || pw.length === 0) {
    throw new Error('A password must be non-empty, well-formed Unicode (no lone surrogates)')
  }
  return utf8ToBytes(pw.normalize('NFC'))
}

/**
 * The HKDF salt for a password-protected group key: Argon2id over the
 * password, salted with the signed message's hash, so it is unique to the
 * owner and group key id and nothing can be precomputed across them.
 */
const passwordSalt = (password: Uint8Array, messageHash: Hex): Promise<Uint8Array> =>
  argon2idAsync(password, hexToBytes(messageHash), PASSWORD_KDF)

function randomHex(length: number): Hex {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** A fresh per-piece salt. Public: it only has to travel with the piece. */
export const newSalt = (): Hex => randomHex(16)

/**
 * A fresh group key id: 16 random bytes. Public, not a key.
 * Must be unique to a wallet, so that a grant for one group key cannot be
 * relabelled as another.
 */
export const newGroupKeyId = (): Hex => randomHex(16)

/**
 * Canonical form of a group key id: 16 bytes of hex, lowercase, prefixed with `0x`.
 *
 * @throws If it is not 16 bytes of hex.
 */
export function groupKeyId(id: string): Hex {
  const lower = text(id, 'A group key id').toLowerCase()
  if (!/^0x[0-9a-f]{32}$/.test(lower)) {
    throw new Error(`A group key id is 16 bytes of hex, got ${JSON.stringify(id)}`)
  }
  return lower as Hex
}

export function groupKeyMessage(ref: GroupKeyRef): GroupKeyMessage {
  return { owner: ref.owner, keyspace: groupKeyId(ref.groupKeyId) }
}

/**
 * Sign for one group key and derive its key.
 *
 * The signature is the root secret, and it never leaves this function: the
 * caller gets the group key and the public commitment, and has nothing
 * else to guard.
 *
 * For a new group key this signs twice and compares, which catches a
 * non-deterministic signer before any data depends on it, at the cost of a second
 * wallet prompt. For an existing one, pass the commitment its dataset records
 * (`foc/kc`): it signs once, and the commitment catches the same faults. See
 * {@link DeriveGroupKeyOptions}.
 *
 * With `options.password`, the key also depends on that password, so a
 * phished signature alone no longer yields it. Lose the password and the
 * group key is lost: nothing else can recover it. Only a recorded commitment
 * can tell a wrong password from a right one, so reopen a protected group key
 * with both `password` and `commitment`, and have the user confirm the
 * password when creating one: a typo there silently roots the group key under
 * the typo.
 *
 * Only the owner's own wallet can sign: a key signed by any other wallet,
 * a session key included, is not the key the owner's wallet derives, and
 * nothing downstream could tell. Delegates receive a grant instead.
 *
 * The result carries the group key descriptor, so an owner writes the same way
 * a delegate does — `writeTarget(descriptor, kk, group)` — with the group key
 * taken from what was actually signed.
 *
 * @throws Before any signing, if `options.password` is empty or not well-formed
 * Unicode, or `options.commitment` is not a commitment in format v1. After signing,
 * if the signer is not deterministic, is not the owner, does not produce an ECDSA
 * signature, or derives a key that does not match `options.commitment` (with a
 * password, most often a wrong password).
 */
export async function deriveGroupKey(
  signer: TypedDataSigner,
  ref: GroupKeyRef,
  options: DeriveGroupKeyOptions = {}
): Promise<DerivedGroupKey> {
  const message = groupKeyMessage(ref)
  // Refuse bad options before the wallet prompts, not after
  const password = options.password == null ? undefined : passwordBytes(options.password)
  if (options.commitment != null) commitmentFormat(options.commitment)
  const args = { domain: DOMAIN, types: GROUP_KEY_TYPES, primaryType: 'KeyspaceKey' as const, message }
  const first = await signer.signTypedData(args)
  if (options.verifySigner ?? options.commitment == null) {
    const second = await signer.signTypedData(args)
    if (first !== second) {
      throw new Error(
        'Signer is not deterministic (RFC 6979 expected), so it cannot root a group key. ' +
          'Signing the same message twice produced different signatures.'
      )
    }
  }
  const rs = lowSrs(first)
  const hash = hashTypedData(args)
  await assertSignedBy(message.owner, hash, rs)
  const salt = password == null ? undefined : await passwordSalt(password, hash)
  const kk = derive(rs, INFO.groupKey, 32, salt)
  if (options.commitment != null && !matchesCommitment(kk, options.commitment)) {
    const cause =
      password == null ? 'the group key may need a password' : 'the password is wrong, or this group key has none'
    throw new Error(
      `This key does not match the recorded commitment: ${cause}; ` +
        'or the signer is not deterministic, or the commitment belongs to another group key.'
    )
  }
  return { kk, commitment: commitment(kk), descriptor: grantDescriptor(ref, 'keyspace') }
}

/**
 * `v` is dropped, and `s` normalised, before anything is derived, so recovery
 * tries both parities: the owner's address must be one of the two candidates.
 */
async function assertSignedBy(owner: Address, hash: Hex, rs: Uint8Array): Promise<void> {
  const r = bytesToHex(rs.subarray(0, 32))
  const s = bytesToHex(rs.subarray(32, 64))
  for (const yParity of [0, 1]) {
    if ((await recoverAddress({ hash, signature: { r, s, yParity } })).toLowerCase() === owner.toLowerCase()) {
      return
    }
  }
  throw new Error(
    `This signature is not from the group key owner ${owner}. Only the owner's wallet can sign for its group key; ` +
      'a delegate, such as a session key, receives a grant instead.'
  )
}

/**
 * A non-secret commitment to the group key, for FWSS data-set metadata:
 * `v1.<32 hex digits>`, where `v1` is the format of the value.
 */
export const commitment = (kk: Uint8Array): string => `v1.${bytesToHex(derive(kk, INFO.commitment, 16)).slice(2)}`

function commitmentFormat(recorded: string): string {
  if (!/^v1\.[0-9a-f]{32}$/.test(recorded)) {
    throw new Error(`Not a group key commitment in format v1: ${JSON.stringify(recorded)}`)
  }
  return recorded
}

/**
 * Verifies that `kk` is the key you expect: the right root wallet and the right
 * group key. Check this before using any key received in a grant.
 *
 * @throws If the recorded value is not a commitment in this format.
 */
export function matchesCommitment(kk: Uint8Array, recorded: string): boolean {
  return commitment(kk) === commitmentFormat(recorded)
}

/**
 * Canonicalize signature:`r‖s` with `s` normalised to the low half, and `v` dropped.
 *
 * Only a plain secp256k1 ECDSA signature is accepted. A contract account or
 * smart wallet answers `signTypedData` with an ABI-encoded blob whose leading
 * bytes are structure rather than secret; deriving from those would mint a
 * key an attacker could enumerate, so anything that is not 64 or 65 bytes with
 * `r, s ∈ [1, n−1]` is refused.
 */
export function lowSrs(signature: Hex): Uint8Array {
  const raw = hexToBytes(signature)
  if (raw.length !== 64 && raw.length !== 65) {
    throw new Error(
      `Expected a 64- or 65-byte ECDSA signature, got ${raw.length} bytes. ` +
        'Contract accounts and smart wallets return other encodings and cannot root a group key.'
    )
  }
  const r = BigInt(bytesToHex(raw.subarray(0, 32)))
  const s = BigInt(bytesToHex(raw.subarray(32, 64)))
  if (r < 1n || r >= N || s < 1n || s >= N) {
    throw new Error('Signature r and s must lie in [1, n−1]; this is not a secp256k1 ECDSA signature.')
  }
  const lowS = s > HALF_N ? N - s : s
  const out = new Uint8Array(64)
  out.set(raw.subarray(0, 32), 0)
  out.set(hexToBytes(`0x${lowS.toString(16).padStart(64, '0')}`), 32)
  return out
}

/**
 * The key for a group. Groups form a tree, and a group's key is derived
 * from its parent's, so holding a group also opens every group beneath it.
 */
export const keyForGroup = (kk: Uint8Array, group: string): Uint8Array => walk(kk, groupPath(group).split('/'))

const walk = (key: Uint8Array, names: string[]): Uint8Array =>
  names.reduce((parent, name) => derive(parent, `${INFO.group}${name}`), key)

/**
 * Canonicalize group name in the form it is derived from: Unicode NFC,
 * non-empty, no leading or trailing whitespace, and no `/` (which would
 * indicate a *path*). Case is significant.
 *
 * @throws If the name is empty, padded with whitespace, contains `/`, or is not well-formed Unicode.
 * The empty/padded/`/` error says "scope", the wire term: claims-vectors.json pins its text.
 */
export function groupName(name: string): string {
  // Lone surrogates risk two different names deriving the same key, so refuse them.
  if (/\p{Cs}/u.test(name)) {
    throw new Error(`A group name must be well-formed Unicode (no lone surrogates), got ${JSON.stringify(name)}`)
  }
  const normalised = name.normalize('NFC')
  if (normalised.length === 0 || normalised.trim() !== normalised || normalised.includes('/')) {
    throw new Error(
      `A scope name must be non-empty, with no leading or trailing whitespace and no "/", got ${JSON.stringify(name)}`
    )
  }
  return normalised
}

/** Canonicalize group path: canonical names joined by `/`, top group first. */
export const groupPath = (path: string): string => text(path, 'A group path').split('/').map(groupName).join('/')

/**
 * A grant node in canonical form (wire spellings): `keyspace`, `scope:` plus a canonical group
 * path, or `piece:` plus a piece's salt in lowercase hex.
 */
export function canonicalNode(node: string): string {
  if (text(node, 'A grant node') === 'keyspace') {
    return 'keyspace'
  }
  if (node.startsWith('scope:')) {
    return `scope:${groupPath(node.slice('scope:'.length))}`
  }
  if (node.startsWith('piece:')) {
    const salt = saltOf(node.slice('piece:'.length))
    if (salt.length !== 2 + 2 * 16) throw new Error(`A piece node names a 16-byte salt, got ${JSON.stringify(node)}`)
    return `piece:${salt}`
  }
  throw new Error(`Unrecognised grant node: ${node}`)
}

/**
 * The grant node for one piece, from its envelope metadata: `piece:<salt>`.
 *
 * A piece grant is bound to the salt, not the CID: the salt is what the key is
 * derived from, it has one canonical spelling, and `keyForEnvelope` checks it
 * against the envelope at no cost. Carry the piece's CID beside the grant to
 * tell the recipient where to fetch it.
 */
export const pieceNode = (metadata: Pick<PieceMetadata, 'foc/salt'>): GrantNode =>
  `piece:${saltOf(metadata['foc/salt'])}`

/** A salt in the form it is derived from and compared in: hex bytes, lowercase. */
function saltOf(salt: string): Hex {
  const lower = text(salt, 'A piece salt').toLowerCase()
  if (!/^0x([0-9a-f]{2})+$/.test(lower)) {
    throw new Error(`A piece salt is hex bytes, got ${JSON.stringify(salt)}`)
  }
  return lower as Hex
}

/** The key for one piece. Never reused: FEE requires a fresh key per object. */
export const pieceKey = (node: Uint8Array, salt: Hex): Uint8Array => derive(node, `${INFO.piece}${saltOf(salt)}`)

/**
 * Untrusted input arrives as parsed JSON, so check a field is a string before
 * treating it as one, and say which field it was.
 */
export function text(value: unknown, what: string): string {
  if (typeof value !== 'string') {
    throw new Error(`${what} must be a string, got ${value === null ? 'null' : typeof value}`)
  }
  return value
}

/**
 * Piece FEE envelope metadata entries.
 *
 * Everything a reader needs travels with the piece, so a copy opens wherever
 * replication or repair puts it.
 */
export function pieceMetadata(ref: GroupKeyRef, options: { salt: Hex; group?: string }): PieceMetadata {
  // A stale `scope` would be dropped silently, leaving a piece nobody can open.
  if ('scope' in options) throw new Error('pieceMetadata takes `group`, not `scope`')
  const salt = saltOf(options.salt)
  if (salt.length !== 2 + 2 * 16) {
    throw new Error(`A piece salt is 16 random bytes, from newSalt(); got ${(salt.length - 2) / 2}`)
  }
  return {
    'foc/v': 1,
    'foc/own': ref.owner.toLowerCase() as Address,
    'foc/ks': groupKeyId(ref.groupKeyId),
    ...(options.group == null ? {} : { 'foc/scope': groupPath(options.group) }),
    'foc/salt': salt,
  }
}

/**
 * The descriptor naming what a grant unlocks, ready for `wrapTo()`.
 *
 * `node` is a wire string: `'keyspace'` for the group key, `'scope:<path>'` for a group,
 * `'piece:<salt>'` for one piece. `owner` and `groupKeyId` are signed as `owner` and `keyspace`.
 *
 * Build descriptors with `grantDescriptor()` rather than filling the
 * structure by hand: the descriptor is authenticated as the grant's AAD and
 * compared byte for byte, so the owner is lowercased and the group key is
 * spelled exactly as the envelope spells it.
 */
export function grantDescriptor(ref: GroupKeyRef, node: GrantNode): GrantDescriptor {
  return {
    v: 1,
    node: canonicalNode(node) as GrantNode,
    owner: ref.owner.toLowerCase() as Address,
    groupKeyId: groupKeyId(ref.groupKeyId),
  }
}

/**
 * Derive a piece's key from whichever node the caller holds.
 *
 * A group key holder walks the piece's whole group path. A group holder walks
 * the rest of the path below its own group — which works only if its group is the
 * piece's group or an ancestor of it. A piece holder already has the key, and
 * gets it back only for the piece whose salt it names.
 *
 * Takes the metadata as FEE returns it (`info.appMetadata`), unvalidated, and
 * checks every field before using it.
 *
 * Pass the grant that delivered the key as `holding` where you have it: then the
 * piece's owner and group key are checked against the grant too, so a key from the
 * wrong group key fails here with a clear reason rather than later inside FEE.
 *
 * @throws If the piece is not in this format, belongs to another owner or group key
 * than the grant, the held group does not contain the piece's group, or the held
 * piece is a different piece.
 */
export function keyForEnvelope(
  node: Uint8Array,
  envelopeMetadata: PieceMetadata | Readonly<Record<string, unknown>> | undefined,
  holder: Holding | GrantDescriptor = 'groupKey'
): Uint8Array {
  if (envelopeMetadata == null || typeof envelopeMetadata !== 'object') {
    throw new Error(
      `A piece's envelope metadata must be an object, got ${envelopeMetadata === null ? 'null' : typeof envelopeMetadata}`
    )
  }
  // Every field is checked below before it is used.
  const metadata = envelopeMetadata as PieceMetadata
  // Format changes break key derivation, so guard first
  if (metadata['foc/v'] !== 1 || typeof metadata['foc/ks'] !== 'string') {
    throw new Error(
      `This piece's envelope is not format 1 with a group key (foc/v ${String(metadata['foc/v'])}, ` +
        `foc/ks ${String(metadata['foc/ks'])}); this version reads only that.`
    )
  }
  groupKeyId(metadata['foc/ks'])

  // Given the grant itself, check the piece is in the grant's group key before deriving anything
  let holding: Holding
  if (typeof holder === 'object' && 'node' in holder) {
    const own = metadata['foc/own']
    if (groupKeyId(holder.groupKeyId) !== groupKeyId(metadata['foc/ks'])) {
      throw new Error(
        `This key is for group key ${holder.groupKeyId}; the piece is in group key ${metadata['foc/ks']}.`
      )
    }
    if (typeof own === 'string' && own.toLowerCase() !== holder.owner.toLowerCase()) {
      throw new Error(`This key is from owner ${holder.owner}; the piece belongs to ${own}.`)
    }
    holding = holdingOf(holder)
  } else holding = holder

  // If a direct piece grant, verify this is for the correct piece before deriving
  if (holding !== 'groupKey' && 'piece' in holding) {
    if (saltOf(holding.piece) !== saltOf(metadata['foc/salt'])) {
      throw new Error('This piece key belongs to another piece: the envelope names a different salt.')
    }
    return node.slice()
  }

  // Verify the held group contains the piece's group before deriving
  const group = metadata['foc/scope']
  const target = group == null ? [] : groupPath(group).split('/')
  const held = holding === 'groupKey' ? [] : groupPath(holding.group).split('/')
  if (held.length > target.length || held.some((name, i) => name !== target[i])) {
    throw new Error(
      `Group "${held.join('/')}" does not contain this piece's group "${group ?? '(none)'}"; ` +
        'a group opens itself and the groups beneath it.'
    )
  }

  // Go!
  return pieceKey(walk(node, target.slice(held.length)), metadata['foc/salt'])
}

/**
 * A FEE key resolver for pieces this node reaches: pass it to `fee.decrypt()`,
 * which calls it with the envelope's metadata before decrypting a byte.
 *
 * ```ts
 * await encrypted.pipeThrough(fee.decrypt(Keysmith.keyResolver(kk))).pipeTo(sink)
 * ```
 *
 * The metadata is not yet authenticated when FEE calls this; it is checked as
 * strictly as any other envelope, and a tampered label derives a key that the
 * content tags then reject.
 */
export const keyResolver =
  (node: Uint8Array, holding: Holding | GrantDescriptor = 'groupKey') =>
  (info: { appMetadata?: Readonly<Record<string, unknown>> }): Uint8Array =>
    keyForEnvelope(node, info.appMetadata, holding)

/**
 * Which node a grant carries, ready to pass to {@link keyForEnvelope}.
 *
 * A group key, a group's key and a piece key are all 32 bytes of HKDF output, so
 * nothing distinguishes them once unwrapped — but the grant that delivered the
 * key does, so keep the whole grant, not just the key.
 *
 * @throws If the grant names a node this version does not understand.
 */
export function holdingOf(grant: Pick<GrantDescriptor, 'node'>): Holding {
  const node = canonicalNode(grant.node)
  if (node === 'keyspace') {
    return 'groupKey'
  }
  return node.startsWith('piece:')
    ? { piece: node.slice('piece:'.length) as Hex }
    : { group: node.slice('scope:'.length) }
}

/**
 * Everything a delegate needs to write a piece, taken from the grant that
 * delegated it: the group key to record, the group to label it with,
 * and the key to derive its piece key from.
 *
 * The grant decides what is allowed. A group key grant may write under any group
 * or none; a group grant only under its own group or a group beneath it, and
 * defaults to its own group. A piece grant cannot write at all: its key belongs
 * to one existing piece, and FEE needs a fresh key for every object. Anything
 * else is refused here, before a piece is encrypted under a key its intended
 * readers could never derive.
 *
 * @throws If the grant is a piece grant, the group lies outside the grant's subtree, or the key is not 32 bytes.
 */
export function writeTarget(grant: GrantDescriptor, nodeKey: Uint8Array, group?: string): WriteTarget {
  if (nodeKey.length !== 32) {
    throw new Error(`Expected a 32-byte node key, got ${nodeKey.length} bytes`)
  }
  const holding = holdingOf(grant)
  if (holding !== 'groupKey' && 'piece' in holding) {
    throw new Error('A piece grant opens one existing piece and cannot write: FEE needs a fresh key for every object.')
  }
  const held = holding === 'groupKey' ? [] : holding.group.split('/')
  const path = group == null ? held : groupPath(group).split('/')
  if (held.length > path.length || held.some((name, i) => name !== path[i])) {
    const covers = held.length === 0 ? 'the whole group key' : `group "${held.join('/')}" and the groups beneath it`
    throw new Error(`This grant covers ${covers}; it cannot write under "${group}".`)
  }
  return {
    ref: { owner: grant.owner, groupKeyId: groupKeyId(grant.groupKeyId) },
    ...(path.length === 0 ? {} : { group: path.join('/') }),
    key: walk(nodeKey, path.slice(held.length)),
  }
}
