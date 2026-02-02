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

export namespace isRegisteredProvider {
  export type OptionsType = {
    /** The provider address to check. */
    provider: Address
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'isRegisteredProvider'
  >

  /** Whether the address is a registered provider */
  export type OutputType = boolean

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Check if an address is a registered provider
 *
 * @param client - The client to use to check if the address is registered.
 * @param options - {@link isRegisteredProvider.OptionsType}
 * @returns Whether the address is a registered provider {@link isRegisteredProvider.OutputType}
 * @throws Errors {@link isRegisteredProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { isRegisteredProvider } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const registered = await isRegisteredProvider(client, {
 *   provider: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(registered)
 * ```
 */
export async function isRegisteredProvider(
  client: Client<Transport, Chain>,
  options: isRegisteredProvider.OptionsType
): Promise<isRegisteredProvider.OutputType> {
  const data = await readContract(
    client,
    isRegisteredProviderCall({
      chain: client.chain,
      provider: options.provider,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace isRegisteredProviderCall {
  export type OptionsType = Simplify<isRegisteredProvider.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'isRegisteredProvider'
  >
}

/**
 * Create a call to the isRegisteredProvider function
 *
 * This function is used to create a call to the isRegisteredProvider function for use with the multicall or readContract function.
 *
 * @param options - {@link isRegisteredProviderCall.OptionsType}
 * @returns The call to the isRegisteredProvider function {@link isRegisteredProviderCall.OutputType}
 * @throws Errors {@link isRegisteredProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { isRegisteredProviderCall } from '@filoz/synapse-core/sp-registry'
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
 *     isRegisteredProviderCall({
 *       chain: calibration,
 *       provider: '0x1234567890123456789012345678901234567890',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function isRegisteredProviderCall(options: isRegisteredProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'isRegisteredProvider',
    args: [options.provider],
  } satisfies isRegisteredProviderCall.OutputType
}
