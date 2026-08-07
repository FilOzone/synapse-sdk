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

export namespace getClientDataSetIds {
  export type OptionsType = PaginationOptions & {
    /** Client address to fetch data set IDs for. */
    address: Address
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'clientDataSets',
    [Address, bigint, bigint]
  >

  /** A page of client data set IDs. */
  export type OutputType = Page<bigint>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of a client's data-set IDs.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page. `limit` must be greater than zero.
 *
 * @param client - The read-only client to use to get the client data set IDs.
 * @param options - {@link getClientDataSetIds.OptionsType}
 * @returns A page of data set IDs {@link getClientDataSetIds.OutputType}
 * @throws Errors {@link getClientDataSetIds.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getClientDataSetIds } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const address = '0x0000000000000000000000000000000000000000'
 * const page = await getClientDataSetIds(client, { address })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getClientDataSetIds } from '@filoz/synapse-core/warm-storage'
 *
 * for await (const dataSetId of paginate(({ cursor }) =>
 *   getClientDataSetIds(client, { address, cursor })
 * )) {
 *   console.log(dataSetId)
 * }
 * ```
 */
export async function getClientDataSetIds<chain extends Chain>(
  client: ReadClient<chain>,
  options: getClientDataSetIds.OptionsType
): Promise<getClientDataSetIds.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  const data = await readContract(
    client,
    getClientDataSetIdsCall({
      chain: client.chain,
      address: options.address,
      offset: cursor,
      limit: limit + 1n,
      contractAddress: options.contractAddress,
    })
  )
  return pageFromLookahead(data, limit, () => cursor + limit)
}

export namespace getClientDataSetIdsCall {
  export type OptionsType = PaginatedActionCallOptions<getClientDataSetIds.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof storageViewAbi,
    'pure' | 'view',
    'clientDataSets',
    [Address, bigint, bigint]
  >
}

/**
 * Create a call to the {@link getClientDataSetIds} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientDataSetIdsCall.OptionsType}
 * @returns The call to the clientDataSets function {@link getClientDataSetIdsCall.OutputType}
 * @throws Errors {@link getClientDataSetIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetIdsCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Paginate through IDs in batches of 50
 * const results = await multicall(client, {
 *   contracts: [
 *     getClientDataSetIdsCall({ chain: calibration, address: '0x...', offset: 0n, limit: 50n }),
 *     getClientDataSetIdsCall({ chain: calibration, address: '0x...', offset: 50n, limit: 50n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getClientDataSetIdsCall(options: getClientDataSetIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'clientDataSets',
    args: [options.address, options.offset, options.limit],
  } satisfies getClientDataSetIdsCall.OutputType
}
