import type { Account, Address } from 'viem'

/**
 * Get the address that pays for an account's storage: a session key signs as itself, but its root wallet pays.
 *
 * @param account - The client account.
 * @returns The root address for a session key account, otherwise the account address.
 *
 * @example
 * ```ts
 * import { getPayerAddress } from '@filoz/synapse-core/utils'
 *
 * const payer = getPayerAddress(client.account)
 * ```
 */
export function getPayerAddress(account: Account): Address {
  if ('rootAddress' in account && typeof account.rootAddress === 'string') {
    return account.rootAddress as Address
  }
  return account.address
}
