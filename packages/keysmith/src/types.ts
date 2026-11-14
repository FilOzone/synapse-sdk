import type { Address, Hex } from 'viem'

/**
 * Identifies the group key a key belongs to.
 *
 * A group key is Keysmith's own namespace, chosen by the client and carried in
 * every envelope. It is deliberately independent of FWSS: replication and
 * repair put copies of a piece into other datasets, on other providers,
 * sometimes paid for by other accounts, and the piece must still open.
 */
export interface GroupKeyRef {
  owner: Address // The wallet that roots this group key and signs for it
  groupKeyId: Hex // 16 random bytes; names the key namespace, independent of any dataset
}

/** The message an owner signs to start the derivation tree. Its `keyspace` field is the EIP-712 wire name for the group key id. */
export type GroupKeyMessage = {
  owner: Address // The wallet that roots this group key
  keyspace: Hex // bytes16, canonical lowercase hex
} & Record<string, unknown>

/** What `deriveGroupKey()` hands back. The signature it came from is never exposed. */
export interface DerivedGroupKey {
  kk: Uint8Array // The group key: the secret root every group's key and piece key derives from.
  commitment: string // Non-secret check value for FWSS metadata, under `COMMITMENT_KEY`: `v1.<hex>`.
  descriptor: GrantDescriptor // What was signed, as a group key grant descriptor: `writeTarget(descriptor, kk, group)`.
}

export interface DeriveGroupKeyOptions {
  /**
   * The commitment an existing group key's dataset records under `COMMITMENT_KEY`
   * (`foc/kc`). Used to verify RFC 6979 behavior without a second signature.
   */
  commitment?: string
  /**
   * @verifySigner@
   * Whether to sign twice to confirm deterministic derivation (ie RFC 6979).
   * Defaults to true, or to false when `commitment` is given.
   *
   * DANGER! Only set to false without a commitment if you are certain that
   * the signer is deterministic, otherwise you may end up with encryption
   * keys that are not recoverable by the owner.
   */
  verifySigner?: boolean
  /**
   * An optional password mixed into the group key (via Argon2id), so that
   * a phished signature alone does not reveal it. Without one, the key is
   * exactly what it always was. With one, the same password is needed every
   * time: a wrong one fails against `commitment`, and a forgotten one loses
   * the group key for good.
   */
  password?: string
}

/**
 * Anything that can sign EIP-712 typed data: a viem Account, a WalletClient, or
 * a session key. Keysmith itself never sees a private key.
 */
export interface TypedDataSigner {
  signTypedData: (args: {
    domain: { readonly name: string; readonly version: string }
    types: Record<string, readonly { readonly name: string; readonly type: string }[]>
    primaryType: 'KeyspaceKey' // EIP-712 wire name
    message: GroupKeyMessage
  }) => Promise<Hex>
}

/**
 * FEE envelope entries to enable key derivation/recovery, format 2. Readers accept it; this release
 * does not write it yet. Format 2 is `foc/v` 2 with `foc/group` in place of `foc/scope`.
 *
 * Both formats are types, not interfaces, so either can be passed as FEE's `appMetadata`
 * (a string-keyed record) as it is.
 */
export type PieceMetadataV2 = {
  'foc/v': 2 // The version of this metadata format
  'foc/own': Address // The group key owner, lowercased.
  'foc/ks': Hex // Key set: the group key id, naming the set of keys derived from one group key
  'foc/group'?: string // The group path this piece is in, eg `top-secret/secret`
  'foc/salt': Hex // The piece's unique salt
}

/** FEE envelope entries to enable key derivation/recovery, format 1: what this release writes. */
export type PieceMetadataV1 = {
  'foc/v': 1 // The version of this metadata format
  'foc/own': Address // The group key owner, lowercased.
  'foc/ks': Hex // Key set: the group key id, naming the set of keys derived from one group key
  'foc/scope'?: string // The group path this piece is in, eg `top-secret/secret`
  'foc/salt': Hex // The piece's unique salt
}

/**
 * The format `pieceMetadata()` writes today: {@link PieceMetadataV1}. A later release switches the
 * writers to format 2 (once the Go and Curio readers ship): add a `PieceMetadataVn`, repoint this alias.
 */
export type PieceMetadata = PieceMetadataV1

/** A piece's labels from either format, as `readPieceMetadata()` returns them: canonical, validated. */
export interface PieceMetadataView {
  version: 1 | 2
  owner?: Address // As the envelope spells it; absent for a piece that is not gated
  groupKeyId: Hex
  group?: string // Canonical group path
  salt: Hex
}

/**
 * What a grant may unlock: the whole group key, one group within it, or one piece, named by its salt.
 * The strings are wire values, signed into claims. This release writes `'keyspace'` and `'scope:<path>'`;
 * `'groupKey'` and `'group:<path>'` are read too, and a later release writes them.
 */
export type GrantNode = 'groupKey' | `group:${string}` | `piece:${string}` | 'keyspace' | `scope:${string}`

/**
 * Encryption grant metadata. Exactly these fields are authenticated, so a
 * grant cannot be relabelled; anything else carried alongside a grant is
 * informational and unauthenticated.
 */
export interface GrantDescriptor {
  v: 1
  node: string // A GrantNode, spelled exactly as wrapped; compare with nodeKind()
  owner: Address // The wallet that roots the group key, lowercased
  groupKeyId: Hex // Spelled as in `foc/ks` (key set)
}

/** A node key wrapped to one recipient. Safe to store or send anywhere. */
export interface Grant extends GrantDescriptor {
  alg: 'ECDH-ES+A256GCM/secp256k1' // Agility TBD
  epk: Hex // Ephemeral public key, uncompressed
  iv: Hex //AES-GCM nonce
  ct: Hex // Wrapped key: ciphertext ‖ tag
}

/**
 * Which node the caller holds when deriving a piece key: the whole group key, a group by its path, or one
 * piece by its salt. These are API names, not wire strings: `holdingOf()` maps a grant's {@link GrantNode},
 * in either spelling, to one of them.
 */
export type Holding = 'groupKey' | { group: string } | { piece: Hex }

/** What `writeTarget()` hands a delegate: everything needed to write one piece. */
export interface WriteTarget {
  ref: GroupKeyRef // For pieceMetadata(): the group key the grant names
  group?: string // The group path to label the piece with; absent for an unlabelled piece
  key: Uint8Array // The node key to derive the piece key from: pieceKey(key, salt)
}
