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

export namespace getProviderIdByAddress {
  export type OptionsType = {
    /** The provider address to look up. */
    providerAddress: Address
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderIdByAddress'
  >

  /** The provider ID, or `null` when the address is not registered. */
  export type OutputType = bigint | null

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get provider ID by address
 *
 * Returns the provider ID for a given provider address, or `null` when the
 * address is not registered as a provider (the contract returns `0` in that
 * case; this wrapper normalizes it to `null`).
 *
 * @param client - The client to use to get the provider ID.
 * @param options - {@link getProviderIdByAddress.OptionsType}
 * @returns The provider ID, or `null` when the address is not registered {@link getProviderIdByAddress.OutputType}
 * @throws Errors {@link getProviderIdByAddress.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderIdByAddress } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const providerId = await getProviderIdByAddress(client, {
 *   providerAddress: '0x1234567890123456789012345678901234567890',
 * })
 *
 * if (providerId === null) {
 *   console.log('Provider not found')
 * } else {
 *   console.log(`Provider ID: ${providerId}`)
 * }
 * ```
 */
export async function getProviderIdByAddress(
  client: Client<Transport, Chain>,
  options: getProviderIdByAddress.OptionsType
): Promise<getProviderIdByAddress.OutputType> {
  const data = await readContract(
    client,
    getProviderIdByAddressCall({
      chain: client.chain,
      providerAddress: options.providerAddress,
      contractAddress: options.contractAddress,
    })
  )
  return data === 0n ? null : data
}

export namespace getProviderIdByAddressCall {
  export type OptionsType = Simplify<getProviderIdByAddress.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderIdByAddress'
  >
}

/**
 * Create a call to the getProviderIdByAddress function
 *
 * This function is used to create a call to the getProviderIdByAddress function for use with the multicall or readContract function.
 *
 * @param options - {@link getProviderIdByAddressCall.OptionsType}
 * @returns The call to the getProviderIdByAddress function {@link getProviderIdByAddressCall.OutputType}
 * @throws Errors {@link getProviderIdByAddressCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderIdByAddressCall } from '@filoz/synapse-core/sp-registry'
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
 *     getProviderIdByAddressCall({
 *       chain: calibration,
 *       providerAddress: '0x1234567890123456789012345678901234567890',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getProviderIdByAddressCall(options: getProviderIdByAddressCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'getProviderIdByAddress',
    args: [options.providerAddress],
  } satisfies getProviderIdByAddressCall.OutputType
}
