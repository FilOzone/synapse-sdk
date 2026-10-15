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
}

/** The message an owner signs to start the derivation tree */
export type KeyspaceKeyMessage = {
  owner: Address // The wallet that roots this keyspace
  keyspace: Hex // bytes16, canonical lowercase hex
} & Record<string, unknown>

/** What `keyspaceKeys()` hands back. The signature it came from is never exposed. */
export interface KeyspaceKeys {
  kk: Uint8Array // The key for the whole keyspace.
  commitment: string // Non-secret check value for FWSS metadata, under `COMMITMENT_KEY`: `v1.<hex>`.
  descriptor: GrantDescriptor // What was signed, as a keyspace grant descriptor: `writeTarget(descriptor, kk, scope)`.
}

export interface KeyspaceKeysOptions {
  /**
   * @verifySigner@
   * Whether to sign twice to confirm deterministic derivation (ie RFC 6979)
   *
   * DANGER! Only set to false if you are certain that the signer
   * is deterministic, otherwise you may end up with encryption
   * keys that are not recoverable by the owner.
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

/** FEE envelope entries to enable key derivation/recovery */
export interface PieceMetadata {
  'foc/v': 1 // The version of this metadata format
  'foc/own'?: Address // The keyspace owner, lowercased
  'foc/ks': Hex // The keyspace this piece's key belongs to
  'foc/scope'?: string // The scope path this piece is in, eg `top-secret/secret`
  'foc/salt': Hex // The piece's unique salt
}

/** What a grant may unlock: the whole keyspace, one scope within it, or one piece, named by its salt. */
export type GrantNode = 'keyspace' | `scope:${string}` | `piece:${string}`

/**
 * Encryption grant metadata. Exactly these fields are authenticated, so a
 * grant cannot be relabelled; anything else carried alongside a grant is
 * informational and unauthenticated.
 */
export interface GrantDescriptor {
  v: 1
  node: string // 'keyspace', 'scope:<path>', or 'piece:<salt>'.
  owner: Address // The wallet that roots the keyspace, lowercased
  keyspace: Hex // Spelled as in `foc/ks`
}

/** A node key wrapped to one recipient. Safe to store or send anywhere. */
export interface Grant extends GrantDescriptor {
  alg: 'ECDH-ES+A256GCM/secp256k1' // Agility TBD
  epk: Hex // Ephemeral public key, uncompressed
  iv: Hex //AES-GCM nonce
  ct: Hex // Wrapped key: ciphertext ‖ tag
}

/** Which node the caller holds when deriving a piece key: the keyspace, a scope by its path, or one piece by its salt. */
export type Holding = 'keyspace' | { scope: string } | { piece: Hex }

/** What `writeTarget()` hands a delegate: everything needed to write one piece. */
export interface WriteTarget {
  ref: KeyspaceRef // For pieceMetadata(): the keyspace the grant names
  scope?: string // The scope path to label the piece with; absent for an unlabelled piece
  key: Uint8Array // The node key to derive the piece key from: pieceKey(key, salt)
}
