import {
  BaseError,
  type Chain,
  type Client,
  type EIP1193RequestFn,
  type Transport,
  type WaitForTransactionReceiptParameters,
  type WaitForTransactionReceiptReturnType,
} from 'viem'
import { waitForTransactionReceipt as viemWaitForTransactionReceipt } from 'viem/actions'

/**
 * Lotus answers `eth_getBlockByNumber` for a null round (an epoch without a block) with this JSON-RPC error code.
 */
const LOTUS_NULL_ROUND_ERROR_CODE = 12

/**
 * Whether the error is Lotus refusing to return a block for a Filecoin null round.
 *
 * @param error - The error to check.
 * @returns True when the error, or any error in its cause chain, is a null round error.
 */
export function isNullRoundError(error: unknown): boolean {
  if (!(error instanceof BaseError)) {
    return false
  }
  return (
    error.walk(
      (cause) =>
        (cause as { code?: unknown }).code === LOTUS_NULL_ROUND_ERROR_CODE ||
        /null round/i.test((cause as { details?: unknown }).details?.toString() ?? '')
    ) != null
  )
}

/**
 * A copy of the client whose `eth_getBlockByNumber` answers a null round with an empty block.
 *
 * Only the base client properties are copied: viem actions prefer an action method already bound on
 * the client (e.g. a public client's `getBlock`), which would bypass the wrapped `request`.
 */
function skippingNullRounds<chain extends Chain | undefined>(
  client: Client<Transport, chain>
): Client<Transport, chain> {
  const request = (async (args, options) => {
    try {
      return await client.request(args as Parameters<typeof client.request>[0], options)
    } catch (error) {
      if (args.method !== 'eth_getBlockByNumber' || !isNullRoundError(error)) {
        throw error
      }
      const [blockNumber] = args.params as [string]
      return { number: blockNumber, hash: null, transactions: [] }
    }
  }) as EIP1193RequestFn
  return {
    account: client.account,
    batch: client.batch,
    cacheTime: client.cacheTime,
    ccipRead: client.ccipRead,
    chain: client.chain,
    dataSuffix: client.dataSuffix,
    experimental_blockTag: client.experimental_blockTag,
    key: client.key,
    name: client.name,
    pollingInterval: client.pollingInterval,
    request,
    transport: client.transport,
    type: client.type,
    uid: client.uid,
  } as Client<Transport, chain>
}

/**
 * viem's `waitForTransactionReceipt`, tolerant of Filecoin null rounds.
 *
 * While the receipt is missing, viem fetches every block it polls, missed heights included, to look
 * for a replacement, and treats any error other than a missing block as fatal. Lotus answers a null
 * round with an error, which would abort the wait. A null round holds no transactions, so the block
 * lookups of this wait see it as an empty block and the scan carries on to the next height.
 *
 * Takes the same parameters as viem's action.
 *
 * @example
 * ```ts
 * import { waitForTransactionReceipt } from '@filoz/synapse-core/utils'
 *
 * const receipt = await waitForTransactionReceipt(client, { hash })
 * ```
 *
 * @param client - The client to read the chain with.
 * @param parameters - viem's {@link WaitForTransactionReceiptParameters}.
 * @returns The transaction receipt.
 * @throws Errors viem's `waitForTransactionReceipt` throws, except null round errors.
 */
export function waitForTransactionReceipt<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
  parameters: WaitForTransactionReceiptParameters<chain>
): Promise<WaitForTransactionReceiptReturnType<chain>> {
  return viemWaitForTransactionReceipt(skippingNullRounds(client), parameters)
}
