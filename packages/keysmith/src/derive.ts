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
import { sha256 } from '@noble/hashes/sha256'
import type { Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import type { DatasetKeyMessage, DatasetRef, Holding, PieceMetadata, TypedDataSigner } from './types.ts'

const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n
/** Half the secp256k1 group order; an `s` above this is the malleable form. */
const HALF_N = N / 2n

/**
 * Deliberately carries neither `chainId` nor `verifyingContract`: a redeployed
 * contract, or a wallet pointed at another network, must not orphan a
 * dataset's key.
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

/**
 * Sign for one dataset and return the bytes every key below it derives from.
 *
 * Signs twice and compares: a signer that does not follow RFC 6979 would
 * produce a different key on every call, and this catches it before any data
 * depends on it.
 *
 * @throws If the signer is not deterministic.
 */
export async function datasetSecret(signer: TypedDataSigner, ref: DatasetRef): Promise<Uint8Array> {
  const args = {
    domain: DOMAIN,
    types: DATASET_KEY_TYPES,
    primaryType: 'DatasetKey' as const,
    message: datasetKeyMessage(ref),
  }
  const first = await signer.signTypedData(args)
  const second = await signer.signTypedData(args)
  if (first !== second) {
    throw new Error(
      'Signer is not deterministic (RFC 6979 expected), so it cannot root a dataset key. ' +
        'Signing the same message twice produced different signatures.'
    )
  }
  return lowSrs(first)
}

/**
 * `r‖s` with `s` normalised to the low half, and `v` dropped.
 *
 * Both `(r, s)` and `(r, n−s)` are valid signatures, so a signer returning the
 * high form would otherwise derive a different key for the same wallet. The
 * `v` byte is excluded because wallets report it as 0/1 or 27/28.
 */
export function lowSrs(signature: Hex): Uint8Array {
  const raw = hexToBytes(signature)
  if (raw.length < 64) {
    throw new Error(`Expected a 64- or 65-byte signature, got ${raw.length} bytes`)
  }
  const s = BigInt(bytesToHex(raw.subarray(32, 64)))
  if (s <= HALF_N) {
    return raw.subarray(0, 64)
  }
  const out = new Uint8Array(64)
  out.set(raw.subarray(0, 32), 0)
  out.set(hexToBytes(`0x${(N - s).toString(16).padStart(64, '0')}`), 32)
  return out
}

/** The key for one dataset. Opens every piece in it, and nothing else. */
export const datasetKey = (secret: Uint8Array): Uint8Array => derive(secret, INFO.dataset)

/**
 * A non-secret commitment to the dataset key, for FWSS data-set metadata.
 *
 * Written inside the `createDataSet` call that happens anyway. On recovery the
 * payer re-signs and compares, so a wrong wallet or a randomising signer is a
 * loud error rather than a silently wrong key. It reveals nothing: it is a
 * one-way function of the signature, and the signature is what an attacker
 * would need.
 */
export const commitment = (secret: Uint8Array): string =>
  `v1.${bytesToHex(derive(secret, INFO.commitment, 16)).slice(2)}`

/**
 * The key for one section of a dataset. Opens every piece written into that
 * scope, and nothing outside it. The name is an HKDF input, never a secret.
 */
export const scopeKey = (dk: Uint8Array, scope: string): Uint8Array => derive(dk, `${INFO.scope}${scope}`)

/** The key for one piece. Never reused: FEE requires a fresh key per object. */
export const pieceKey = (node: Uint8Array, salt: Hex): Uint8Array => derive(node, `${INFO.piece}${salt}`)

/** What to record in a piece's envelope so that a reader can derive its key. */
export function pieceMetadata(ref: DatasetRef, options: { salt: Hex; scope?: string }): PieceMetadata {
  return {
    'foc/v': 1,
    'foc/cds': `0x${ref.clientDataSetId.toString(16)}`,
    'foc/epoch': ref.epoch ?? 0,
    ...(options.scope == null ? {} : { 'foc/scope': options.scope }),
    'foc/salt': options.salt,
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
  const at = holding === 'dataset' && scope != null ? scopeKey(node, scope) : node
  return pieceKey(at, metadata['foc/salt'])
}
