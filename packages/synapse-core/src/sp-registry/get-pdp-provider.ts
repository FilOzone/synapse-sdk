import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionReturnType, Transport } from 'viem'
import type { serviceProviderRegistry as serviceProviderRegistryAbi } from '../abis/index.ts'
import type { ActionCallChain } from '../types.ts'
import { decodePDPOffering } from '../utils/pdp-capabilities.ts'
import { getProviderIdByAddress } from './get-provider-id-by-address.ts'
import { getProviderWithProduct, getProviderWithProductCall } from './get-provider-with-product.ts'
import { type PDPProvider, PRODUCTS } from './types.ts'

export namespace getPDPProvider {
  export type OptionsType = {
    /** The provider ID. */
    providerId: bigint
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderWithProduct'
  >

  /** The PDP provider details */
  export type OutputType = PDPProvider

  export type ErrorType = getProviderWithProduct.ErrorType
}

/**
 * Get PDP provider details
 *
 * @param client - The client to use to get the provider details.
 * @param options - {@link getPDPProvider.OptionsType}
 * @returns The PDP provider details {@link getPDPProvider.OutputType}
 * @throws Errors {@link getPDPProvider.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProvider } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const provider = await getPDPProvider(client, {
 *   providerId: 1n,
 * })
 *
 * console.log(provider.name)
 * ```
 */
export async function getPDPProvider(
  client: Client<Transport, Chain>,
  options: getPDPProvider.OptionsType
): Promise<getPDPProvider.OutputType> {
  const data = await getProviderWithProduct(client, {
    ...options,
    productType: PRODUCTS.PDP,
  })

  return parsePDPProvider(data)
}

export namespace getPDPProviderCall {
  export type OptionsType = Simplify<getPDPProvider.OptionsType & ActionCallChain>
  export type ErrorType = getProviderWithProductCall.ErrorType
  export type OutputType = getProviderWithProductCall.OutputType
}

/**
 * Create a call to the getPDPProvider function
 *
 * This function is used to create a call to the getPDPProvider function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parsePDPProvider} to transform the contract output.
 *
 * @param options - {@link getPDPProviderCall.OptionsType}
 * @returns The call to the getPDPProvider function {@link getPDPProviderCall.OutputType}
 * @throws Errors {@link getPDPProviderCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProviderCall, parsePDPProvider } from '@filoz/synapse-core/sp-registry'
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
 *     getPDPProviderCall({ chain: calibration, providerId: 1n }),
 *   ],
 * })
 *
 * console.log(parsePDPProvider(results))
 * ```
 */
export function getPDPProviderCall(options: getPDPProviderCall.OptionsType) {
  return getProviderWithProductCall({
    ...options,
    productType: PRODUCTS.PDP,
  })
}

/**
 * Parse the contract output into a PDPProvider object
 *
 * @param data - The contract output from the getPDPProvider function {@link getPDPProvider.ContractOutputType}
 * @returns The PDPProvider object {@link getPDPProvider.OutputType}
 */
export function parsePDPProvider(data: getPDPProvider.ContractOutputType): PDPProvider {
  return {
    id: data.providerId,
    ...data.providerInfo,
    pdp: decodePDPOffering(data),
  }
}

export namespace getPDPProviderByAddress {
  export type OptionsType = {
    /** The provider address. */
    address: Address
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }
  export type OutputType = PDPProvider | null
  export type ErrorType = getProviderIdByAddress.ErrorType | getPDPProvider.ErrorType
}

/**
 * Get PDP provider by address
 *
 * @param client - The client to use to get the provider.
 * @param options - {@link getPDPProviderByAddress.OptionsType}
 * @returns The PDP provider {@link getPDPProviderByAddress.OutputType}
 * @throws Errors {@link getPDPProviderByAddress.ErrorType}
 *
 * @example
 * ```ts
 * import { getPDPProviderByAddress } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const provider = await getPDPProviderByAddress(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 * })
 *
 * console.log(provider.name)
 * ```
 */
export async function getPDPProviderByAddress(
  client: Client<Transport, Chain>,
  options: getPDPProviderByAddress.OptionsType
): Promise<getPDPProviderByAddress.OutputType> {
  const providerId = await getProviderIdByAddress(client, {
    providerAddress: options.address,
    contractAddress: options.contractAddress,
  })

  if (providerId === 0n) {
    return null
  }

  return getPDPProvider(client, { providerId, contractAddress: options.contractAddress })
}
