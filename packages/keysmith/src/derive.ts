/**
 * Derivation: one wallet signature per group key, then HKDF all the way down.
 *
 * ```text
 * sig         = signTypedData(GroupKey{owner, groupKeyId})    owner signs for the group key id
 * groupKey    = HKDF(r‖s, "foc/acl/group-key/v2")            the root
 *               (salt = Argon2id(password, hash(sig message)) if a password is given)
 * keyForGroup = HKDF(groupKey, "foc/acl/group/v2"‖group)     a group's key, one step per path segment
 * pieceKey    = HKDF(node, "foc/acl/piece/v2"‖salt)          node: whichever key above the piece is held
 * ```
 *
 * The quoted strings are wire values: they are signed or hashed, so changing one changes every key.
 *
 * @module
 */
import { argon2idAsync } from '@noble/hashes/argon2.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { Address, Hex } from 'viem'
import { bytesToHex, hashTypedData, hexToBytes, isAddress, recoverAddress } from 'viem'
import type {
  DerivedGroupKey,
  DeriveGroupKeyOptions,
  GrantDescriptor,
  GrantNode,
  GroupKeyMessage,
  GroupKeyRef,
  Holding,
  PieceMetadata,
  PieceMetadataV2,
  PieceMetadataView,
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
export const DOMAIN = { name: 'Filecoin Encryption', version: '2' } as const

/**
 * Parameters of the typed data signature that roots a group key.
 * `GroupKey` and `groupKeyId` are wire names: do not rename.
 */
export const GROUP_KEY_TYPES = {
  GroupKey: [
    { name: 'owner', type: 'address' },
    { name: 'groupKeyId', type: 'bytes16' },
  ],
} as const

const INFO = {
  groupKey: 'foc/acl/group-key/v2',
  group: 'foc/acl/group/v2',
  piece: 'foc/acl/piece/v2',
  commitment: 'foc/kc/v2',
} as const

/**
 * The refusal for anything written by keysmith 0.1.0 (format 1): a different derivation, so it
 * cannot be read, and refusing early beats a confusing failure further down.
 */
export const format1Error = (what: string): Error =>
  new Error(`keysmith 0.1.0 (format 1) data is not supported: ${what}`)

/**
 * Check a grant descriptor's `v`: it must be exactly the number 2. `v` 1 or `"1"` is keysmith 0.1.0's.
 * With `required: false` an absent `v` passes (node-only input), but a present one is still checked.
 *
 * @throws If `v` is not 2.
 */
export function assertGrantVersion(v: unknown, { required }: { required: boolean }): void {
  if (v === undefined && !required) return
  if (v === 1 || v === '1') throw format1Error('a grant with v 1')
  if (v !== 2) throw new Error(`Unsupported grant version: ${JSON.stringify(v)}`)
}

/** The FWSS data-set metadata key the commitment is written to. */
export const COMMITMENT_KEY = 'foc/kc'

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
  return { owner: ref.owner, groupKeyId: groupKeyId(ref.groupKeyId) }
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
 * a delegate does — `writeTarget(descriptor, groupKey, group)` — with the group key
 * taken from what was actually signed.
 *
 * @throws Before any signing, if `options.password` is empty or not well-formed
 * Unicode, or `options.commitment` is not a commitment in format v2. After signing,
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
  const args = { domain: DOMAIN, types: GROUP_KEY_TYPES, primaryType: 'GroupKey' as const, message }
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
  const groupKey = derive(rs, INFO.groupKey, 32, salt)
  if (options.commitment != null && !matchesCommitment(groupKey, options.commitment)) {
    const cause =
      password == null ? 'the group key may need a password' : 'the password is wrong, or this group key has none'
    throw new Error(
      `This key does not match the recorded commitment: ${cause}; ` +
        'or the signer is not deterministic, or the commitment belongs to another group key.'
    )
  }
  return { groupKey, commitment: commitment(groupKey), descriptor: grantDescriptor(ref, 'groupKey') }
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
 * `v2.<32 hex digits>`, where `v2` is the format of the value.
 */
export const commitment = (groupKey: Uint8Array): string =>
  `v2.${bytesToHex(derive(groupKey, INFO.commitment, 16)).slice(2)}`

function commitmentFormat(recorded: string): string {
  if (/^v1\./.test(recorded)) throw format1Error('a v1 commitment')
  if (!/^v2\.[0-9a-f]{32}$/.test(recorded)) {
    throw new Error(`Not a group key commitment in format v2: ${JSON.stringify(recorded)}`)
  }
  return recorded
}

/**
 * Verifies that `groupKey` is the key you expect: the right root wallet and the right
 * group key. Check this before using any key received in a grant.
 *
 * @throws If the recorded value is not a commitment in this format.
 */
export function matchesCommitment(groupKey: Uint8Array, recorded: string): boolean {
  return commitment(groupKey) === commitmentFormat(recorded)
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
export const keyForGroup = (groupKey: Uint8Array, group: string): Uint8Array =>
  walk(groupKey, groupPath(group).split('/'))

const walk = (key: Uint8Array, names: string[]): Uint8Array =>
  names.reduce((parent, name) => derive(parent, `${INFO.group}${name}`), key)

/**
 * Canonicalize group name in the form it is derived from: Unicode NFC,
 * non-empty, no leading or trailing whitespace, and no `/` (which would
 * indicate a *path*). Case is significant.
 *
 * @throws If the name is empty, padded with whitespace, contains `/`, or is not well-formed Unicode.
 */
export const groupName = (name: string): string => checkName(name)

function checkName(name: string): string {
  // Lone surrogates risk two different names deriving the same key, so refuse them.
  if (/\p{Cs}/u.test(name)) {
    throw new Error(`A group name must be well-formed Unicode (no lone surrogates), got ${JSON.stringify(name)}`)
  }
  const normalised = name.normalize('NFC')
  if (normalised.length === 0 || normalised.trim() !== normalised || normalised.includes('/')) {
    throw new Error(
      `A group name must be non-empty, with no leading or trailing whitespace and no "/", got ${JSON.stringify(name)}`
    )
  }
  return normalised
}

/** Canonicalize group path: canonical names joined by `/`, top group first. */
export const groupPath = (path: string): string => text(path, 'A group path').split('/').map(checkName).join('/')

/** What a grant node means. Path and salt are canonical. */
export type NodeKind = { kind: 'groupKey' } | { kind: 'group'; path: string } | { kind: 'piece'; salt: Hex }

/**
 * Parse a grant node: `'groupKey'`, `'group:<path>'` or `'piece:<salt>'`. Every decision about a node
 * goes through this, never a string compare.
 *
 * @throws If the node is not one of those, or its path or salt is malformed.
 */
export function nodeKind(node: string): NodeKind {
  if (text(node, 'A grant node') === 'groupKey') return { kind: 'groupKey' }
  if (node.startsWith('group:')) return { kind: 'group', path: groupPath(node.slice('group:'.length)) }
  if (node.startsWith('piece:')) {
    const salt = saltOf(node.slice('piece:'.length))
    if (salt.length !== 2 + 2 * 16) throw new Error(`A piece node names a 16-byte salt, got ${JSON.stringify(node)}`)
    return { kind: 'piece', salt }
  }
  throw new Error(`Unrecognised grant node: ${node}`)
}

/**
 * A grant node with path and salt canonical. The node is signed or bound into the wrap's AAD,
 * so it is written only in this form.
 */
export function canonicalNode(node: string): GrantNode {
  const k = nodeKind(node)
  if (k.kind === 'groupKey') return 'groupKey'
  if (k.kind === 'group') return `group:${k.path}`
  return `piece:${k.salt}`
}

/**
 * The metadata to record on a data set for this group key: its id under `foc/gkid` and the group key
 * `commitment` (from {@link commitment}) under `foc/kc`, so the chain alone can list a wallet's group keys.
 *
 * Synapse reuses a data set only on an exact metadata match. To keep adding to an existing data set,
 * pass that data set's metadata as it is, rather than rebuilding it here.
 *
 * @throws If the id is not 16 bytes of hex, or `groupKeyCommitment` is not a commitment in format v2.
 */
export function dataSetMetadata(ref: GroupKeyRef, groupKeyCommitment: string): Record<string, string> {
  return { 'foc/gkid': groupKeyId(ref.groupKeyId), [COMMITMENT_KEY]: commitmentFormat(groupKeyCommitment) }
}

/**
 * The group key id a data set's metadata records under `foc/gkid`, canonical, or `undefined` if it records none.
 * A data set without `foc/gkid`, including one written by keysmith 0.1.0 (`foc/ks`), returns `undefined`, so a
 * lookup across a wallet's data sets skips it. `undefined` does not mean "not encrypted": a data set recording
 * `foc/ks`, or a `v1.` `foc/kc`, is a keysmith 0.1.0 encrypted data set, and an app should not add new data to it.
 *
 * @throws If the metadata is not an object, or `foc/gkid` is malformed or not a string.
 */
export function groupKeyIdOf(metadata: Readonly<Record<string, string>>): Hex | undefined {
  if (metadata == null || typeof metadata !== 'object') {
    throw new Error(`Data set metadata must be an object, got ${metadata === null ? 'null' : typeof metadata}`)
  }
  const id = metadata['foc/gkid']
  return id === undefined ? undefined : groupKeyId(id)
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

/**
 * The wallet a piece is gated to, as the labels spell it. Absent or falsy means not gated.
 *
 * @throws If `foc/own` is truthy but not an address: refused rather than read as not gated.
 */
export function gatedOwner(own: unknown): Address | undefined {
  if (!own) return undefined
  if (typeof own !== 'string' || !isAddress(own, { strict: false })) {
    throw new Error(`foc/own must be an address, got ${JSON.stringify(own)}`)
  }
  return own
}

/**
 * The canonical group path a piece's labels name under `foc/group`, if any.
 *
 * @throws If the path is malformed.
 */
export function groupLabelOf(m: Readonly<Record<string, unknown>>): string | undefined {
  const group = m['foc/group']
  if (group == null) return undefined
  return groupPath(group as string)
}

/**
 * The group key id a piece's labels name under `foc/gkid`, canonical.
 *
 * @throws If the labels are from keysmith 0.1.0, `foc/v` is not absent, 2 or "2", or the id is malformed.
 */
export function labelsGroupKeyId(m: Readonly<Record<string, unknown>>): Hex {
  const v = m['foc/v']
  if (v === 1 || v === '1' || (m['foc/gkid'] === undefined && m['foc/ks'] !== undefined)) {
    throw format1Error('this piece carries foc/v 1 or foc/ks labels')
  }
  // Absent, 2 or "2" only: a provider may pass a string, but a later format is not read as format 2
  if (v !== undefined && v !== 2 && v !== '2') {
    throw new Error(`Unsupported piece label format: foc/v ${JSON.stringify(v)}`)
  }
  return groupKeyId(m['foc/gkid'] as string)
}

/**
 * Read a piece's envelope metadata (`foc/v` 2: `foc/gkid`, `foc/group`) into one canonical shape.
 *
 * Takes the metadata as FEE returns it (`info.appMetadata`), unvalidated.
 *
 * @throws If `foc/v` is not 2 (an envelope from keysmith 0.1.0 is `foc/v` 1), or a field is malformed.
 */
export function readPieceMetadata(
  envelopeMetadata: PieceMetadataV2 | Readonly<Record<string, unknown>> | undefined
): PieceMetadataView {
  if (envelopeMetadata == null || typeof envelopeMetadata !== 'object') {
    throw new Error(
      `A piece's envelope metadata must be an object, got ${envelopeMetadata === null ? 'null' : typeof envelopeMetadata}`
    )
  }
  const m = envelopeMetadata as Readonly<Record<string, unknown>>
  const version = m['foc/v']
  // Format changes break key derivation, so guard first
  if (String(version) === '1') throw format1Error('this piece is labelled foc/v 1')
  if (version !== 2 || typeof m['foc/gkid'] !== 'string') {
    throw new Error(
      `This piece's envelope is not format 2 with a group key (foc/v ${JSON.stringify(version)}, ` +
        `foc/gkid ${String(m['foc/gkid'])}).`
    )
  }
  const group = groupLabelOf(m)
  const owner = gatedOwner(m['foc/own'])
  return {
    ...(owner === undefined ? {} : { owner }),
    groupKeyId: labelsGroupKeyId(m),
    ...(group === undefined ? {} : { group }),
    salt: saltOf(m['foc/salt'] as string),
  }
}

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
 * Piece FEE envelope metadata entries. Read them back with {@link readPieceMetadata}.
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
    'foc/v': 2,
    'foc/own': ref.owner.toLowerCase() as Address,
    'foc/gkid': groupKeyId(ref.groupKeyId),
    ...(options.group == null ? {} : { 'foc/group': groupPath(options.group) }),
    'foc/salt': salt,
  }
}

/**
 * The descriptor naming what a grant unlocks, ready for `wrapTo()`.
 *
 * Build descriptors with `grantDescriptor()` rather than filling the
 * structure by hand: the descriptor is authenticated as the grant's AAD and
 * compared byte for byte, so the owner is lowercased and the group key is
 * spelled exactly as the envelope spells it.
 */
export function grantDescriptor(ref: GroupKeyRef, node: GrantNode): GrantDescriptor {
  return {
    v: 2,
    node: canonicalNode(node),
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
 * Takes the metadata as FEE returns it (`info.appMetadata`),
 * unvalidated, and checks every field before using it (see {@link readPieceMetadata}).
 *
 * Pass the grant that delivered the key as `holding` where you have it: then the
 * piece's owner and group key are checked against the grant too, so a key from the
 * wrong group key fails here with a clear reason rather than later inside FEE.
 *
 * @throws If the piece is not format 2, belongs to another owner or group key
 * than the grant, the held group does not contain the piece's group, or the held
 * piece is a different piece.
 */
export function keyForEnvelope(
  node: Uint8Array,
  envelopeMetadata: PieceMetadataV2 | Readonly<Record<string, unknown>> | undefined,
  holder: Holding | GrantDescriptor = 'groupKey'
): Uint8Array {
  // Checks every field before it is used
  const piece = readPieceMetadata(envelopeMetadata)

  // Given the grant itself, check the piece is in the grant's group key before deriving anything
  let holding: Holding
  if (typeof holder === 'object' && 'node' in holder) {
    assertGrantVersion(holder.v, { required: true })
    holding = holdingOf(holder)
    if (groupKeyId(holder.groupKeyId) !== piece.groupKeyId) {
      throw new Error(`This key is for group key ${holder.groupKeyId}; the piece is in group key ${piece.groupKeyId}.`)
    }
    if (piece.owner != null && piece.owner.toLowerCase() !== holder.owner.toLowerCase()) {
      throw new Error(`This key is from owner ${holder.owner}; the piece belongs to ${piece.owner}.`)
    }
  } else holding = holder

  // If a direct piece grant, verify this is for the correct piece before deriving
  if (holding !== 'groupKey' && 'piece' in holding) {
    if (saltOf(holding.piece) !== piece.salt) {
      throw new Error('This piece key belongs to another piece: the envelope names a different salt.')
    }
    return node.slice()
  }

  // Verify the held group contains the piece's group before deriving
  const group = piece.group
  const target = group == null ? [] : group.split('/')
  const held = holding === 'groupKey' ? [] : groupPath(holding.group).split('/')
  if (held.length > target.length || held.some((name, i) => name !== target[i])) {
    throw new Error(
      `Group "${held.join('/')}" does not contain this piece's group "${group ?? '(none)'}"; ` +
        'a group opens itself and the groups beneath it.'
    )
  }

  // Go!
  return pieceKey(walk(node, target.slice(held.length)), piece.salt)
}

/**
 * A FEE key resolver for pieces this node reaches: pass it to `fee.decrypt()`,
 * which calls it with the envelope's metadata before decrypting a byte.
 *
 * ```ts
 * await encrypted.pipeThrough(fee.decrypt(Keysmith.keyResolver(groupKey))).pipeTo(sink)
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
 * Takes a full grant or just `{ node }`: `v` is checked only when present.
 *
 * @throws If `v` is present and not 2 (`v` 1 is keysmith 0.1.0's), or the node is not one this version understands.
 */
export function holdingOf(grant: Pick<GrantDescriptor, 'node'> & { v?: unknown }): Holding {
  assertGrantVersion(grant.v, { required: false })
  const k = nodeKind(grant.node)
  if (k.kind === 'groupKey') return 'groupKey'
  return k.kind === 'piece' ? { piece: k.salt } : { group: k.path }
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
 * @throws If the grant's `v` is not 2, the grant is a piece grant, the group lies outside the grant's subtree, or the key is not 32 bytes.
 */
export function writeTarget(grant: GrantDescriptor, nodeKey: Uint8Array, group?: string): WriteTarget {
  if (nodeKey.length !== 32) {
    throw new Error(`Expected a 32-byte node key, got ${nodeKey.length} bytes`)
  }
  assertGrantVersion(grant.v, { required: true })
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
