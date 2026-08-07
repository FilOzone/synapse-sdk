import type { Address, Chain, MulticallErrorType } from 'viem'
import { multicall } from 'viem/actions'
import { paginate } from '../pagination.ts'
import type { ReadClient } from '../types.ts'
import { getRailCall } from './get-rail.ts'
import { getRailsForPayerAndToken } from './get-rails-for-payer-and-token.ts'

export namespace totalAccountFixedLockup {
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
 * @param client - The read-only client to use to get the total account fixed lockup.
 * @param options - {@link totalAccountFixedLockup.OptionsType}
 * @returns The total fixed lockup and active rail count {@link totalAccountFixedLockup.OutputType}
 * @throws Errors {@link totalAccountFixedLockup.ErrorType}
 *
 * @example
 * ```ts
 * import { totalAccountFixedLockup } from '@filoz/synapse-core/pay'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const lockup = await totalAccountFixedLockup(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log('Total fixed lockup:', lockup.totalFixedLockup)
 * ```
 */
export async function totalAccountFixedLockup<chain extends Chain>(
  client: ReadClient<chain>,
  options: totalAccountFixedLockup.OptionsType
): Promise<totalAccountFixedLockup.OutputType> {
  let totalFixedLockup = 0n
  let rails: Array<getRailsForPayerAndToken.OutputType['items'][number]> = []

  const processPage = async () => {
    if (rails.length > 0) {
      const railDetails = await multicall(client, {
        allowFailure: false,
        contracts: rails.map((rail) =>
          getRailCall({
            chain: client.chain,
            railId: rail.railId,
            contractAddress: options.contractAddress,
          })
        ),
      })
      for (const rail of railDetails) {
        totalFixedLockup += rail.lockupFixed
      }
    }
    rails = []
  }

  for await (const rail of paginate(({ cursor }) =>
    getRailsForPayerAndToken(client, {
      payer: options.address,
      token: options.token,
      contractAddress: options.contractAddress,
      cursor,
      limit: 100n,
    })
  )) {
    rails.push(rail)
    if (rails.length === 100) {
      await processPage()
    }
  }
  await processPage()
  return { totalFixedLockup }
}
