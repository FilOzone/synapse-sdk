import type {
  Address,
  Chain,
  ContractFunctionParameters,
  ContractFunctionReturnType,
  ReadContractErrorType,
} from 'viem'
import { readContract } from 'viem/actions'
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import { type Page, type PaginationOptions, type paginate, resolvePagination } from '../pagination.ts'
import type { PaginatedActionCallOptions, ReadClient } from '../types.ts'

export namespace getProvidersByProductType {
  export type OptionsType = PaginationOptions & {
    /** The product type to filter by. */
    productType: number
    /** If true, return only active providers with active products. Defaults to true. */
    onlyActive?: boolean
    /** Service Provider Registry contract address. If not provided, the default is the ServiceProviderRegistry contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >

  /** A page of providers offering the requested product. */
  export type OutputType = Page<ContractOutputType['providers'][number]>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType | resolvePagination.ErrorType
}

/**
 * Get one bounded page of providers offering a product type.
 *
 * Pass the returned `nextCursor` back as `cursor`; treat it as opaque. Use
 * {@link paginate} to traverse every page.
 *
 * @param client - The read-only client to use to get the providers.
 * @param options - {@link getProvidersByProductType.OptionsType}
 * @returns The paginated providers result {@link getProvidersByProductType.OutputType}
 * @throws Errors {@link getProvidersByProductType.ErrorType}
 *
 * @example Read the first page
 * ```ts
 * import { getProvidersByProductType } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const page = await getProvidersByProductType(client, {
 *   productType: 0, // ProductType.PDP
 *   onlyActive: true,
 * })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getProvidersByProductType } from '@filoz/synapse-core/sp-registry'
 *
 * for await (const provider of paginate(({ cursor }) =>
 *   getProvidersByProductType(client, {
 *     productType: 0, // ProductType.PDP
 *     onlyActive: true,
 *     cursor,
 *   })
 * )) {
 *   console.log(provider.providerId)
 * }
 * ```
 */
export async function getProvidersByProductType<chain extends Chain>(
  client: ReadClient<chain>,
  options: getProvidersByProductType.OptionsType
): Promise<getProvidersByProductType.OutputType> {
  const { cursor, limit } = resolvePagination(options, 50n)
  const data = await readContract(
    client,
    getProvidersByProductTypeCall({
      chain: client.chain,
      productType: options.productType,
      onlyActive: options.onlyActive,
      offset: cursor,
      limit,
      contractAddress: options.contractAddress,
    })
  )
  return {
    items: Array.from(data.providers),
    ...(data.hasMore ? { nextCursor: cursor + BigInt(data.providers.length) } : {}),
  }
}

export namespace getProvidersByProductTypeCall {
  export type OptionsType = PaginatedActionCallOptions<getProvidersByProductType.OptionsType, 'offset'>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >
}

/**
 * Create a call to the getProvidersByProductType function
 *
 * This function is used to create a call to the getProvidersByProductType function for use with the multicall or readContract function.
 *
 * @param options - {@link getProvidersByProductTypeCall.OptionsType}
 * @returns The call to the getProvidersByProductType function {@link getProvidersByProductTypeCall.OutputType}
 * @throws Errors {@link getProvidersByProductTypeCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getProvidersByProductTypeCall } from '@filoz/synapse-core/sp-registry'
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
 *     getProvidersByProductTypeCall({
 *       chain: calibration,
 *       productType: 0,
 *       onlyActive: true,
 *       offset: 0n,
 *       limit: 50n,
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getProvidersByProductTypeCall(options: getProvidersByProductTypeCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'getProvidersByProductType',
    args: [options.productType, options.onlyActive ?? true, options.offset, options.limit],
  } satisfies getProvidersByProductTypeCall.OutputType
}
