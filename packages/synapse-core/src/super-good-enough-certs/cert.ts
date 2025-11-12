import type { TypedDataToPrimitiveTypes } from 'abitype'
import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { encodeAbiParameters } from 'viem'
import { signTypedData } from 'viem/actions'
import { randU256 } from '../utils/rand.ts'

export type Cert = {
  /**
   * Unique nonce to suport nonce based revocation.
   */
  nonce: bigint
  /**
   * This certificate becomes invalid after `notAfter` epoch.
   */
  notAfter: bigint
}

export type SignedCert = Cert & {
  signature: Hex
}

export const EIP712Cert = {
  Cert: [
    { name: 'nonce', type: 'uint256' },
    { name: 'notAfter', type: 'uint256' },
    { name: 'providerId', type: 'uint256' },
  ],
} as const

export type TypedCert = TypedDataToPrimitiveTypes<typeof EIP712Cert>['Cert']

export type SignCertOptions = {
  nonce?: bigint
  notAfter: bigint
  provider: bigint
} /**
 * Signs a certificate that a provider is super good enough.
 * @param client - The client to use to sign the message
 * @param options - nonce (randomised if null), not after and who to sign it for
 * @returns encoded certificate data abiEncode([nonce, notAfter, signature]), the provider id is implicit by where it will get placed in registry.
 */
export async function signCert(client: Client<Transport, Chain, Account>, options: SignCertOptions) {
  const nonce = options.nonce ?? randU256()
  const signature = await signTypedData(client, {
    account: client.account,
    domain: {
      name: 'Super Good Enough Storage Provider Certificate',
      version: '1',
      chainId: client.chain.id,
      verifyingContract: '0x0',
    },
    types: EIP712Cert,
    primaryType: 'Cert',
    message: {
      nonce: nonce,
      notAfter: options.notAfter,
      providerId: options.provider,
    },
  })

  const data = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
    [nonce, options.notAfter, signature]
  )

  return data
}

/**
 * Validates endorsement capabilities, if any, filtering out invalid ones
 * @returns mapping of valid endorsements to expiry, nonce, signature
 */
export function decodeEndorsements(capabilities: Record<string, Hex>): Record<Address, SignedCert> {
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
