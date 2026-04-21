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
import { isProviderExistsRevert } from '../utils/contract-errors.ts'

export namespace getProviderWithProduct {
  export type OptionsType = {
    /** The provider ID. */
    providerId: bigint
    /** The product type. */
    productType: number
    /** Service Provider Registry contract address. If not provided, the default is the contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderWithProduct'
  >

  /** The provider with product details, or `null` when the provider does not exist. */
  export type OutputType = ContractOutputType | null

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get provider details with specific product information
 *
 * The underlying contract method is guarded by the `providerExists` modifier
 * and will revert for unknown provider IDs. This wrapper normalizes those
 * reverts to `null`. Reverts from any other source (e.g. RPC failures) still
 * propagate.
 *
 * Note: the contract does not revert when the provider exists but the
 * requested product is missing or inactive — in that case it returns a
 * default-initialized product and callers must inspect `product.isActive`
 * and `product.capabilityKeys`.
 *
 * @param client - The client to use to get the provider details.
 * @param options - {@link getProviderWithProduct.OptionsType}
 * @returns The provider with product details, or `null` when the provider does not exist {@link getProviderWithProduct.OutputType}
 * @throws Errors {@link getProviderWithProduct.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderWithProduct } from '@filoz/synapse-core/sp-registry'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const provider = await getProviderWithProduct(client, {
 *   providerId: 1n,
 *   productType: 0, // ProductType.PDP
 * })
 *
 * if (provider) {
 *   console.log(provider.providerInfo.name)
 * }
 * ```
 */
export async function getProviderWithProduct(
  client: Client<Transport, Chain>,
  options: getProviderWithProduct.OptionsType
): Promise<getProviderWithProduct.OutputType> {
  try {
    return await readContract(
      client,
      getProviderWithProductCall({
        chain: client.chain,
        providerId: options.providerId,
        productType: options.productType,
        contractAddress: options.contractAddress,
      })
    )
  } catch (error) {
    if (isProviderExistsRevert(error)) {
      return null
    }
    throw error
  }
}

export namespace getProviderWithProductCall {
  export type OptionsType = Simplify<getProviderWithProduct.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof serviceProviderRegistryAbi,
    'pure' | 'view',
    'getProviderWithProduct'
  >
}

/**
 * Create a call to the getProviderWithProduct function
 *
 * This function is used to create a call to the getProviderWithProduct function for use with the multicall or readContract function.
 *
 * @param options - {@link getProviderWithProductCall.OptionsType}
 * @returns The call to the getProviderWithProduct function {@link getProviderWithProductCall.OutputType}
 * @throws Errors {@link getProviderWithProductCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderWithProductCall } from '@filoz/synapse-core/sp-registry'
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
 *     getProviderWithProductCall({ chain: calibration, providerId: 1n, productType: 0 }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getProviderWithProductCall(options: getProviderWithProductCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.serviceProviderRegistry.abi,
    address: options.contractAddress ?? chain.contracts.serviceProviderRegistry.address,
    functionName: 'getProviderWithProduct',
    args: [options.providerId, options.productType],
  } satisfies getProviderWithProductCall.OutputType
}
