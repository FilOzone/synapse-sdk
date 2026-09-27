import type { Address, Hex } from 'viem'

/** Identifies the dataset a key belongs to */
export interface DatasetRef {
  chainId: number // eg 314 for Filecoin mainnet
  service: Address // FWSS contract address on @chainId@
  payer: Address // Dataset payer, as a proxy for owner
  clientDataSetId: bigint // Client-chosen dataset ID
  epoch?: number // For key rotation/re-encrypt in place
}

/** The EIP-712 message a payer signs to start the derivation tree */
export type DatasetKeyMessage = {
  purpose: string
  chainId: bigint // eg 314 for Filecoin mainnet
  service: Address // FWSS contract address on @chainId@
  payer: Address // Dataset payer, as a proxy for owner
  clientDataSetId: bigint // Client-chosen dataset ID
  epoch: number // For key rotation/re-encrypt in place
} & Record<string, unknown>

/**
 * Anything that can sign EIP-712 typed data: a viem Account, a WalletClient, or
 * a session key. Keysmith itself never sees a private key.
 */
export interface TypedDataSigner {
  signTypedData: (args: {
    domain: { readonly name: string; readonly version: string }
    types: Record<string, readonly { readonly name: string; readonly type: string }[]>
    primaryType: 'DatasetKey'
    message: DatasetKeyMessage
  }) => Promise<Hex>
}

/** FEE envelope entries to enable key derivation/recovery */
export interface PieceMetadata {
  'foc/v': number
  'foc/cds': Hex
  'foc/epoch': number // Key rotation counter
  'foc/scope'?: string // Creates sharable 'subfolders' within a dataset
  'foc/salt': Hex // Because there is such a thing as _too much_ determinism :-)
}

/** What a grant may unlock: the whole dataset, or one scope of it. */
export type GrantNode = 'dataset' | `scope:${string}`

/**
 * Names the node a grant unlocks. Authenticated, so it cannot be relabelled.
 *
 * `node` is a plain string rather than {@link GrantNode} because grants arrive
 * as JSON from elsewhere and must be validated at runtime, not assumed. Build
 * one with `grantDescriptor()` and the narrow type applies.
 */
export interface GrantDescriptor {
  v: 1
  node: string // 'dataset', or 'scope:<name>'.
  chainId: number // eg 314 for Filecoin mainnet
  service: Address // FWSS contract address on @chainId@
  payer: Address // Dataset payer, as a proxy for owner
  clientDataSetId: Hex // Client-chosen dataset ID, spelled as in `foc/cds`
  [key: string]: unknown
}

/** A node key wrapped to one recipient. Safe to store or send anywhere. */
export interface Grant extends GrantDescriptor {
  alg: 'ECDH-ES+A256GCM/secp256k1' // Agility TBD
  epk: Hex // Ephemeral public key, uncompressed
  iv: Hex //AES-GCM nonce
  ct: Hex // Wrapped key: ciphertext ‖ tag
}

/** Which node the caller holds when deriving a piece key. */
export type Holding = 'dataset' | 'scope'
