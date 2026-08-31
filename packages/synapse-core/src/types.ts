import type { Simplify } from 'type-fest'
import type {
  Account,
  Chain,
  Client,
  Hash,
  Log,
  Prettify,
  RpcSchema,
  Transport,
  WaitForTransactionReceiptReturnType,
} from 'viem'
import type { FilecoinChain } from './chains.ts'
import type { PaginationOptions } from './pagination.ts'
import type { SessionKeyAccount } from './session-key/types.ts'

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

export type Extended = Prettify<
  // disallow redefining base properties
  { [_ in keyof Client]?: undefined } & {
    [key: string]: unknown
  }
>

export type ReadClient<
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
  chain extends FilecoinChain = FilecoinChain,
  account extends Account | undefined = Account | undefined,
  transport extends Transport = Transport,
> = Client<transport, chain, account, rpcSchema, extended>

/**
 * Wallet/account client for write actions.
 */
export type AccountClient<
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
  chain extends FilecoinChain = FilecoinChain,
  account extends Account = Account,
  transport extends Transport = Transport,
> = Client<transport, chain, account, rpcSchema, extended>

export type SessionKeyClient<
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
  chain extends FilecoinChain = FilecoinChain,
  account extends SessionKeyAccount<'Secp256k1'> = SessionKeyAccount<'Secp256k1'>,
  transport extends Transport = Transport,
> = Client<transport, chain, account, rpcSchema, extended>
