/**
 * Derivation: one wallet signature per dataset, then HKDF all the way down.
 *
 * ```text
 * sig = signTypedData(DatasetKey{chainId, service, payer, clientDataSetId, epoch})
 * DK  = HKDF(r‖s, "foc/acl/dataset/v1")      one dataset
 * SK  = HKDF(DK,  "foc/acl/scope/v1"‖name)   one section of it
 * PK  = HKDF(node,"foc/acl/piece/v1"‖salt)   one piece
 * ```
 *
 * @module
 */
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import type { Address, Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import type {
  DatasetKeyMessage,
  DatasetKeys,
  DatasetKeysOptions,
  DatasetRef,
  GrantDescriptor,
  GrantNode,
  Holding,
  PieceMetadata,
  TypedDataSigner,
} from './types.ts'

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
/** Half the secp256k1 group order; an `s` above this is the malleable form. */
const HALF_N = N / 2n

/**
 * Note: Deliberately carries neither `chainId` nor `verifyingContract`:
 * a redeployed contract, or a wallet pointed at another network, must
 * not orphan a dataset's key. The binding those fields would give is not
 * lost — `chainId` and `service` are fields of the message below, where
 * they are signed just the same.
 *
 * **Never add a field here, and never zero-fill one.** The separator is
 * hashed over the fields that are present, so `{name, version}` and
 * `{name, version, chainId: 0, verifyingContract: 0x00…}` are different
 * domains, different signatures, and different keys. Any change orphans
 * every key ever derived, with no migration path. Pinned by a golden test.
 */
export const DOMAIN = { name: 'FOC Encryption', version: '1' } as const

export const DATASET_KEY_TYPES = {
  DatasetKey: [
    { name: 'purpose', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'service', type: 'address' },
    { name: 'payer', type: 'address' },
    { name: 'clientDataSetId', type: 'uint256' },
    { name: 'epoch', type: 'uint32' },
  ],
} as const

const PURPOSE = 'foc/enc/v1 dataset key'
const INFO = {
  dataset: 'foc/acl/dataset/v1',
  scope: 'foc/acl/scope/v1',
  piece: 'foc/acl/piece/v1',
  commitment: 'foc/kc/v1',
} as const

/** The FWSS data-set metadata key the commitment is written to. */
export const COMMITMENT_KEY = 'foc/kc'

const derive = (ikm: Uint8Array, info: string, length = 32): Uint8Array => hkdf(sha256, ikm, undefined, info, length)

function randomHex(length: number): Hex {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytesToHex(bytes)
}

/** A fresh per-piece salt. Public: it only has to travel with the piece. */
export const newSalt = (): Hex => randomHex(16)

/** A fresh `clientDataSetId`. FWSS rejects one this payer has used before. */
export const newClientDataSetId = (): bigint => BigInt(randomHex(8))

export function datasetKeyMessage(ref: DatasetRef): DatasetKeyMessage {
  return {
    purpose: PURPOSE,
    chainId: BigInt(ref.chainId),
    service: ref.service,
    payer: ref.payer,
    clientDataSetId: ref.clientDataSetId,
    epoch: ref.epoch ?? 0,
  }
}

/** Signers already shown to sign deterministically, so later calls cost one prompt. */
const verifiedSigners = new WeakSet<object>()

/**
 * Sign for one dataset and derive its key.
 *
 * The signature is the root secret, and it never leaves this function: the
 * caller gets the dataset key and the public commitment, and has nothing else
 * to guard.
 *
 * On a signer's first use this signs twice and compares, which catches a
 * randomising signer before any data depends on it, at the cost of a second
 * wallet prompt. Later calls sign once. See {@link DatasetKeysOptions}.
 *
 * @throws If the signer is not deterministic, or does not produce an ECDSA signature.
 */
export async function datasetKeys(
  signer: TypedDataSigner,
  ref: DatasetRef,
  options: DatasetKeysOptions = {}
): Promise<DatasetKeys> {
  const args = {
    domain: DOMAIN,
    types: DATASET_KEY_TYPES,
    primaryType: 'DatasetKey' as const,
    message: datasetKeyMessage(ref),
  }
  const first = await signer.signTypedData(args)
  if (options.verifySigner ?? !verifiedSigners.has(signer)) {
    const second = await signer.signTypedData(args)
    if (first !== second) {
      throw new Error(
        'Signer is not deterministic (RFC 6979 expected), so it cannot root a dataset key. ' +
          'Signing the same message twice produced different signatures.'
      )
    }
    verifiedSigners.add(signer)
  }
  const secret = lowSrs(first)
  return {
    dk: derive(secret, INFO.dataset),
    commitment: `v1.${bytesToHex(derive(secret, INFO.commitment, 16)).slice(2)}`,
  }
}

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
        'Contract accounts and smart wallets return other encodings and cannot root a dataset key.'
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
 * The key for one section of a dataset. Opens every piece written into that
 * scope, and nothing outside it. The name is an HKDF input, never a secret.
 */
export const scopeKey = (dk: Uint8Array, scope: string): Uint8Array => derive(dk, `${INFO.scope}${scopeName(scope)}`)

/**
 * A scope name in the one form it is derived from: Unicode NFC, non-empty,
 * with no leading or trailing whitespace. Case is significant — `Invoices`
 * and `invoices` are different scopes — so it is left alone rather than folded.
 *
 * @throws If the name is empty or padded with whitespace.
 */
export function scopeName(name: string): string {
  const normalised = name.normalize('NFC')
  if (normalised.length === 0 || normalised.trim() !== normalised) {
    throw new Error(
      `A scope name must be non-empty with no leading or trailing whitespace, got ${JSON.stringify(name)}`
    )
  }
  return normalised
}

/** A grant node in canonical form: `dataset`, or `scope:` plus a canonical scope name. */
export function canonicalNode(node: string): string {
  if (node === 'dataset') {
    return 'dataset'
  }
  if (node.startsWith('scope:')) {
    return `scope:${scopeName(node.slice('scope:'.length))}`
  }
  throw new Error(`Unrecognised grant node: ${node}`)
}

/** The key for one piece. Never reused: FEE requires a fresh key per object. */
export const pieceKey = (node: Uint8Array, salt: Hex): Uint8Array => derive(node, `${INFO.piece}${lowerHex(salt)}`)

/** Salts are bytes, so only case is normalised — leading zeros are part of the value. */
const lowerHex = (value: Hex): Hex => value.toLowerCase() as Hex

/**
 * Deterministic serialization for IDs.
 * Essential because on-chain/off-chain values are used in signatures and
 * must not drift or vary in rendering.
 */
const clientDataSetIdHex = (id: bigint): Hex => `0x${id.toString(16)}`

/** What to record in a piece's envelope so that a reader can derive its key. */
export function pieceMetadata(ref: DatasetRef, options: { salt: Hex; scope?: string }): PieceMetadata {
  return {
    'foc/v': 1,
    'foc/cds': clientDataSetIdHex(ref.clientDataSetId),
    'foc/epoch': ref.epoch ?? 0,
    ...(options.scope == null ? {} : { 'foc/scope': scopeName(options.scope) }),
    'foc/salt': lowerHex(options.salt),
  }
}

/**
 * The descriptor naming what a grant unlocks, ready for `wrapTo()`.
 *
 * Build descriptors with `grantDescriptor()` rather than filling the
 * structure by hand: the descriptor is authenticated as the grant's AAD and
 * compared byte for byte, so addresses are lowercased and the id is spelled
 * exactly as the envelope spells it.
 */
export function grantDescriptor(ref: DatasetRef, node: GrantNode): GrantDescriptor {
  return {
    v: 1,
    node: canonicalNode(node) as GrantNode,
    chainId: ref.chainId,
    epoch: ref.epoch ?? 0,
    service: ref.service.toLowerCase() as Address,
    payer: ref.payer.toLowerCase() as Address,
    clientDataSetId: clientDataSetIdHex(ref.clientDataSetId),
  }
}

/**
 * Derive a piece's key from whichever node the caller holds.
 *
 * A dataset-key holder walks down through the scope named in the metadata; a
 * scope-key holder is already there. Neither needs records of its own.
 */
export function keyForEnvelope(node: Uint8Array, metadata: PieceMetadata, holding: Holding = 'dataset'): Uint8Array {
  const scope = metadata['foc/scope']
  if (holding === 'scope' && scope == null) {
    throw new Error(
      'This piece is not in a scope, so no scope key opens it. Pieces written at the ' +
        'root of a dataset need the dataset key.'
    )
  }
  const at = holding === 'dataset' && scope != null ? scopeKey(node, scope) : node
  return pieceKey(at, metadata['foc/salt'])
}

/**
 * Which level a grant carries, ready to pass to {@link keyForEnvelope}.
 *
 * `DK` and `SK` are both 32 bytes of HKDF output, so nothing distinguishes them
 * once unwrapped — but the grant that delivered the key says which it is.
 *
 * @throws If the grant names a node this version does not understand.
 */
export function holdingOf(grant: Pick<GrantDescriptor, 'node'>): Holding {
  if (grant.node === 'dataset') {
    return 'dataset'
  }
  if (grant.node.startsWith('scope:')) {
    return 'scope'
  }
  throw new Error(`Unrecognised grant node: ${grant.node}`)
}
