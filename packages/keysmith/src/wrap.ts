/**
 * Sharing: wrap a node key to a recipient's public key.
 *
 * ECDH-ES over secp256k1 plus AES-256-GCM, so a recipient uses the key they
 * already have — a wallet, or a Session Key Registry session key — and nothing
 * new has to be published, registered or stored.
 *
 * @module
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import type { Hex } from 'viem'
import { bytesToHex, hexToBytes } from 'viem'
import type { Grant, GrantDescriptor } from './types.ts'

const WRAP_INFO = 'foc/acl/wrap/v1'
const ALG = 'ECDH-ES+A256GCM/secp256k1'

/** The public half of a secp256k1 private key, uncompressed. */
export const publicKeyOf = (privateKey: Hex): Hex => bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), false))

/**
 * Wrap a node key — a dataset key, or a scope key — to a recipient.
 *
 * The descriptor is authenticated, so a grant cannot be relabelled as one
 * naming a different dataset or scope. The result is inert without the
 * recipient's private key, so it can be delivered or stored anywhere.
 */
export async function wrapTo(recipientPublicKey: Hex, key: Uint8Array, descriptor: GrantDescriptor): Promise<Grant> {
  const ephemeral = secp256k1.utils.randomPrivateKey()
  const epk = secp256k1.getPublicKey(ephemeral, false)
  const kek = wrapKek(sharedSecret(ephemeral, hexToBytes(recipientPublicKey)), epk)
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
 * @throws If the grant was not addressed to this key, or its descriptor was altered.
 */
export async function unwrapWith(privateKey: Hex, grant: Grant): Promise<Uint8Array> {
  const { alg, epk, iv, ct, ...descriptor } = grant
  if (alg !== ALG) {
    throw new Error(`Unsupported grant algorithm: ${String(alg)}`)
  }
  const epkBytes = hexToBytes(epk)
  const kek = wrapKek(sharedSecret(hexToBytes(privateKey), epkBytes), epkBytes)
  const aesKey = await crypto.subtle.importKey('raw', buffer(kek), 'AES-GCM', false, ['decrypt'])
  const out = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: buffer(hexToBytes(iv)),
      additionalData: aad(descriptor as GrantDescriptor),
    },
    aesKey,
    buffer(hexToBytes(ct))
  )
  return new Uint8Array(out)
}

/** X coordinate of the ECDH point, as both halves compute it. */
const sharedSecret = (privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array =>
  secp256k1.getSharedSecret(privateKey, publicKey, true).subarray(1)

function wrapKek(shared: Uint8Array, epk: Uint8Array): Uint8Array {
  const ikm = new Uint8Array(shared.length + epk.length)
  ikm.set(shared, 0)
  ikm.set(epk, shared.length)
  return hkdf(sha256, ikm, undefined, WRAP_INFO, 32)
}

/** Key order must not matter, so the descriptor is serialised with sorted keys. */
function aad(descriptor: GrantDescriptor): ArrayBuffer {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(descriptor).sort()) {
    sorted[key] = descriptor[key]
  }
  return buffer(new TextEncoder().encode(JSON.stringify(sorted)))
}

/** WebCrypto takes ArrayBuffer-backed data; noble and viem return views. */
const buffer = (view: Uint8Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer
