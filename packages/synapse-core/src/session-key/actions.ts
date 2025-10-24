import type { Account, Address, Chain, Client, Transport } from 'viem'
import { type ReadContractErrorType, readContract, simulateContract, writeContract } from 'viem/actions'
import { getChain } from '../chains.ts'
import { SESSION_KEY_PERMISSIONS, type SessionKeyPermissions } from './permissions.ts'

export type GetExpiryOptions = {
  /**
   * The address of the account to query.
   */
  address: Address
  sessionAddress: Address
  permission: SessionKeyPermissions
}

/**
 * Check the expiry of the session key.
 *
 * @param client - The client to use.
 * @param options - The options to use.
 * @returns The account info including funds, lockup details, and available balance.
 * @throws - {@link ReadContractErrorType} if the read contract fails.
 */
export async function getExpiry(client: Client<Transport, Chain>, options: GetExpiryOptions): Promise<bigint> {
  const chain = getChain(client.chain.id)
  const expiry = await readContract(client, {
    address: chain.contracts.sessionKeyRegistry.address,
    abi: chain.contracts.sessionKeyRegistry.abi,
    functionName: 'authorizationExpiry',
    args: [options.address, options.sessionAddress, SESSION_KEY_PERMISSIONS[options.permission]],
  })

  return expiry
}

export type IsExpiredOptions = {
  /**
   * The address of the account to query.
   */
  address: Address
  sessionAddress: Address
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
  const expiry = await getExpiry(client, options)

  return expiry < BigInt(Math.floor(Date.now() / 1000))
}

export type LoginOptions = {
  sessionAddress: Address
  permissions: SessionKeyPermissions[]
  expiresAt?: bigint
}

export async function login(client: Client<Transport, Chain, Account>, options: LoginOptions) {
  const chain = getChain(client.chain.id)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600)

  const { request } = await simulateContract(client, {
    address: chain.contracts.sessionKeyRegistry.address,
    abi: chain.contracts.sessionKeyRegistry.abi,
    functionName: 'login',
    args: [
      options.sessionAddress,
      options.expiresAt ?? expiresAt,
      [...new Set(options.permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      'synapse',
    ],
  })

  const hash = await writeContract(client, request)
  return hash
}

export type RevokeOptions = {
  identity: Address
  signer: Address
  expiresAt: bigint
  permissions: SessionKeyPermissions[]
  origin: string
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
  const chain = getChain(client.chain.id)
  const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 3600)

  const { request } = await simulateContract(client, {
    address: chain.contracts.sessionKeyRegistry.address,
    abi: chain.contracts.sessionKeyRegistry.abi,
    functionName: 'revoke',
    args: [
      options.identity,
      // @ts-ignore
      options.signer,
      // @ts-ignore
      options.expiresAt ?? expiresAt,
      [...new Set(options.permissions)].map((permission) => SESSION_KEY_PERMISSIONS[permission]),
      options.origin,
    ],
  })
  const hash = await writeContract(client, request)
  return hash
}
