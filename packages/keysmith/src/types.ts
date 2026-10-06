import type { Address, Hex } from 'viem'

/**
 * Identifies the keyspace a key belongs to.
 *
 * A keyspace is Keysmith's own namespace, chosen by the client and carried in
 * every envelope. It is deliberately independent of FWSS: replication and
 * repair put copies of a piece into other datasets, on other providers,
 * sometimes paid for by other accounts, and the piece must still open.
 */
export interface KeyspaceRef {
  owner: Address // The wallet that roots this keyspace and signs for it
  keyspace: Hex // 16 random bytes; names the key namespace, independent of any dataset
  epoch?: number // For key rotation/re-encrypt in place
}

/** The EIP-712 message an owner signs to start the derivation tree */
export type KeyspaceKeyMessage = {
  purpose: string
  owner: Address // The wallet that roots this keyspace
  keyspace: Hex // bytes16, canonical lowercase hex
  epoch: number // For key rotation/re-encrypt in place
} & Record<string, unknown>

/** What `keyspaceKeys()` hands back. The signature it came from is never exposed. */
export interface KeyspaceKeys {
  kk: Uint8Array // The key for the whole keyspace.
  commitment: string // Non-secret check value for FWSS metadata, under `COMMITMENT_KEY`.
}

export interface KeyspaceKeysOptions {
  /**
   * @verifySigner@
   * Whether to sign twice and compare, which catches a randomising signer
   * before any data depends on it. Defaults to once per signer object: the
   * first call costs two wallet prompts, later calls one. Pass `true` to check
   * on every call, or `false` for a signer you have already vetted.
   */
  verifySigner?: boolean
}

/**
 * Anything that can sign EIP-712 typed data: a viem Account, a WalletClient, or
 * a session key. Keysmith itself never sees a private key.
 */
export interface TypedDataSigner {
  signTypedData: (args: {
    domain: { readonly name: string; readonly version: string }
    types: Record<string, readonly { readonly name: string; readonly type: string }[]>
    primaryType: 'KeyspaceKey'
    message: KeyspaceKeyMessage
  }) => Promise<Hex>
}

/** FEE envelope entries to enable key derivation/recovery, wherever the piece ends up */
export interface PieceMetadata {
  'foc/v': 2
  'foc/ks': Hex // The keyspace this piece's key belongs to
  'foc/epoch': number // Key rotation counter
  'foc/role'?: string // A role path, `super-secret/secret`: that role and every ancestor can read the piece
  'foc/salt': Hex // Because there is such a thing as _too much_ determinism :-)
}

/** What a grant may unlock: the whole keyspace, or one role within it. */
export type GrantNode = 'keyspace' | `role:${string}`

/**
 * Names the node a grant unlocks. Exactly these fields are authenticated, so a
 * grant cannot be relabelled; anything else carried alongside a grant is
 * informational and unauthenticated.
 *
 * `node` is a plain string rather than {@link GrantNode} because grants arrive
 * as JSON from elsewhere and must be validated at runtime, not assumed. Build
 * one with `grantDescriptor()` and the narrow type applies.
 */
export interface GrantDescriptor {
  v: 2
  node: string // 'keyspace', or 'role:<name>'.
  owner: Address // The wallet that roots the keyspace, lowercased
  keyspace: Hex // Spelled as in `foc/ks`
  epoch: number // Which re-keying of the keyspace this key belongs to
}

/** A node key wrapped to one recipient. Safe to store or send anywhere. */
export interface Grant extends GrantDescriptor {
  alg: 'ECDH-ES+A256GCM/secp256k1' // Agility TBD
  epk: Hex // Ephemeral public key, uncompressed
  iv: Hex //AES-GCM nonce
  ct: Hex // Wrapped key: ciphertext ‖ tag
}

/** Which node the caller holds when deriving a piece key: the keyspace, or a role by its path. */
export type Holding = 'keyspace' | { role: string }

/** What `writeTarget()` hands a delegate: everything needed to write one piece. */
export interface WriteTarget {
  ref: KeyspaceRef // For pieceMetadata(): the keyspace and epoch the grant names
  role?: string // The role path to label the piece with; absent for an unlabelled piece
  key: Uint8Array // The node key to derive the piece key from: pieceKey(key, salt)
}
