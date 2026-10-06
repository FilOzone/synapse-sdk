/**
 * Sharing: wrap a node key to a recipient's public key.
 *
 * ECDH-ES over secp256k1 plus AES-256-GCM, so a recipient uses the key they
 * already have — a session key, or any service holding a local key — and
 * nothing new has to be published, registered or stored.
 *
 * A grant proves nothing about who made it. Anyone can address one to anyone,
 * with any key inside; what the recipient learns on a successful unwrap is
 * only that the descriptor was not altered in transit. Before writing with a
 * key you were handed, open a known piece with it.
 *
 * @module
 */
import { mapHashToField } from '@noble/curves/abstract/modular'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha2'
import type { Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import { canonicalNode, keyspaceId } from './derive.ts'
import type { Grant, GrantDescriptor } from './types.ts'

const ECDH_INFO = 'foc/acl/ecdh/v1'
const WRAP_INFO = 'foc/acl/wrap/v1'
const ALG = 'ECDH-ES+A256GCM/secp256k1'
const KEY_LENGTH = 32

/**
 * The key-agreement key derived from a signing key, so that one credential
 * never serves two algorithms. HKDF stretches the signing key to 48 bytes,
 * and hash-to-scalar (FIPS 186-5 §A.2.1) reduces that to a uniform scalar.
 * Deterministic, so the public half can be published once and stays valid.
 */
function ecdhSecretKey(privateKey: Hex): Uint8Array {
  const seed = hkdf(sha256, hexToBytes(privateKey), undefined, ECDH_INFO, 48)
  return mapHashToField(seed, secp256k1.CURVE.n)
}

/**
 * The public key a sender wraps to, for the holder of a secp256k1 private key.
 *
 * This is the derived key-agreement key, not the signing key's own public
 * point: publish this, not the address key.
 */
export const publicKeyOf = (privateKey: Hex): Hex =>
  bytesToHex(secp256k1.getPublicKey(ecdhSecretKey(privateKey), false))

/**
 * Wrap a node key — a keyspace key, or a role key — to a recipient.
 *
 * The descriptor is authenticated, so a grant cannot be relabelled as one
 * naming a different keyspace or role. The result is inert without the
 * recipient's private key, so it can be delivered or stored anywhere.
 */
export async function wrapTo(recipientPublicKey: Hex, key: Uint8Array, descriptor: GrantDescriptor): Promise<Grant> {
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Expected a ${KEY_LENGTH}-byte node key, got ${key.length} bytes`)
  }
  // Accept either encoding, but derive from one, or the two sides would disagree.
  const pkR = secp256k1.ProjectivePoint.fromHex(hexToBytes(recipientPublicKey)).toRawBytes(false)
  const ephemeral = secp256k1.utils.randomSecretKey()
  const epk = secp256k1.getPublicKey(ephemeral, false)
  const kek = wrapKek(sharedSecret(ephemeral, pkR), epk, pkR)
  const iv = new Uint8Array(12)
  crypto.getRandomValues(iv)
  const aesKey = await crypto.subtle.importKey('raw', buffer(kek), 'AES-GCM', false, ['encrypt'])
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buffer(iv), additionalData: aad(descriptor) },
    aesKey,
    buffer(key)
  )
  return {
    ...descriptor,
    alg: ALG,
    epk: bytesToHex(epk),
    iv: bytesToHex(iv),
    ct: bytesToHex(new Uint8Array(ct)),
  }
}

/**
 * Open a grant with the recipient's private key.
 *
 * @throws If the grant was not addressed to this key, its descriptor was
 * altered, or it is not a grant this version understands.
 */
export async function unwrapWith(privateKey: Hex, grant: Grant): Promise<Uint8Array> {
  const { alg, epk, iv, ct, ...descriptor } = grant
  if (descriptor.v !== 2) {
    throw new Error(`Unsupported grant version: ${String(descriptor.v)}`)
  }
  if (alg !== ALG) {
    throw new Error(`Unsupported grant algorithm: ${String(alg)}`)
  }
  const sk = ecdhSecretKey(privateKey)
  const pkR = secp256k1.getPublicKey(sk, false)
  const epkBytes = hexToBytes(epk)
  const kek = wrapKek(sharedSecret(sk, epkBytes), epkBytes, pkR)
  const aesKey = await crypto.subtle.importKey('raw', buffer(kek), 'AES-GCM', false, ['decrypt'])
  const out = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buffer(hexToBytes(iv)), additionalData: aad(descriptor) },
      aesKey,
      buffer(hexToBytes(ct))
    )
  )
  if (out.length !== KEY_LENGTH) {
    throw new Error(`Grant carried a ${out.length}-byte key; a node key is ${KEY_LENGTH} bytes`)
  }
  return out
}

/** X coordinate of the ECDH point, as both halves compute it. */
const sharedSecret = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  secp256k1.getSharedSecret(privateKey, publicKey, true).subarray(1)

/** KEK = HKDF(shared ‖ epk ‖ pkR): both public keys bound in, as HPKE does. */
function wrapKek(shared: Uint8Array, epk: Uint8Array, pkR: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(shared.length + epk.length + pkR.length)
  ikm.set(shared, 0)
  ikm.set(epk, shared.length)
  ikm.set(pkR, shared.length + epk.length)
  return hkdf(sha256, ikm, undefined, WRAP_INFO, 32)
}

/**
 * The authenticated fields, in a fixed order, as a JSON array of primitives.
 *
 * Each field is re-canonicalised so that a spelling difference cannot split a
 * grant. Exactly these five fields are covered; anything else carried
 * alongside a grant is informational and unauthenticated.
 */
function aad(d: GrantDescriptor): ArrayBuffer {
  const fields = [d.v, canonicalNode(d.node), d.owner.toLowerCase(), keyspaceId(d.keyspace), integer(d.epoch, 'epoch')]
  return buffer(new TextEncoder().encode(JSON.stringify(fields)))
}

/** A relay may have rendered a number as a string; accept that, but nothing that is not an integer. */
function integer(value: unknown, name: string): number {
  const n = Number(value)
  if (!Number.isSafeInteger(n) || n < 0) {
    throw new Error(`Grant ${name} must be a non-negative integer, got ${String(value)}`)
  }
  return n
}

/** WebCrypto takes ArrayBuffer-backed data; noble and viem return views. */
const buffer = (view: Uint8Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
