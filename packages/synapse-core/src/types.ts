import type { Simplify } from 'type-fest'
import type { Chain, Hash, Log, WaitForTransactionReceiptReturnType } from 'viem'
import type { PaginationOptions } from './pagination.ts'

export type * from './warm-storage/types.ts'

/**
 * Actions types
 */

/** Action call chain options */
export type ActionCallChain = {
  /** The chain to use to make the call. */
  chain: Chain
}

/** Convert normalized action pagination into required contract-facing call arguments. */
export type PaginatedActionCallOptions<Options extends PaginationOptions, CursorName extends string> = Simplify<
  Omit<Options, keyof PaginationOptions> &
    ActionCallChain &
    Record<CursorName, bigint> & {
      limit: bigint
    }
>

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
