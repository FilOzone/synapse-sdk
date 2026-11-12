import type { AbortError } from 'iso-web/http'
import {
  type Address,
  type Chain,
  type Client,
  type GetBlockNumberErrorType,
  type GetContractEventsErrorType,
  type Hash,
  type Hex,
  isAddressEqual,
  type Transport,
} from 'viem'
import { getBlockNumber, getContractEvents } from 'viem/actions'
import { asChain } from '../chains.ts'
import { ValidationError } from '../errors/base.ts'
import { throwIfAborted } from '../utils/abort.ts'

/**
 * Default number of blocks per `eth_getLogs` request. Stays under common RPC
 * limits (e.g. Glif caps a request at 360 blocks).
 */
export const DEFAULT_FIND_AUTHORIZERS_BLOCK_RANGE = 300n

export namespace findAuthorizers {
  export type OptionsType = {
    /** The session key address to look up. */
    signer: Address
    /** First block to scan (inclusive), e.g. the block when the session key was created. */
    fromBlock: bigint
    /** Last block to scan (inclusive). Defaults to the latest block. */
    toBlock?: bigint
    /** Blocks per `eth_getLogs` request. Defaults to {@link DEFAULT_FIND_AUTHORIZERS_BLOCK_RANGE}. */
    blockRange?: bigint
    /** Session key registry contract address. If not provided, defaults to the chain contract address. */
    contractAddress?: Address
    /** Abort the scan between requests. */
    signal?: AbortSignal
  }

  /** A wallet that authorized the session key, described by its most recent authorization in the range. */
  export type Authorizer = {
    /** The wallet (root identity) that called `login` for the session key. */
    identity: Address
    /** Expiry of the authorization, as a Unix timestamp in seconds. */
    expiry: bigint
    /** Permission hashes granted by the authorization. */
    permissions: Hex[]
    /** Origin string passed to `login`. */
    origin: string
    /** Block that included the authorization. */
    blockNumber: bigint
    /** Transaction that emitted the authorization. */
    transactionHash: Hash
  }

  /** One entry per distinct wallet, most recent authorization first. Empty if none was found in the range. */
  export type OutputType = Authorizer[]

  export type ErrorType =
    | asChain.ErrorType
    | GetBlockNumberErrorType
    | GetContractEventsErrorType
    | AbortError
    | ValidationError
}

/**
 * Find every wallet (identity) that authorized a session key.
 *
 * Scans `AuthorizationsUpdated` events on the session key registry from `toBlock` back to `fromBlock`,
 * in windows of `blockRange` blocks, and returns one entry per distinct identity that authorized
 * `signer`, ordered by its most recent authorization (newest first). Revocations (zero expiry) and
 * authorizations with no permissions are ignored.
 *
 * **Treat more than one result as a red flag.** `SessionKeyRegistry.login` needs no consent from the
 * signer, so any wallet that knows the session key address can authorize it, for instance after seeing
 * the real authorization on-chain. Another wallet can add an authorization but cannot remove yours, so
 * for a freshly created key exactly one result is expected. When there are several, do not pick one:
 * stop, or ask the user which wallet is theirs. Even with one result, show the address to the user to
 * confirm before binding to it or sending data to the account it controls.
 *
 * The registry does not index `signer`, so the match happens locally and the whole range is scanned.
 * Keep `fromBlock` close to the block when the session key was created to limit the number of requests.
 *
 * The result does not say which permissions are still valid; use {@link authorizationExpiry} or
 * {@link getExpirations} for that.
 *
 * @param client - The client to use to read the logs.
 * @param options - {@link findAuthorizers.OptionsType}
 * @returns The wallets that authorized the session key {@link findAuthorizers.OutputType}
 * @throws Errors {@link findAuthorizers.ErrorType}
 *
 * @example
 * ```ts
 * import { findAuthorizers } from '@filoz/synapse-core/session-key'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const authorizers = await findAuthorizers(client, {
 *   signer: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 *   fromBlock: 3_000_000n,
 * })
 *
 * if (authorizers.length !== 1) {
 *   throw new Error(`Expected one authorizing wallet, found ${authorizers.length}`)
 * }
 * const root = authorizers[0].identity
 * ```
 */
export async function findAuthorizers(
  client: Client<Transport, Chain>,
  options: findAuthorizers.OptionsType
): Promise<findAuthorizers.OutputType> {
  const chain = asChain(client.chain)
  const blockRange = options.blockRange ?? DEFAULT_FIND_AUTHORIZERS_BLOCK_RANGE
  if (blockRange < 1n) {
    throw new ValidationError('`blockRange` must be at least 1.')
  }
  const fromBlock = options.fromBlock
  throwIfAborted(options.signal)
  const toBlock = options.toBlock ?? (await getBlockNumber(client, { cacheTime: 0 }))
  const address = options.contractAddress ?? chain.contracts.sessionKeyRegistry.address

  const authorizers: findAuthorizers.Authorizer[] = []
  let end = toBlock
  while (end >= fromBlock) {
    throwIfAborted(options.signal)
    const start = end - blockRange + 1n > fromBlock ? end - blockRange + 1n : fromBlock
    const logs = await getContractEvents(client, {
      address,
      abi: chain.contracts.sessionKeyRegistry.abi,
      eventName: 'AuthorizationsUpdated',
      fromBlock: start,
      toBlock: end,
      strict: true,
    })
    // Newest first, so the first event seen for an identity is its most recent authorization.
    for (let i = logs.length - 1; i >= 0; i--) {
      const { args, blockNumber, transactionHash } = logs[i]
      if (args.expiry === 0n || args.permissions.length === 0 || !isAddressEqual(args.signer, options.signer)) {
        continue
      }
      if (authorizers.some((a) => isAddressEqual(a.identity, args.identity))) {
        continue
      }
      authorizers.push({
        identity: args.identity,
        expiry: args.expiry,
        permissions: [...args.permissions],
        origin: args.origin,
        blockNumber,
        transactionHash,
      })
    }
    end = start - 1n
  }
  return authorizers
}
