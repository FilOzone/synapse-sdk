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
import type { fwss as storageAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getServicePrice {
  export type OptionsType = {
    /** Warm storage contract address. If not provided, the default is the storage contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof storageAbi, 'pure' | 'view', 'getServicePrice'>

  /**
   * The service price for the warm storage.
   */
  export type OutputType = {
    /** Price per TiB per month without CDN (in base units) */
    pricePerTiBPerMonthNoCDN: bigint
    /** CDN egress price per TiB (usage-based, in base units) */
    pricePerTiBCdnEgress: bigint
    /** Cache miss egress price per TiB (usage-based, in base units) */
    pricePerTiBCacheMissEgress: bigint
    /** Token address for payments */
    tokenAddress: Address
    /** Number of epochs per month */
    epochsPerMonth: bigint
    /** Minimum monthly charge for any dataset size (in base units) */
    minimumPricePerMonth: bigint
  }

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the service price for the warm storage
 *
 * @param client - The client to use to get the service price.
 * @param options - {@link getServicePrice.OptionsType}
 * @returns The service price {@link getServicePrice.OutputType}
 * @throws Errors {@link getServicePrice.ErrorType}
 *
 * @example
 * ```ts
 * import { getServicePrice } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const price = await getServicePrice(client, {})
 *
 * console.log(price.pricePerTiBPerMonthNoCDN)
 * ```
 */
export async function getServicePrice(
  client: Client<Transport, Chain>,
  options: getServicePrice.OptionsType = {}
): Promise<getServicePrice.OutputType> {
  const data = await readContract(
    client,
    getServicePriceCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getServicePriceCall {
  export type OptionsType = Simplify<getServicePrice.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageAbi, 'pure' | 'view', 'getServicePrice'>
}

/**
 * Create a call to the getServicePrice function
 *
 * This function is used to create a call to the getServicePrice function for use with the multicall or readContract function.
 *
 * @param options - {@link getServicePriceCall.OptionsType}
 * @returns The call to the getServicePrice function {@link getServicePriceCall.OutputType}
 * @throws Errors {@link getServicePriceCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getServicePriceCall } from '@filoz/synapse-core/warm-storage'
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
 *     getServicePriceCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getServicePriceCall(options: getServicePriceCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwss.abi,
    address: options.contractAddress ?? chain.contracts.fwss.address,
    functionName: 'getServicePrice',
    args: [],
  } satisfies getServicePriceCall.OutputType
}
