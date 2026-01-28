import type { Simplify } from 'type-fest'
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
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace getProvidersByProductType {
  export type OptionsType = {
    /** The product type to filter by. */
    productType: number
    /** If true, return only active providers with active products. Defaults to true. */
    onlyActive?: boolean
    /** Starting index for pagination (0-based). Defaults to 0. */
    offset?: bigint
    /** Maximum number of results to return. Defaults to 50. */
    limit?: bigint
    /** Service Provider Registry contract address. If not provided, the default is the ServiceProviderRegistry contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProvidersByProductType'
  >

  /** The paginated providers result */
  export type OutputType = ContractOutputType

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get providers that offer a specific product type with pagination
 *
 * @param client - The client to use to get the providers.
 * @param options - {@link getProvidersByProductType.OptionsType}
 * @returns The paginated providers result {@link getProvidersByProductType.OutputType}
 * @throws Errors {@link getProvidersByProductType.ErrorType}
 *
 * @example
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
 * const result = await getProvidersByProductType(client, {
 *   productType: 0, // ProductType.PDP
 *   onlyActive: true,
 * })
 *
 * console.log(result.providers)
 * console.log(result.hasMore)
 * ```
 */
export async function getProvidersByProductType(
  client: Client<Transport, Chain>,
  options: getProvidersByProductType.OptionsType
): Promise<getProvidersByProductType.OutputType> {
  const data = await readContract(
    client,
    getProvidersByProductTypeCall({
      chain: client.chain,
      productType: options.productType,
      onlyActive: options.onlyActive,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getProvidersByProductTypeCall {
  export type OptionsType = Simplify<
    getProvidersByProductType.OptionsType & {
      /** The chain to use. */
      chain: Chain
    }
  >

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
    args: [options.productType, options.onlyActive ?? true, options.offset ?? 0n, options.limit ?? 50n],
  } satisfies getProvidersByProductTypeCall.OutputType
}
