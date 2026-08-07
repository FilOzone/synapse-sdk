/**
 * USDFC Contract Operations
 *
 * @example
 * ```ts
 * import * as USDFC from '@filoz/synapse-core/usdfc'
 * ```
 *
 * @module usdfc
 */

import type { Account, Chain, Client, Transport } from 'viem'
import { watchAsset } from 'viem/actions'
import { asChain } from './chains.ts'

/**
 * Requests that the user tracks the token in their wallet. Returns a boolean indicating if the token was successfully added.
 * @see https://viem.sh/docs/actions/watchAsset.html
 *
 * @param client - The client to use.
 * @returns The result of the watchAsset call.
 */
export async function watchUsdfc(client: Client<Transport, Chain, Account>) {
  const chain = asChain(client.chain)
  const token = chain.contracts.usdfc.address

  const result = await watchAsset(client, {
    type: 'ERC20',
    options: {
      address: token,
      symbol: 'USDFC',
      decimals: 18,
      image: 'https://app.usdfc.net/apple-touch-icon.png',
    },
  })

  return result
}
