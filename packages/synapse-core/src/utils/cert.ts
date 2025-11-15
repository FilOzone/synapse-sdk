import type { TypedDataToPrimitiveTypes } from 'abitype'
import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { bytesToBigInt, bytesToHex, concat, hexToBytes, numberToHex, recoverTypedDataAddress } from 'viem'
import { signTypedData } from 'viem/actions'
import { randU256 } from '../utils/rand.ts'

export type Endorsement = {
  /**
   * Unique nonce to suport nonce based revocation.
   */
  nonce: bigint
  /**
   * This certificate becomes invalid after `notAfter` timestamp.
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
  notAfter: bigint // uint64
  providerId: bigint
} /**
 * Signs a certificate that a provider is super good enough.
 * @param client - The client to use to sign the message
 * @param options - nonce (randomised if null), not after and who to sign it for
 * @returns encoded certificate data abiEncodePacked([nonce, notAfter, signature]), the provider id is implicit by where it will get placed in registry.
 */
export async function signEndorsement(client: Client<Transport, Chain, Account>, options: SignCertOptions) {
  const nonce = (options.nonce ?? randU256()) & 0xffffffffffffffffn
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
      providerId: options.providerId,
    },
  })

  // 16 because size is after hex encoding
  const encodedNonce = numberToHex(nonce, { size: 8 })
  const encodedNotAfter = numberToHex(options.notAfter, { size: 8 })

  return concat([encodedNonce, encodedNotAfter, signature])
}

export async function decodeEndorsement(
  providerId: bigint,
  chainId: number | bigint | undefined,
  hexData: Hex
): Promise<{
  address: Address | null
  endorsement: SignedEndorsement
}> {
  if (hexData.length !== 164) {
    return {
      address: null,
      endorsement: {
        nonce: 0n,
        notAfter: 0n,
        signature: '0x',
      },
    }
  }
  const data = hexToBytes(hexData)
  const endorsement: SignedEndorsement = {
    nonce: bytesToBigInt(data.slice(0, 8)),
    notAfter: bytesToBigInt(data.slice(8, 16)),
    signature: bytesToHex(data.slice(16)),
  }
  const address = await recoverTypedDataAddress({
    domain: {
      name: 'Storage Endorsement',
      version: '1',
      chainId,
    },
    types: EIP712Endorsement,
    primaryType: 'Endorsement',
    message: {
      nonce: endorsement.nonce,
      notAfter: endorsement.notAfter,
      providerId: providerId,
    },
    signature: endorsement.signature,
  }).catch((reason) => {
    console.warn('Failed to recover product endorsement:', reason)
    return null
  })
  return { address, endorsement }
}

/**
 * Validates endorsement capabilities, if any, filtering out invalid ones
 * @returns mapping of valid endorsements to expiry, nonce, signature
 */
export async function decodeEndorsements(
  providerId: bigint,
  chainId: number | bigint,
  capabilities: Record<string, Hex>
): Promise<Record<Address, SignedEndorsement>> {
  const now = Date.now() / 1000
  return await Promise.all(
    Object.values(capabilities).map((capabilityValue) => decodeEndorsement(providerId, chainId, capabilityValue))
  ).then((results) =>
    results.reduce(
      (endorsements, { address, endorsement }) => {
        if (address != null && endorsement.notAfter > now) {
          endorsements[address] = endorsement
        }
        return endorsements
      },
      {} as Record<Address, SignedEndorsement>
    )
  )
}

/**
 * @returns a list of capability keys and a list of capability values for the ServiceProviderRegistry
 */
export function encodeEndorsements(endorsements: Record<Address, SignedEndorsement>): [string[], Hex[]] {
  const keys: string[] = []
  const values: Hex[] = []
  Object.values(endorsements).forEach((value, index) => {
    keys.push(`endorsement${index.toString()}`)
    values.push(
      concat([numberToHex(value.nonce, { size: 8 }), numberToHex(value.notAfter, { size: 8 }), value.signature])
    )
  })
  return [keys, values]
}
