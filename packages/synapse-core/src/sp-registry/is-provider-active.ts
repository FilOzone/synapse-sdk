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

export namespace isProviderActive {
  export type OptionsType = {
    /** The provider ID to check. */
    providerId: bigint
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'isProviderActive'
  >

  /** Whether the provider is active */
  export type OutputType = boolean

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Check if a provider is active
 *
 * @param client - The client to use to check the provider status.
 * @param options - {@link isProviderActive.OptionsType}
 * @returns Whether the provider is active {@link isProviderActive.OutputType}
 * @throws Errors {@link isProviderActive.ErrorType}
 *
 * @example
 * ```ts
 * import { isProviderActive } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const active = await isProviderActive(client, {
 *   providerId: 123n,
 * })
 *
 * console.log(active)
 * ```
 */
export async function isProviderActive(
  client: Client<Transport, Chain>,
  options: isProviderActive.OptionsType
): Promise<isProviderActive.OutputType> {
  const data = await readContract(
    client,
    isProviderActiveCall({
      chain: client.chain,
      providerId: options.providerId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace isProviderActiveCall {
  export type OptionsType = Simplify<isProviderActive.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'isProviderActive'
  >
}

/**
 * Create a call to the isProviderActive function
 *
 * This function is used to create a call to the isProviderActive function for use with the multicall or readContract function.
 *
 * @param options - {@link isProviderActiveCall.OptionsType}
 * @returns The call to the isProviderActive function {@link isProviderActiveCall.OutputType}
 * @throws Errors {@link isProviderActiveCall.ErrorType}
 *
 * @example
 * ```ts
 * import { isProviderActiveCall } from '@filoz/synapse-core/sp-registry'
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
 *     isProviderActiveCall({ chain: calibration, providerId: 123n }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function isProviderActiveCall(options: isProviderActiveCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'isProviderActive',
    args: [options.providerId],
  } satisfies isProviderActiveCall.OutputType
}
