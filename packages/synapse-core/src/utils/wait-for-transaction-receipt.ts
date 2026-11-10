import {
  BaseError,
  type Chain,
  type Client,
  type Transport,
  type WaitForTransactionReceiptParameters,
  type WaitForTransactionReceiptReturnType,
  WaitForTransactionReceiptTimeoutError,
} from 'viem'
import { waitForTransactionReceipt as viemWaitForTransactionReceipt } from 'viem/actions'

/**
 * Lotus answers `eth_getBlockByNumber` for a null round (an epoch without a block) with this JSON-RPC error code.
 */
const LOTUS_NULL_ROUND_ERROR_CODE = 12

/** viem's default `waitForTransactionReceipt` timeout. */
const DEFAULT_TIMEOUT = 180_000

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
 * viem's `waitForTransactionReceipt`, tolerant of Filecoin null rounds.
 *
 * While the receipt is missing, viem fetches every block it polls, missed heights included, to look
 * for a replacement, and treats any error other than a missing block as fatal. Lotus answers a null
 * round with an error, which would abort the wait. A null round holds no transactions, so there is
 * nothing to miss by skipping it: this starts a new wait within the same `timeout` instead.
 *
 * Takes the same parameters as viem's action. A `timeout` of `0` waits without a deadline, like viem.
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
export async function waitForTransactionReceipt<chain extends Chain | undefined>(
  client: Client<Transport, chain>,
  parameters: WaitForTransactionReceiptParameters<chain>
): Promise<WaitForTransactionReceiptReturnType<chain>> {
  const timeout = parameters.timeout ?? DEFAULT_TIMEOUT
  const deadline = timeout ? Date.now() + timeout : undefined
  const pollingInterval = parameters.pollingInterval ?? client.pollingInterval
  while (true) {
    const remaining = deadline == null ? 0 : deadline - Date.now()
    if (deadline != null && remaining <= 0) {
      throw new WaitForTransactionReceiptTimeoutError({ hash: parameters.hash })
    }
    try {
      return await viemWaitForTransactionReceipt(client, { ...parameters, timeout: remaining })
    } catch (error) {
      if (!isNullRoundError(error)) {
        throw error
      }
    }
    // Wait one polling interval so the next wait starts from a later head
    const pause = deadline == null ? pollingInterval : Math.min(pollingInterval, Math.max(deadline - Date.now(), 0))
    await new Promise((resolve) => setTimeout(resolve, pause))
  }
}
