/**
 * Derivation: one wallet signature per keyspace, then HKDF all the way down.
 *
 * ```text
 * sig = signTypedData(KeyspaceKey{owner, keyspace, epoch})
 * KK  = HKDF(r‖s, "foc/acl/keyspace/v1")      the whole keyspace
 * RK  = HKDF(KK,  "foc/acl/role/v1"‖role)     one access role within it
 * PK  = HKDF(node,"foc/acl/piece/v1"‖salt)    one piece
 * ```
 *
 * @module
 */
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import type { Address, Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
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
 * Note: Deliberately carries neither `chainId` nor `verifyingContract`:
 * a redeployed contract, or a wallet pointed at another network, must
 * not orphan a keyspace's key. Nothing about chains or contracts is signed
 * at all: the keyspace is a 128-bit random identifier, unique without them,
 * and a piece must open wherever its copies end up.
 *
 * **Never add a field here, and never zero-fill one.** The separator is
 * hashed over the fields that are present, so `{name, version}` and
 * `{name, version, chainId: 0, verifyingContract: 0x00…}` are different
 * domains, different signatures, and different keys. Any change orphans
 * every key ever derived, with no migration path. Pinned by a golden test.
 */
export const DOMAIN = { name: 'FOC Encryption', version: '1' } as const

export const KEYSPACE_KEY_TYPES = {
  KeyspaceKey: [
    { name: 'purpose', type: 'string' },
    { name: 'owner', type: 'address' },
    { name: 'keyspace', type: 'bytes16' },
    { name: 'epoch', type: 'uint32' },
  ],
} as const

const PURPOSE = 'foc/enc/v1 keyspace key'
const INFO = {
  keyspace: 'foc/acl/keyspace/v1',
  role: 'foc/acl/role/v1',
  piece: 'foc/acl/piece/v1',
  commitment: 'foc/kc/v1',
} as const

/** The FWSS data-set metadata key the commitment is written to. */
export const COMMITMENT_KEY = 'foc/kc'
/** The FWSS data-set metadata key naming the keyspace, so the chain alone can list them. */
export const KEYSPACE_ID_KEY = 'foc/ks'

const derive = (ikm: Uint8Array, info: string, length = 32): Uint8Array => hkdf(sha256, ikm, undefined, info, length)

function randomHex(length: number): Hex {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** A fresh per-piece salt. Public: it only has to travel with the piece. */
export const newSalt = (): Hex => randomHex(16)

/**
 * A fresh keyspace identifier: 16 random bytes. Public, and unique without
 * reference to any chain, contract or dataset.
 */
export const newKeyspace = (): Hex => randomHex(16)

/**
 * A keyspace id in the one form it is signed and compared in: exactly 16
 * bytes, lowercase hex. Leading zeros are part of the value.
 *
 * @throws If it is not 16 bytes of hex.
 */
export function keyspaceId(keyspace: string): Hex {
  const lower = keyspace.toLowerCase()
  if (!/^0x[0-9a-f]{32}$/.test(lower)) {
    throw new Error(`A keyspace id is 16 bytes of hex, got ${JSON.stringify(keyspace)}`)
  }
  return lower as Hex
}

export function keyspaceKeyMessage(ref: KeyspaceRef): KeyspaceKeyMessage {
  return {
    purpose: PURPOSE,
    owner: ref.owner,
    keyspace: keyspaceId(ref.keyspace),
    epoch: ref.epoch ?? 0,
  }
}

/** Signers already shown to sign deterministically, so later calls cost one prompt. */
const verifiedSigners = new WeakSet<object>()

/**
 * Sign for one keyspace and derive its key.
 *
 * The signature is the root secret, and it never leaves this function: the
 * caller gets the keyspace key and the public commitment, and has nothing
 * else to guard.
 *
 * On a signer's first use this signs twice and compares, which catches a
 * randomising signer before any data depends on it, at the cost of a second
 * wallet prompt. Later calls sign once. See {@link KeyspaceKeysOptions}.
 *
 * @throws If the signer is not deterministic, or does not produce an ECDSA signature.
 */
export async function keyspaceKeys(
  signer: TypedDataSigner,
  ref: KeyspaceRef,
  options: KeyspaceKeysOptions = {}
): Promise<KeyspaceKeys> {
  const args = {
    domain: DOMAIN,
    types: KEYSPACE_KEY_TYPES,
    primaryType: 'KeyspaceKey' as const,
    message: keyspaceKeyMessage(ref),
  }
  const first = await signer.signTypedData(args)
  if (options.verifySigner ?? !verifiedSigners.has(signer)) {
    const second = await signer.signTypedData(args)
    if (first !== second) {
      throw new Error(
        'Signer is not deterministic (RFC 6979 expected), so it cannot root a keyspace. ' +
          'Signing the same message twice produced different signatures.'
      )
    }
    verifiedSigners.add(signer)
  }
  const kk = derive(lowSrs(first), INFO.keyspace)
  return { kk, commitment: commitment(kk) }
}

/**
 * A non-secret commitment to the keyspace key, for FWSS data-set metadata.
 *
 * Derived from the keyspace key rather than the signature, so anything that
 * holds the keyspace key — an agent replicating data into a new dataset, say —
 * can write it into that dataset's metadata too. It reveals nothing: it is a
 * one-way function of a key that is itself never published.
 */
export const commitment = (kk: Uint8Array): string => `v2.${bytesToHex(derive(kk, INFO.commitment, 16)).slice(2)}`

/**
 * `r‖s` with `s` normalised to the low half, and `v` dropped.
 *
 * Both `(r, s)` and `(r, n−s)` are valid signatures, so a signer returning the
 * high form would otherwise derive a different key for the same wallet. The
 * `v` byte is excluded because wallets report it as 0/1 or 27/28.
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
 * The key for an access role. Roles form a tree, and a role's key is derived
 * from its parent's, so holding a role also opens every role beneath it — and
 * nothing above it or beside it. A role is named by its path from the top,
 * `super-secret/secret`; a top-level role is just `agent-memory`.
 *
 * Each role has exactly one parent. A role's position is part of its key, so
 * moving or renaming a role re-keys everything beneath it.
 */
export const roleKey = (kk: Uint8Array, role: string): Uint8Array => walk(kk, rolePath(role).split('/'))

const walk = (key: Uint8Array, names: string[]): Uint8Array =>
  names.reduce((parent, name) => derive(parent, `${INFO.role}${name}`), key)

/**
 * One role name in the form it is derived from: Unicode NFC, non-empty, no
 * leading or trailing whitespace, and no `/`. Case is significant.
 *
 * @throws If the name is empty, padded with whitespace, or contains `/`.
 */
export function roleName(name: string): string {
  const normalised = name.normalize('NFC')
  if (normalised.length === 0 || normalised.trim() !== normalised || normalised.includes('/')) {
    throw new Error(
      `A role name must be non-empty, with no leading or trailing whitespace and no "/", got ${JSON.stringify(name)}`
    )
  }
  return normalised
}

/** A role path in canonical form: canonical names joined by `/`, top role first. */
export const rolePath = (path: string): string => path.split('/').map(roleName).join('/')

/** A grant node in canonical form: `keyspace`, or `role:` plus a canonical role path. */
export function canonicalNode(node: string): string {
  if (node === 'keyspace') {
    return 'keyspace'
  }
  if (node.startsWith('role:')) {
    return `role:${rolePath(node.slice('role:'.length))}`
  }
  throw new Error(`Unrecognised grant node: ${node}`)
}

/** The key for one piece. Never reused: FEE requires a fresh key per object. */
export const pieceKey = (node: Uint8Array, salt: Hex): Uint8Array => derive(node, `${INFO.piece}${lowerHex(salt)}`)

/** Salts are bytes, so only case is normalised — leading zeros are part of the value. */
const lowerHex = (value: Hex): Hex => value.toLowerCase() as Hex

/**
 * What to record in a piece's envelope so that a reader can derive its key.
 *
 * Everything a reader needs travels with the piece, so a copy opens wherever
 * replication or repair puts it.
 */
export function pieceMetadata(ref: KeyspaceRef, options: { salt: Hex; role?: string }): PieceMetadata {
  return {
    'foc/v': 2,
    'foc/ks': keyspaceId(ref.keyspace),
    'foc/epoch': ref.epoch ?? 0,
    ...(options.role == null ? {} : { 'foc/role': rolePath(options.role) }),
    'foc/salt': lowerHex(options.salt),
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
    v: 2,
    node: canonicalNode(node) as GrantNode,
    owner: ref.owner.toLowerCase() as Address,
    keyspace: keyspaceId(ref.keyspace),
    epoch: ref.epoch ?? 0,
  }
}

/**
 * Derive a piece's key from whichever node the caller holds.
 *
 * A keyspace-key holder walks the piece's whole role path. A role holder walks
 * the rest of the path below its own role — which works only if its role is the
 * piece's role or an ancestor of it.
 *
 * @throws If the piece predates this format, or the held role does not contain the piece's role.
 */
export function keyForEnvelope(node: Uint8Array, metadata: PieceMetadata, holding: Holding = 'keyspace'): Uint8Array {
  if (metadata['foc/v'] !== 2) {
    throw new Error(
      `This piece was written with envelope format ${String(metadata['foc/v'])}; this version reads format 2.`
    )
  }
  const role = metadata['foc/role']
  const target = role == null ? [] : rolePath(role).split('/')
  const held = holding === 'keyspace' ? [] : rolePath(holding.role).split('/')
  if (held.length > target.length || held.some((name, i) => name !== target[i])) {
    throw new Error(
      `Role "${held.join('/')}" does not contain this piece's role "${role ?? '(none)'}"; ` +
        'a role opens itself and the roles beneath it.'
    )
  }
  return pieceKey(walk(node, target.slice(held.length)), metadata['foc/salt'])
}

/**
 * Which node a grant carries, ready to pass to {@link keyForEnvelope}.
 *
 * Keyspace and role keys are all 32 bytes of HKDF output, so nothing
 * distinguishes them once unwrapped — but the grant that delivered the key says.
 *
 * @throws If the grant names a node this version does not understand.
 */
export function holdingOf(grant: Pick<GrantDescriptor, 'node'>): Holding {
  const node = canonicalNode(grant.node)
  return node === 'keyspace' ? 'keyspace' : { role: node.slice('role:'.length) }
}

/**
 * Everything a delegate needs to write a piece, taken from the grant that
 * delegated it: the keyspace and epoch to record, the role to label it with,
 * and the key to derive its piece key from.
 *
 * The grant decides what is allowed. A keyspace grant may write under any role
 * or none; a role grant only under its own role or a role beneath it, and
 * defaults to its own role. Anything else is refused here, before a piece is
 * encrypted under a key its intended readers could never derive.
 *
 * @throws If the role lies outside the grant's subtree, or the key is not 32 bytes.
 */
export function writeTarget(grant: GrantDescriptor, nodeKey: Uint8Array, role?: string): WriteTarget {
  if (nodeKey.length !== 32) {
    throw new Error(`Expected a 32-byte node key, got ${nodeKey.length} bytes`)
  }
  const holding = holdingOf(grant)
  const held = holding === 'keyspace' ? [] : holding.role.split('/')
  const path = role == null ? held : rolePath(role).split('/')
  if (held.length > path.length || held.some((name, i) => name !== path[i])) {
    const covers = held.length === 0 ? 'the whole keyspace' : `role "${held.join('/')}" and the roles beneath it`
    throw new Error(`This grant covers ${covers}; it cannot write under "${role}".`)
  }
  return {
    ref: { owner: grant.owner, keyspace: keyspaceId(grant.keyspace), epoch: Number(grant.epoch) },
    ...(path.length === 0 ? {} : { role: path.join('/') }),
    key: walk(nodeKey, path.slice(held.length)),
  }
}
