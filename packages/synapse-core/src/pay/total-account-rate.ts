import type { Address, Chain, Client, Transport } from 'viem'
import { TIME_CONSTANTS } from '../utils/constants.ts'
import { accounts } from './accounts.ts'

export namespace totalAccountRate {
  export type OptionsType = {
    /** The address of the account to query. */
    address: Address
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = {
    /** Aggregate spend rate per epoch (from accounts().lockupRate) */
    ratePerEpoch: bigint
    /** ratePerEpoch * EPOCHS_PER_MONTH (86400n) */
    ratePerMonth: bigint
  }

  export type ErrorType = accounts.ErrorType
}

/**
 * Get the total account rate across all active rails.
 *
 * Returns the aggregate lockup rate in both per-epoch and per-month units.
 * The per-epoch rate comes directly from the Payments contract `accounts()` view.
 * The per-month rate is `ratePerEpoch * EPOCHS_PER_MONTH` (86400).
 *
 * @param client - The client to use for the query.
 * @param options - {@link totalAccountRate.OptionsType}
 * @returns The account rates {@link totalAccountRate.OutputType}
 * @throws Errors {@link totalAccountRate.ErrorType}
 *
 * @example
 * ```ts
 * import { totalAccountRate } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const rate = await totalAccountRate(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log('Per epoch:', rate.ratePerEpoch)
 * console.log('Per month:', rate.ratePerMonth)
 * ```
 */
export async function totalAccountRate(
  client: Client<Transport, Chain>,
  options: totalAccountRate.OptionsType
): Promise<totalAccountRate.OutputType> {
  const accountInfo = await accounts(client, {
    address: options.address,
    token: options.token,
    contractAddress: options.contractAddress,
  })

  const ratePerEpoch = accountInfo.lockupRate

  return {
    ratePerEpoch,
    ratePerMonth: ratePerEpoch * TIME_CONSTANTS.EPOCHS_PER_MONTH,
  }
}
