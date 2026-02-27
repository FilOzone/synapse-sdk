import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { getRailCall } from './get-rail.ts'
import { getRailsForPayerAndToken } from './get-rails-for-payer-and-token.ts'

export namespace totalAccountLockup {
  export type OptionsType = {
    /** The address of the account to query. */
    address: Address
    /** The address of the ERC20 token to query. If not provided, the USDFC token address will be used. */
    token?: Address
    /** Payments contract address. If not provided, the default is the payments contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = {
    /** Sum of lockupFixed across all rails (including terminated but not yet finalized) */
    totalFixedLockup: bigint
  }

  export type ErrorType = getRailsForPayerAndToken.ErrorType | MulticallErrorType
}

/**
 * Get the total fixed lockup across all rails for an account.
 *
 * Fetches all rails for the payer, then batches `getRail` calls via multicall
 * to sum `lockupFixed`. Includes terminated-but-not-finalized rails since they
 * still hold locked funds until finalization.
 *
 * @param client - The client to use for the query.
 * @param options - {@link totalAccountLockup.OptionsType}
 * @returns The total fixed lockup and active rail count {@link totalAccountLockup.OutputType}
 * @throws Errors {@link totalAccountLockup.ErrorType}
 *
 * @example
 * ```ts
 * import { totalAccountLockup } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const lockup = await totalAccountLockup(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log('Total fixed lockup:', lockup.totalFixedLockup)
 * ```
 */
export async function totalAccountLockup(
  client: Client<Transport, Chain>,
  options: totalAccountLockup.OptionsType
): Promise<totalAccountLockup.OutputType> {
  const { results } = await getRailsForPayerAndToken(client, {
    payer: options.address,
    token: options.token,
    contractAddress: options.contractAddress,
  })

  if (results.length === 0) {
    return { totalFixedLockup: 0n }
  }

  const railDetails = await multicall(client, {
    allowFailure: false,
    contracts: results.map((rail) =>
      getRailCall({
        chain: client.chain,
        railId: rail.railId,
        contractAddress: options.contractAddress,
      })
    ),
  })

  let totalFixedLockup = 0n
  for (const rail of railDetails) {
    totalFixedLockup += rail.lockupFixed
  }

  return { totalFixedLockup }
}
