import type { AbortError } from 'iso-web/http'
import {
  type Address,
  type Chain,
  type Client,
  type GetBlockNumberErrorType,
  type GetContractEventsErrorType,
  isAddressEqual,
  type Transport,
} from 'viem'
import { getBlockNumber, getContractEvents } from 'viem/actions'
import { asChain } from '../chains.ts'
import { throwIfAborted } from '../utils/abort.ts'

/**
 * Default number of blocks per `eth_getLogs` request. Stays under common RPC
 * limits (e.g. Glif caps a request at 360 blocks).
 */
export const DEFAULT_FIND_AUTHORIZER_BLOCK_RANGE = 300n

export namespace findAuthorizer {
  export type OptionsType = {
    /** The session key address to look up. */
    signer: Address
    /** First block to scan (inclusive), e.g. the block when the session key was created. */
    fromBlock: bigint
    /** Last block to scan (inclusive). Defaults to the latest block. */
    toBlock?: bigint
    /** Blocks per `eth_getLogs` request. Defaults to {@link DEFAULT_FIND_AUTHORIZER_BLOCK_RANGE}. */
    blockRange?: bigint
    /** Session key registry contract address. If not provided, defaults to the chain contract address. */
    contractAddress?: Address
    /** Abort the scan between requests. */
    signal?: AbortSignal
  }

  /** The root wallet that authorized the session key, or `undefined` if none was found in the range. */
  export type OutputType = Address | undefined

  export type ErrorType = asChain.ErrorType | GetBlockNumberErrorType | GetContractEventsErrorType | AbortError
}

/**
 * Find the wallet (identity) that authorized a session key.
 *
 * Scans `AuthorizationsUpdated` events on the session key registry from `toBlock` back to `fromBlock`,
 * in windows of `blockRange` blocks, and returns the identity of the most recent authorization whose
 * `signer` is the session key. Revocations (events with a zero expiry) are ignored.
 *
 * The registry does not index `signer`, so the match happens locally. Keep `fromBlock` close to the
 * block when the session key was created to limit the number of requests.
 *
 * The result only says who authorized the key; use {@link authorizationExpiry} or
 * {@link getExpirations} to check which permissions are still valid.
 *
 * @param client - The client to use to read the logs.
 * @param options - {@link findAuthorizer.OptionsType}
 * @returns The authorizing wallet address, or `undefined` {@link findAuthorizer.OutputType}
 * @throws Errors {@link findAuthorizer.ErrorType}
 *
 * @example
 * ```ts
 * import { findAuthorizer } from '@filoz/synapse-core/session-key'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const root = await findAuthorizer(client, {
 *   signer: '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd',
 *   fromBlock: 3_000_000n,
 * })
 * ```
 */
export async function findAuthorizer(
  client: Client<Transport, Chain>,
  options: findAuthorizer.OptionsType
): Promise<findAuthorizer.OutputType> {
  const chain = asChain(client.chain)
  const blockRange = options.blockRange ?? DEFAULT_FIND_AUTHORIZER_BLOCK_RANGE
  if (blockRange < 1n) {
    throw new Error('`blockRange` must be at least 1.')
  }
  const fromBlock = options.fromBlock
  throwIfAborted(options.signal)
  const toBlock = options.toBlock ?? (await getBlockNumber(client, { cacheTime: 0 }))
  const address = options.contractAddress ?? chain.contracts.sessionKeyRegistry.address

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
    for (let i = logs.length - 1; i >= 0; i--) {
      const { args } = logs[i]
      if (args.expiry > 0n && isAddressEqual(args.signer, options.signer)) {
        return args.identity
      }
    }
    end = start - 1n
  }
  return undefined
}
