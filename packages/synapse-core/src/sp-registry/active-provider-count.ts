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

export namespace activeProviderCount {
  export type OptionsType = {
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'activeProviderCount'
  >

  /** Number of active providers */
  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the number of active providers
 *
 * @param client - The client to use to get the active provider count.
 * @param options - {@link activeProviderCount.OptionsType}
 * @returns Number of active providers {@link activeProviderCount.OutputType}
 * @throws Errors {@link activeProviderCount.ErrorType}
 *
 * @example
 * ```ts
 * import { activeProviderCount } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const count = await activeProviderCount(client)
 *
 * console.log(count)
 * ```
 */
export async function activeProviderCount(
  client: Client<Transport, Chain>,
  options: activeProviderCount.OptionsType = {}
): Promise<activeProviderCount.OutputType> {
  const data = await readContract(
    client,
    activeProviderCountCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace activeProviderCountCall {
  export type OptionsType = Simplify<activeProviderCount.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'activeProviderCount'
  >
}

/**
 * Create a call to the activeProviderCount function
 *
 * This function is used to create a call to the activeProviderCount function for use with the multicall or readContract function.
 *
 * @param options - {@link activeProviderCountCall.OptionsType}
 * @returns The call to the activeProviderCount function {@link activeProviderCountCall.OutputType}
 * @throws Errors {@link activeProviderCountCall.ErrorType}
 *
 * @example
 * ```ts
 * import { activeProviderCountCall } from '@filoz/synapse-core/sp-registry'
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
 *     activeProviderCountCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function activeProviderCountCall(options: activeProviderCountCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'activeProviderCount',
    args: [],
  } satisfies activeProviderCountCall.OutputType
}
