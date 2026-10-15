/**
 * Sharing: wrap a node key to a recipient's public key.
 *
 * ECDH-ES over secp256k1 plus AES-256-GCM, so a recipient uses the key they
 * already have — a session key, or any service holding a local key — and
 * nothing new has to be published, registered or stored.
 *
 * A grant proves nothing about who made it. Anyone can address one to anyone,
 * with any key inside; what the recipient learns on a successful unwrap is
 * only that the descriptor was not altered in transit. Check a key before
 * writing with it: a keyspace key against the dataset's `foc/kc` with
 * `matchesCommitment`, and a scope key by opening a known piece.
 *
 * @module
 */
import { mapHashToField } from '@noble/curves/abstract/modular.js'
import { secp256k1 } from '@noble/curves/secp256k1.js'
import { hkdf } from '@noble/hashes/hkdf.js'
import { sha256 } from '@noble/hashes/sha2.js'
import { utf8ToBytes } from '@noble/hashes/utils.js'
import type { Address, Hex } from 'viem'
import { bytesToHex, hexToBytes, isAddress } from 'viem'
import { canonicalNode, keyspaceId, text } from './derive.ts'
import type { Grant, GrantDescriptor } from './types.ts'

const ECDH_INFO = utf8ToBytes('foc/acl/ecdh/v1')
const WRAP_INFO = utf8ToBytes('foc/acl/wrap/v1')
const ALG = 'ECDH-ES+A256GCM/secp256k1'
const KEY_LENGTH = 32

/**
 * The key-agreement key derived from a signing key, so that one credential
 * never serves two algorithms. HKDF stretches the signing key to 48 bytes,
 * and hash-to-scalar (FIPS 186-5 §A.2.1) reduces that to a uniform scalar.
 * Deterministic, so the public half can be published once and stays valid.
 *
 * @throws If it is not a valid secp256k1 private key — an address or a public
 * key passed by mistake would otherwise hash to a key nobody holds.
 */
function ecdhSecretKey(privateKey: Hex): Uint8Array {
  const raw = hexToBytes(privateKey)
  if (raw.length !== 32 || !secp256k1.utils.isValidSecretKey(raw)) {
    throw new Error(`Expected a 32-byte secp256k1 private key, got ${raw.length} bytes that are not one`)
  }
  const seed = hkdf(sha256, raw, undefined, ECDH_INFO, 48)
  return mapHashToField(seed, secp256k1.Point.CURVE().n)
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
 * Wrap a node key — a keyspace key, a scope key, or one piece's key — to a recipient.
 *
 * The descriptor is authenticated, so a grant cannot be relabelled as one
 * naming a different keyspace, scope or piece. The result is inert without the
 * recipient's private key, so it can be delivered or stored anywhere.
 *
 * The grant carries the descriptor in canonical form, whoever built it, and
 * nothing else: add informational fields to the returned grant if needed.
 */
export async function wrapTo(recipientPublicKey: Hex, key: Uint8Array, input: GrantDescriptor): Promise<Grant> {
  const descriptor = canonical(input)
  if (key.length !== KEY_LENGTH) {
    throw new Error(`Expected a ${KEY_LENGTH}-byte node key, got ${key.length} bytes`)
  }
  // Accept either encoding, but derive from one, or the two sides would disagree.
  const pkR = secp256k1.Point.fromBytes(hexToBytes(recipientPublicKey)).toBytes(false)
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
  if (grant == null || typeof grant !== 'object') {
    throw new Error(`A grant must be an object, got ${grant === null ? 'null' : typeof grant}`)
  }
  const { alg, epk, iv, ct, ...rest } = grant
  const descriptor = canonical(rest)
  if (alg !== ALG) {
    throw new Error(`Unsupported grant algorithm: ${String(alg)}`)
  }
  // Exactly the sizes wrapTo writes: an uncompressed point, a GCM nonce, a node key and its tag.
  const epkBytes = grantBytes(epk, 'epk', 65)
  const ivBytes = grantBytes(iv, 'iv', 12)
  const ctBytes = grantBytes(ct, 'ct', KEY_LENGTH + 16)
  const sk = ecdhSecretKey(privateKey)
  const pkR = secp256k1.getPublicKey(sk, false)
  const kek = wrapKek(sharedSecret(sk, epkBytes), epkBytes, pkR)
  const aesKey = await crypto.subtle.importKey('raw', buffer(kek), 'AES-GCM', false, ['decrypt'])
  try {
    return new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: buffer(ivBytes), additionalData: aad(descriptor) },
        aesKey,
        buffer(ctBytes)
      )
    )
  } catch (cause) {
    throw new Error('This grant does not open with this key: it is addressed to another key, or was altered', {
      cause,
    })
  }
}

/** A fixed-length hex field of a grant, as bytes. */
function grantBytes(value: unknown, field: string, length: number): Uint8Array {
  const hex = text(value, `A grant's ${field}`)
  if (!/^0x[0-9a-fA-F]*$/.test(hex) || hex.length !== 2 + 2 * length) {
    throw new Error(`A grant's ${field} must be ${length} bytes of hex`)
  }
  return hexToBytes(hex as Hex)
}

/** SSK for key wraps */
const sharedSecret = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  secp256k1.getSharedSecret(privateKey, publicKey, true).subarray(1)

/** Derive key encryption key from HKDF(shared ‖ epk ‖ pkR) */
function wrapKek(shared: Uint8Array, epk: Uint8Array, pkR: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(shared.length + epk.length + pkR.length)
  ikm.set(shared, 0)
  ikm.set(epk, shared.length)
  ikm.set(pkR, shared.length + epk.length)
  return hkdf(sha256, ikm, undefined, WRAP_INFO, 32)
}

/**
 * Canonicalize a grant descriptor to ensure it authenitcates on the other end.
 *
 * @throws If it is not a version this code understands, or a field is malformed.
 */
function canonical(d: GrantDescriptor): GrantDescriptor {
  if (d.v !== 1) {
    throw new Error(`Unsupported grant version: ${String(d.v)}`)
  }
  const owner = text(d.owner, "A grant's owner").toLowerCase()
  if (!isAddress(owner, { strict: false })) {
    throw new Error(`A grant's owner must be an address, got ${JSON.stringify(d.owner)}`)
  }
  return {
    v: 1,
    node: canonicalNode(d.node),
    owner: owner as Address,
    keyspace: keyspaceId(d.keyspace),
  }
}

/**
 * The authenticated fields of a canonical descriptor, in a fixed order, as a
 * JSON array of primitives. Exactly these four are covered; anything else
 * carried alongside a grant is informational and unauthenticated.
 */
const aad = (d: GrantDescriptor): ArrayBuffer =>
  buffer(new TextEncoder().encode(JSON.stringify([d.v, d.node, d.owner, d.keyspace])))

/** Helper: WebCrypto takes ArrayBuffer-backed data; noble and viem return views. */
const buffer = (view: Uint8Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
