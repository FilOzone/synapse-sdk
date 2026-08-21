import type {
  Address,
  Chain,
  Client,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
  Transport,
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
import type { PaginatedActionCallOptions } from '../types.ts'
import type { getPdpDataSets } from './get-pdp-data-sets.ts'
import type { DataSetInfo } from './types.ts'

export namespace getClientDataSets {
  export type OptionsType = PaginationOptions & {
    /** Client address to fetch data sets for. */
    address: Address
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getClientDataSets'
  >

  /** A page of client data set info entries. */
  export type OutputType = Page<DataSetInfo>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of a client's data sets.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page. Use {@link getPdpDataSets} when the
 * enriched PDP data-set representation is required.
 *
 * @param client - The client to use to get data sets for a client address.
 * @param options - {@link getClientDataSets.OptionsType}
 * @returns A page of data set info entries {@link getClientDataSets.OutputType}
 * @throws Errors {@link getClientDataSets.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getClientDataSets } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const address = '0x0000000000000000000000000000000000000000'
 * const page = await getClientDataSets(client, { address })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getClientDataSets } from '@filoz/synapse-core/warm-storage'
 *
 * for await (const dataSet of paginate(({ cursor }) =>
 *   getClientDataSets(client, { address, cursor })
 * )) {
 *   console.log(dataSet.dataSetId)
 * }
 * ```
 */
export async function getClientDataSets(
  client: Client<Transport, Chain>,
  options: getClientDataSets.OptionsType
): Promise<getClientDataSets.OutputType> {
  const { cursor, limit } = resolvePagination(options, 100n)
  const data = await readContract(
    client,
    getClientDataSetsCall({
      chain: client.chain,
      address: options.address,
      offset: cursor,
      limit: limit + 1n,
      contractAddress: options.contractAddress,
    })
  )
  return pageFromLookahead(data, limit, () => cursor + limit)
}

export namespace getClientDataSetsCall {
  export type OptionsType = PaginatedActionCallOptions<getClientDataSets.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof storageViewAbi,
    'pure' | 'view',
    'getClientDataSets',
    [Address, bigint, bigint]
  >
}

/**
 * Create a call to the {@link getClientDataSets} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientDataSetsCall.OptionsType}
 * @returns The call to the getClientDataSets function {@link getClientDataSetsCall.OutputType}
 * @throws Errors {@link getClientDataSetsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetsCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getClientDataSetsCall({
 *       chain: calibration,
 *       address: '0x0000000000000000000000000000000000000000',
 *       offset: 0n,
 *       limit: 100n,
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getClientDataSetsCall(options: getClientDataSetsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getClientDataSets',
    args: [options.address, options.offset, options.limit],
  } satisfies getClientDataSetsCall.OutputType
}
