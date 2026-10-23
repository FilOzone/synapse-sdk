/**
 * Derivation: one wallet signature per keyspace, then HKDF all the way down.
 *
 * ```text
 * sig = signTypedData(KeyspaceKey{owner, keyspace})
 * KK  = HKDF(r‖s, "foc/acl/keyspace/v1")      the whole keyspace
 * RK  = HKDF(KK,  "foc/acl/role/v1"‖scope)     one access scope within it
 * PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
 * ```
 *
 * @module
 */
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { Address, Hex } from 'viem'
import { bytesToHex, hashTypedData, hexToBytes, recoverAddress } from 'viem'
import type {
  GrantDescriptor,
  GrantNode,
  Holding,
  KeyspaceKeyMessage,
  KeyspaceKeys,
  KeyspaceKeysOptions,
  KeyspaceRef,
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
 * Parameters of the typed data signature that roots a keyspace
 */
export const KEYSPACE_KEY_TYPES = {
  KeyspaceKey: [
    { name: 'owner', type: 'address' },
    { name: 'keyspace', type: 'bytes16' },
  ],
} as const

const INFO = {
  keyspace: 'foc/acl/keyspace/v1',
  scope: 'foc/acl/role/v1',
  piece: 'foc/acl/piece/v1',
  commitment: 'foc/kc/v1',
} as const

/** The FWSS data-set metadata key the commitment is written to. */
export const COMMITMENT_KEY = 'foc/kc'
/** The FWSS data-set metadata key naming the keyspace, so the chain alone can list them. */
export const KEYSPACE_ID_KEY = 'foc/ks'

const derive = (ikm: Uint8Array, info: string, length = 32): Uint8Array =>
  hkdf(sha256, ikm, undefined, utf8ToBytes(info), length)

function randomHex(length: number): Hex {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** A fresh per-piece salt. Public: it only has to travel with the piece. */
export const newSalt = (): Hex => randomHex(16)

/**
 * A fresh keyspace identifier: 16 random bytes.
 * Must be unique to a wallet, so that a grant for one keyspace cannot be
 * relabelled as another.
 */
export const newKeyspace = (): Hex => randomHex(16)

/**
 * Canonical form of a keyspace identifier: 16 bytes of hex, lowercase, prefixed with `0x`.
 *
 * @throws If it is not 16 bytes of hex.
 */
export function keyspaceId(keyspace: string): Hex {
  const lower = text(keyspace, 'A keyspace id').toLowerCase()
  if (!/^0x[0-9a-f]{32}$/.test(lower)) {
    throw new Error(`A keyspace id is 16 bytes of hex, got ${JSON.stringify(keyspace)}`)
  }
  return lower as Hex
}

export function keyspaceKeyMessage(ref: KeyspaceRef): KeyspaceKeyMessage {
  return { owner: ref.owner, keyspace: keyspaceId(ref.keyspace) }
}

/**
 * Sign for one keyspace and derive its key.
 *
 * The signature is the root secret, and it never leaves this function: the
 * caller gets the keyspace key and the public commitment, and has nothing
 * else to guard.
 *
 * For a new keyspace this signs twice and compares, which catches a
 * non-deterministic signer before any data depends on it, at the cost of a second
 * wallet prompt. For an existing one, pass the commitment its dataset records
 * (`foc/kc`): it signs once, and the commitment catches the same faults. See
 * {@link KeyspaceKeysOptions}.
 *
 * Only the owner's own wallet can sign: a key signed by any other wallet,
 * a session key included, is not the key the owner's wallet derives, and
 * nothing downstream could tell. Delegates receive a grant instead.
 *
 * The result carries the keyspace descriptor, so an owner writes the same way
 * a delegate does — `writeTarget(descriptor, kk, scope)` — with the keyspace
 * taken from what was actually signed.
 *
 * @throws If the signer is not deterministic, is not the owner, does not produce an ECDSA signature,
 * or derives a key that does not match `options.commitment`.
 */
export async function keyspaceKeys(
  signer: TypedDataSigner,
  ref: KeyspaceRef,
  options: KeyspaceKeysOptions = {}
): Promise<KeyspaceKeys> {
  const message = keyspaceKeyMessage(ref)
  const args = { domain: DOMAIN, types: KEYSPACE_KEY_TYPES, primaryType: 'KeyspaceKey' as const, message }
  const first = await signer.signTypedData(args)
  if (options.verifySigner ?? options.commitment == null) {
    const second = await signer.signTypedData(args)
    if (first !== second) {
      throw new Error(
        'Signer is not deterministic (RFC 6979 expected), so it cannot root a keyspace. ' +
          'Signing the same message twice produced different signatures.'
      )
    }
  }
  const rs = lowSrs(first)
  await assertSignedBy(message.owner, hashTypedData(args), rs)
  const kk = derive(rs, INFO.keyspace)
  if (options.commitment != null && !matchesCommitment(kk, options.commitment)) {
    throw new Error(
      'This key does not match the recorded commitment: the signer is not deterministic, ' +
        'or the commitment belongs to another keyspace.'
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
    `This signature is not from the keyspace owner ${owner}. Only the owner's wallet can sign for its keyspace; ` +
      'a delegate, such as a session key, receives a grant instead.'
  )
}

/**
 * A non-secret commitment to the keyspace key, for FWSS data-set metadata:
 * `v1.<32 hex digits>`, where `v1` is the format of the value.
 */
export const commitment = (kk: Uint8Array): string => `v1.${bytesToHex(derive(kk, INFO.commitment, 16)).slice(2)}`

/**
 * Verifies that `kk` is the key you expect: the right root wallet and the right
 * keyspace. Check this before using any key received in a grant.
 *
 * @throws If the recorded value is not a commitment in this format.
 */
export function matchesCommitment(kk: Uint8Array, recorded: string): boolean {
  if (!/^v1\.[0-9a-f]{32}$/.test(recorded)) {
    throw new Error(`Not a keyspace commitment in format v1: ${JSON.stringify(recorded)}`)
  }
  return commitment(kk) === recorded
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
        'Contract accounts and smart wallets return other encodings and cannot root a keyspace.'
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
 * The key for an access scope. Scopes form a tree, and a scope's key is derived
 * from its parent's, so holding a scope also opens every scope beneath it.
 *
 */
export const scopeKey = (kk: Uint8Array, scope: string): Uint8Array => walk(kk, scopePath(scope).split('/'))

const walk = (key: Uint8Array, names: string[]): Uint8Array =>
  names.reduce((parent, name) => derive(parent, `${INFO.scope}${name}`), key)

/**
 * Canonicalize scope name in the form it is derived from: Unicode NFC,
 * non-empty, no leading or trailing whitespace, and no `/` (which would
 * indicate a *path*). Case is significant.
 *
 * @throws If the name is empty, padded with whitespace, contains `/`, or is not well-formed Unicode.
 */
export function scopeName(name: string): string {
  // Lone surrogates risk two different names deriving the same key, so refuse them.
  if (/\p{Cs}/u.test(name)) {
    throw new Error(`A scope name must be well-formed Unicode (no lone surrogates), got ${JSON.stringify(name)}`)
  }
  const normalised = name.normalize('NFC')
  if (normalised.length === 0 || normalised.trim() !== normalised || normalised.includes('/')) {
    throw new Error(
      `A scope name must be non-empty, with no leading or trailing whitespace and no "/", got ${JSON.stringify(name)}`
    )
  }
  return normalised
}

/** Canonicalize scope path: canonical names joined by `/`, top scope first. */
export const scopePath = (path: string): string => text(path, 'A scope path').split('/').map(scopeName).join('/')

/**
 * A grant node in canonical form: `keyspace`, `scope:` plus a canonical scope
 * path, or `piece:` plus a piece's salt in lowercase hex.
 */
export function canonicalNode(node: string): string {
  if (text(node, 'A grant node') === 'keyspace') {
    return 'keyspace'
  }
  if (node.startsWith('scope:')) {
    return `scope:${scopePath(node.slice('scope:'.length))}`
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
export function pieceMetadata(ref: KeyspaceRef, options: { salt: Hex; scope?: string }): PieceMetadata {
  const salt = saltOf(options.salt)
  if (salt.length !== 2 + 2 * 16) {
    throw new Error(`A piece salt is 16 random bytes, from newSalt(); got ${(salt.length - 2) / 2}`)
  }
  return {
    'foc/v': 1,
    'foc/own': ref.owner.toLowerCase() as Address,
    'foc/ks': keyspaceId(ref.keyspace),
    ...(options.scope == null ? {} : { 'foc/scope': scopePath(options.scope) }),
    'foc/salt': salt,
  }
}

/**
 * The descriptor naming what a grant unlocks, ready for `wrapTo()`.
 *
 * Build descriptors with `grantDescriptor()` rather than filling the
 * structure by hand: the descriptor is authenticated as the grant's AAD and
 * compared byte for byte, so the owner is lowercased and the keyspace is
 * spelled exactly as the envelope spells it.
 */
export function grantDescriptor(ref: KeyspaceRef, node: GrantNode): GrantDescriptor {
  return {
    v: 1,
    node: canonicalNode(node) as GrantNode,
    owner: ref.owner.toLowerCase() as Address,
    keyspace: keyspaceId(ref.keyspace),
  }
}

/**
 * Derive a piece's key from whichever node the caller holds.
 *
 * A keyspace-key holder walks the piece's whole scope path. A scope holder walks
 * the rest of the path below its own scope — which works only if its scope is the
 * piece's scope or an ancestor of it. A piece holder already has the key, and
 * gets it back only for the piece whose salt it names.
 *
 * Takes the metadata as FEE returns it (`info.appMetadata`), unvalidated, and
 * checks every field before using it.
 *
 * Pass the grant that delivered the key as `holding` where you have it: then the
 * piece's owner and keyspace are checked against the grant too, so a key from the
 * wrong keyspace fails here with a clear reason rather than later inside FEE.
 *
 * @throws If the piece is not in this format, belongs to another owner or keyspace
 * than the grant, the held scope does not contain the piece's scope, or the held
 * piece is a different piece.
 */
export function keyForEnvelope(
  node: Uint8Array,
  envelopeMetadata: PieceMetadata | Readonly<Record<string, unknown>> | undefined,
  holder: Holding | GrantDescriptor = 'keyspace'
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
      `This piece's envelope is not format 1 with a keyspace (foc/v ${String(metadata['foc/v'])}, ` +
        `foc/ks ${String(metadata['foc/ks'])}); this version reads only that.`
    )
  }
  keyspaceId(metadata['foc/ks'])

  // Given the grant itself, check the piece is in the grant's keyspace before deriving anything
  let holding: Holding
  if (typeof holder === 'object' && 'node' in holder) {
    const own = metadata['foc/own']
    if (keyspaceId(holder.keyspace) !== keyspaceId(metadata['foc/ks'])) {
      throw new Error(`This key is for keyspace ${holder.keyspace}; the piece is in keyspace ${metadata['foc/ks']}.`)
    }
    if (typeof own === 'string' && own.toLowerCase() !== holder.owner.toLowerCase()) {
      throw new Error(`This key is from owner ${holder.owner}; the piece belongs to ${own}.`)
    }
    holding = holdingOf(holder)
  } else holding = holder

  // If a direct piece grant, verify this is for the correct piece before deriving
  if (holding !== 'keyspace' && 'piece' in holding) {
    if (saltOf(holding.piece) !== saltOf(metadata['foc/salt'])) {
      throw new Error('This piece key belongs to another piece: the envelope names a different salt.')
    }
    return node.slice()
  }

  // Verify the held scope contains the piece's scope before deriving
  const scope = metadata['foc/scope']
  const target = scope == null ? [] : scopePath(scope).split('/')
  const held = holding === 'keyspace' ? [] : scopePath(holding.scope).split('/')
  if (held.length > target.length || held.some((name, i) => name !== target[i])) {
    throw new Error(
      `Scope "${held.join('/')}" does not contain this piece's scope "${scope ?? '(none)'}"; ` +
        'a scope opens itself and the scopes beneath it.'
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
  (node: Uint8Array, holding: Holding | GrantDescriptor = 'keyspace') =>
  (info: { appMetadata?: Readonly<Record<string, unknown>> }): Uint8Array =>
    keyForEnvelope(node, info.appMetadata, holding)

/**
 * Which node a grant carries, ready to pass to {@link keyForEnvelope}.
 *
 * Keyspace and scope keys are all 32 bytes of HKDF output, so nothing
 * distinguishes them once unwrapped — but the grant that delivered the
 * key tells you so keep the whole grant, not just the key.
 *
 * @throws If the grant names a node this version does not understand.
 */
export function holdingOf(grant: Pick<GrantDescriptor, 'node'>): Holding {
  const node = canonicalNode(grant.node)
  if (node === 'keyspace') {
    return 'keyspace'
  }
  return node.startsWith('piece:')
    ? { piece: node.slice('piece:'.length) as Hex }
    : { scope: node.slice('scope:'.length) }
}

/**
 * Everything a delegate needs to write a piece, taken from the grant that
 * delegated it: the keyspace to record, the scope to label it with,
 * and the key to derive its piece key from.
 *
 * The grant decides what is allowed. A keyspace grant may write under any scope
 * or none; a scope grant only under its own scope or a scope beneath it, and
 * defaults to its own scope. A piece grant cannot write at all: its key belongs
 * to one existing piece, and FEE needs a fresh key for every object. Anything
 * else is refused here, before a piece is encrypted under a key its intended
 * readers could never derive.
 *
 * @throws If the grant is a piece grant, the scope lies outside the grant's subtree, or the key is not 32 bytes.
 */
export function writeTarget(grant: GrantDescriptor, nodeKey: Uint8Array, scope?: string): WriteTarget {
  if (nodeKey.length !== 32) {
    throw new Error(`Expected a 32-byte node key, got ${nodeKey.length} bytes`)
  }
  const holding = holdingOf(grant)
  if (holding !== 'keyspace' && 'piece' in holding) {
    throw new Error('A piece grant opens one existing piece and cannot write: FEE needs a fresh key for every object.')
  }
  const held = holding === 'keyspace' ? [] : holding.scope.split('/')
  const path = scope == null ? held : scopePath(scope).split('/')
  if (held.length > path.length || held.some((name, i) => name !== path[i])) {
    const covers = held.length === 0 ? 'the whole keyspace' : `scope "${held.join('/')}" and the scopes beneath it`
    throw new Error(`This grant covers ${covers}; it cannot write under "${scope}".`)
  }
  return {
    ref: { owner: grant.owner, keyspace: keyspaceId(grant.keyspace) },
    ...(path.length === 0 ? {} : { scope: path.join('/') }),
    key: walk(nodeKey, path.slice(held.length)),
  }
}
