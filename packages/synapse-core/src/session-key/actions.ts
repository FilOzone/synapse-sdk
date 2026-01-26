import type { Account, Address, Chain, Client, Transport } from 'viem'
import { simulateContract, writeContract } from 'viem/actions'
import { asChain } from '../chains.ts'
import { authorizationExpiry } from './authorization-expiry.ts'
import { SESSION_KEY_PERMISSIONS, type SessionKeyPermissions } from './permissions.ts'

export type IsExpiredOptions = {
  /**
   * The address of the account to query.
   */
  address: Address
  sessionKeyAddress: Address
  permission: SessionKeyPermissions
}

/**
 * Check if the session key is expired.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The account info including funds, lockup details, and available balance.
 * @throws - {@link ReadContractErrorType} if the read contract fails.
 */
export async function isExpired(client: Client<Transport, Chain>, options: IsExpiredOptions): Promise<boolean> {
  const expiry = await authorizationExpiry(client, options)

  return expiry < BigInt(Math.floor(Date.now() / 1000))
}

export type LoginOptions = {
  /**
   * Session key address.
   */
  address: Address
  /**
   * The permissions of the session key.
   */
  permissions: SessionKeyPermissions[]
  /**
   * The expiry time of the session key.
   */
  expiresAt?: bigint
  /**
   * The origin of the session key.
   */
  origin?: string
}

export async function login(client: Client<Transport, Chain, Account>, options: LoginOptions) {
  const chain = asChain(client.chain)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600)

  const { request } = await simulateContract(client, {
    address: chain.contracts.sessionKeyRegistry.address,
    abi: chain.contracts.sessionKeyRegistry.abi,
    functionName: 'login',
    args: [
      options.address,
      options.expiresAt ?? expiresAt,
      [...new Set(options.permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      options.origin ?? 'synapse',
    ],
  })

  const hash = await writeContract(client, request)
  return hash
}

export type RevokeOptions = {
  /**
   * Session key address.
   */
  address: Address
  /**
   * The permissions of the session key.
   */
  permissions: SessionKeyPermissions[]
  /**
   * The origin of the session key.
   */
  origin?: string
}

/**
 * Revoke the session key.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The hash of the revoke transaction.
 * @throws - {@link SimulateContractErrorType} if the simulate contract fails.
 * @throws - {@link WriteContractErrorType} if the write contract fails.
 */
export async function revoke(client: Client<Transport, Chain, Account>, options: RevokeOptions) {
  const chain = asChain(client.chain)

  const { request } = await simulateContract(client, {
    address: chain.contracts.sessionKeyRegistry.address,
    abi: chain.contracts.sessionKeyRegistry.abi,
    functionName: 'revoke',
    args: [
      options.address,
      [...new Set(options.permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      options.origin ?? 'synapse',
    ],
  })
  const hash = await writeContract(client, request)
  return hash
}
