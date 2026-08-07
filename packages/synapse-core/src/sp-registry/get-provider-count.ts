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
import type { ActionCallChain } from '../types.ts'

export namespace getProviderCount {
  export type OptionsType = {
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderCount'
  >

  /** Total number of registered providers */
  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the total number of registered providers
 *
 * @param client - The client to use to get the provider count.
 * @param options - {@link getProviderCount.OptionsType}
 * @returns Total number of registered providers {@link getProviderCount.OutputType}
 * @throws Errors {@link getProviderCount.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderCount } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const count = await getProviderCount(client, {})
 *
 * console.log(count)
 * ```
 */
export async function getProviderCount(
  client: Client<Transport, Chain>,
  options: getProviderCount.OptionsType = {}
): Promise<getProviderCount.OutputType> {
  const data = await readContract(
    client,
    getProviderCountCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getProviderCountCall {
  export type OptionsType = Simplify<getProviderCount.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderCount'
  >
}

/**
 * Create a call to the getProviderCount function
 *
 * This function is used to create a call to the getProviderCount function for use with the multicall or readContract function.
 *
 * @param options - {@link getProviderCountCall.OptionsType}
 * @returns The call to the getProviderCount function {@link getProviderCountCall.OutputType}
 * @throws Errors {@link getProviderCountCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderCountCall } from '@filoz/synapse-core/sp-registry'
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
 *     getProviderCountCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getProviderCountCall(options: getProviderCountCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'getProviderCount',
    args: [],
  } satisfies getProviderCountCall.OutputType
}
