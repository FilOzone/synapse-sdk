import type {
  Address,
  Chain,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
} from 'viem'
import { readContract } from 'viem/actions'
import type { fwssView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import {
  type Page,
  type PaginationOptions,
  pageFromLookahead,
  type paginate,
  resolvePagination,
} from '../pagination.ts'
import type { PaginatedActionCallOptions, ReadClient } from '../types.ts'

export namespace getApprovedProviderIds {
  export type OptionsType = PaginationOptions & {
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getApprovedProviders'
  >

  /** A page of approved provider IDs. */
  export type OutputType = Page<bigint>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of approved provider IDs.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page. `limit` must be greater than zero.
 *
 * @param client - The read-only client to use to get the approved providers.
 * @param options - {@link getApprovedProviderIds.OptionsType}
 * @returns A page of approved provider IDs {@link getApprovedProviderIds.OutputType}
 * @throws Errors {@link getApprovedProviderIds.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getApprovedProviderIds } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const page = await getApprovedProviderIds(client)
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getApprovedProviderIds } from '@filoz/synapse-core/warm-storage'
 *
 * for await (const providerId of paginate(({ cursor }) =>
 *   getApprovedProviderIds(client, { cursor })
 * )) {
 *   console.log(providerId)
 * }
 * ```
 */
export async function getApprovedProviderIds<chain extends Chain>(
  client: ReadClient<chain>,
  options: getApprovedProviderIds.OptionsType = {}
): Promise<getApprovedProviderIds.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  const data = await readContract(
    client,

    getApprovedProviderIdsCall({
      chain: client.chain,
      offset: cursor,
      limit: limit + 1n,
      contractAddress: options.contractAddress,
    })
  )
  return pageFromLookahead(data, limit, () => cursor + limit)
}

export namespace getApprovedProviderIdsCall {
  export type OptionsType = PaginatedActionCallOptions<getApprovedProviderIds.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getApprovedProviders'>
}

/**
 * Create a call to the {@link getApprovedProviderIds} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getApprovedProviderIdsCall.OptionsType}
 * @returns Call object {@link getApprovedProviderIdsCall.OutputType}
 * @throws Errors {@link getApprovedProviderIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getApprovedProviderIdsCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Paginate through providers in batches of 50
 * const results = await multicall(client, {
 *   contracts: [
 *     getApprovedProviderIdsCall({ chain: calibration, offset: 0n, limit: 50n }),
 *     getApprovedProviderIdsCall({ chain: calibration, offset: 50n, limit: 50n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getApprovedProviderIdsCall(options: getApprovedProviderIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getApprovedProviders',
    args: [options.offset, options.limit],
  } satisfies getApprovedProviderIdsCall.OutputType
}
