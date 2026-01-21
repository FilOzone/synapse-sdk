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
import type { storageView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'

export namespace getApprovedProviders {
  export type OptionsType = {
    /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
    offset?: bigint
    /** Maximum number of providers to return. Use 0 to get all remaining providers. Defaults to 0. */
    limit?: bigint
    /** The address of the storage view contract. If not provided, the default is the storage view contract address for the chain. */
    address?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getApprovedProviders'
  >

  /** Array of approved provider IDs */
  export type OutputType = bigint[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get approved provider IDs with optional pagination
 *
 * For large lists, use pagination to avoid gas limit issues. If limit=0,
 * returns all remaining providers starting from offset.
 *
 * @param client - The client to use to get the approved providers.
 * @param options - {@link getApprovedProviders.OptionsType}
 * @returns Array of approved provider IDs {@link getApprovedProviders.OutputType}
 * @throws Errors {@link getApprovedProviders.ErrorType}
 *
 * @example
 * ```ts twoslash
 * import { getApprovedProviders } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Get first 100 providers
 * const providerIds = await getApprovedProviders(client, {
 *   offset: 0n,
 *   limit: 100n,
 * })
 *
 * console.log(providerIds)
 * ```
 */
export async function getApprovedProviders(
  client: Client<Transport, Chain>,
  options: getApprovedProviders.OptionsType = {}
): Promise<getApprovedProviders.OutputType> {
  const data = await readContract(
    client,

    getApprovedProvidersCall({
      chain: client.chain,
      offset: options.offset,
      limit: options.limit,
      address: options.address,
    })
  )
  return data as getApprovedProviders.OutputType
}

export namespace getApprovedProvidersCall {
  export type OptionsType = {
    /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
    offset?: bigint
    /** Maximum number of providers to return. Use 0 to get all remaining providers. Defaults to 1000. */
    limit?: bigint
    /** The address of the storage view contract. If not provided, the default is the storage view contract address for the chain. */
    address?: Address
    /** The chain to use to get the approved providers. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getApprovedProviders'>
}

/**
 * Create a call to the getApprovedProviders function
 *
 * This function is used to create a call to the getApprovedProviders function for use with the multicall or readContract function.
 *
 * For large lists, use pagination to avoid gas limit issues.
 *
 * @param options - {@link getApprovedProvidersCall.OptionsType}
 * @returns The call to the getApprovedProviders function {@link getApprovedProvidersCall.OutputType}
 * @throws Errors {@link getApprovedProvidersCall.ErrorType}
 *
 * @example
 * ```ts twoslash
 * import { getApprovedProvidersCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Paginate through providers in batches of 50
 * const results = await multicall(client, {
 *   contracts: [
 *     getApprovedProvidersCall({ chain: calibration, offset: 0n, limit: 50n }),
 *     getApprovedProvidersCall({ chain: calibration, offset: 50n, limit: 50n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getApprovedProvidersCall(options: getApprovedProvidersCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.storageView.abi,
    address: options.address ?? chain.contracts.storageView.address,
    functionName: 'getApprovedProviders',
    args: [options.offset ?? 0n, options.limit ?? 0n],
  } satisfies getApprovedProvidersCall.OutputType
}
