import type { TypedDataToPrimitiveTypes } from 'abitype'
import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import {
  bytesToBigInt,
  bytesToHex,
  concat,
  encodeAbiParameters,
  hexToBigInt,
  hexToBytes,
  hexToNumber,
  numberToBytes,
  numberToHex,
} from 'viem'
import { signTypedData, verifyTypedData } from 'viem/actions'
import { randU256 } from '../utils/rand.ts'

export type Endorsement = {
  /**
   * Unique nonce to suport nonce based revocation.
   */
  nonce: bigint
  /**
   * This certificate becomes invalid after `notAfter` epoch.
   */
  notAfter: bigint
}

export type SignedEndorsement = Endorsement & {
  signature: Hex
}

export const EIP712Endorsement = {
  Endorsement: [
    { name: 'nonce', type: 'uint64' },
    { name: 'notAfter', type: 'uint64' },
    { name: 'providerId', type: 'uint256' },
  ],
} as const

export type TypedEn = TypedDataToPrimitiveTypes<typeof EIP712Endorsement>['Endorsement']

export type SignCertOptions = {
  nonce?: bigint // uint64
  notAfter: bigint //uint64
  provider: bigint
} /**
 * Signs a certificate that a provider is super good enough.
 * @param client - The client to use to sign the message
 * @param options - nonce (randomised if null), not after and who to sign it for
 * @returns encoded certificate data abiEncode([nonce, notAfter, signature]), the provider id is implicit by where it will get placed in registry.
 */
export async function signEndorsement(client: Client<Transport, Chain, Account>, options: SignCertOptions) {
  const nonce = options.nonce ?? randU256()
  const signature = await signTypedData(client, {
    account: client.account,
    domain: {
      name: 'Storage Endorsement',
      version: '1',
      chainId: client.chain.id,
    },
    types: EIP712Endorsement,
    primaryType: 'Endorsement',
    message: {
      nonce: nonce,
      notAfter: options.notAfter,
      providerId: options.provider,
    },
  })

  // 16 because size is after hex encoding
  const encodedNonce = numberToHex(nonce, { size: 16 })
  const encodedNotAfter = numberToHex(options.notAfter, { size: 16 })

  const data = concat([encodedNonce, encodedNotAfter, signature])

  return data
}

async function decodeEndorsement(
  client: Client<Transport, Chain, Account>,
  address: Address,
  providerId: bigint,
  hexData: Hex
) {
  const data = hexToBytes(hexData)
  const endorsement: SignedEndorsement = {
    nonce: bytesToBigInt(data.slice(0, 8)),
    notAfter: bytesToBigInt(data.slice(8, 16)),
    signature: bytesToHex(data.slice(16)),
  }
  const valid = await verifyTypedData(client, {
    address,
    domain: {
      name: 'Storage Endorsement',
      version: '1',
      chainId: client.chain.id,
    },
    types: EIP712Endorsement,
    primaryType: 'Endorsement',
    message: {
      nonce: endorsement.nonce,
      notAfter: endorsement.notAfter,
      providerId: providerId,
    },
    signature: endorsement.signature,
  })
  if (!valid) {
    return undefined
  }
  return endorsement
}

/**
 * Validates endorsement capabilities, if any, filtering out invalid ones
 * @returns mapping of valid endorsements to expiry, nonce, signature
 */
export function decodeEndorsements(capabilities: Record<string, Hex>): Record<Address, SignedEndorsement> {
  // TODO
  return {
    '0x2127C3a31F54B81B5E9AD1e29C36c420d3D6ecC5': {
      notAfter: 0xffffffffn,
      nonce: 0xffffffffn,
      signature:
        '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    },
  }
}
