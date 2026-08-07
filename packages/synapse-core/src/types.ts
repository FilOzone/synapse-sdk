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
  chain extends Chain = Chain,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
> = Client<transport, chain, undefined, rpcSchema, extended>

/**
 * Wallet/account client for write actions.
 *
 * Viem's simulate/write inference breaks when the Client chain type param is a
 * generic, so the underlying Client is typed with concrete {@link Chain} while
 * still exposing the caller's `chain` type on the client value.
 */
export type AccountClient<
  chain extends Chain = Chain,
  account extends Account = Account,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
> = Client<transport, Chain, account, rpcSchema, extended> & {
  chain: chain
}

export type SessionKeyClient<
  chain extends Chain = Chain,
  account extends SessionKeyAccount<'Secp256k1'> = SessionKeyAccount<'Secp256k1'>,
  transport extends Transport = Transport,
  rpcSchema extends RpcSchema | undefined = undefined,
  extended extends Extended | undefined = Extended | undefined,
> = Client<transport, chain, account, rpcSchema, extended>
