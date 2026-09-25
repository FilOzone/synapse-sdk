import type { Address, Hex } from 'viem'

/** Identifies the dataset a key belongs to. All of it is public. */
export interface DatasetRef {
  chainId: number
  /** The FWSS service contract this dataset is created against. */
  service: Address
  /** The account that pays for the dataset. */
  payer: Address
  /**
   * Chosen by the client before the dataset exists on chain, and never reused
   * by FWSS for the same payer. Keying on it means the first piece can be
   * encrypted before `createDataSet` assigns an id.
   */
  clientDataSetId: bigint
  /** Reserved for re-keying a dataset in place. Defaults to 0. */
  epoch?: number
}

/**
 * The EIP-712 message a payer signs, once per dataset.
 *
 * Intersected with an index signature so that viem's generic `signTypedData`
 * accepts it, and so any signer shaped like one satisfies {@link TypedDataSigner}.
 */
export type DatasetKeyMessage = {
  purpose: string
  chainId: bigint
  service: Address
  payer: Address
  clientDataSetId: bigint
  epoch: number
} & Record<string, unknown>

/**
 * Anything that can sign EIP-712 typed data: a viem Account, a WalletClient, or
 * a session key. Keysmith never sees a private key.
 */
export interface TypedDataSigner {
  signTypedData: (args: {
    domain: { readonly name: string; readonly version: string }
    types: Record<string, readonly { readonly name: string; readonly type: string }[]>
    primaryType: 'DatasetKey'
    message: DatasetKeyMessage
  }) => Promise<Hex>
}

/**
 * What a piece's envelope records so that a reader can derive its key.
 * Keysmith produces it; the envelope carries it; nothing else stores it.
 */
export interface PieceMetadata {
  'foc/v': number
  'foc/cds': Hex
  'foc/epoch': number
  'foc/scope'?: string
  'foc/salt': Hex
}

/** Names the node a grant unlocks. Authenticated, so it cannot be relabelled. */
export interface GrantDescriptor {
  v: 1
  /** `'dataset'`, or `'scope:<name>'`. */
  node: string
  chainId: number
  service: Address
  payer: Address
  clientDataSetId: string
  [key: string]: unknown
}

/** A node key wrapped to one recipient. Safe to store or send anywhere. */
export interface Grant extends GrantDescriptor {
  alg: 'ECDH-ES+A256GCM/secp256k1'
  /** Ephemeral public key, uncompressed. */
  epk: Hex
  /** AES-GCM nonce. */
  iv: Hex
  /** Wrapped key: ciphertext ‖ tag. */
  ct: Hex
}

/** Which node the caller holds when deriving a piece key. */
export type Holding = 'dataset' | 'scope'
