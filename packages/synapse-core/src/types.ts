import type { Chain, Hash, Log, WaitForTransactionReceiptReturnType } from 'viem'

/**
 * Actions types
 */

/** Action call chain options */
export type ActionCallChain = {
  /** The chain to use to make the call. */
  chain: Chain
}

/** Action sync callback options */
export type ActionSyncCallback = {
  /** Callback function called with the transaction hash before waiting for the receipt. */
  onHash?: (hash: Hash) => void
}

/** Action sync output type */
export type ActionSyncOutput<ExtractFn extends (logs: Log[]) => any, chain extends Chain | undefined = undefined> = {
  /** The transaction receipt */
  receipt: WaitForTransactionReceiptReturnType<chain>
  /** The extracted event */
  event: ReturnType<ExtractFn>
}
