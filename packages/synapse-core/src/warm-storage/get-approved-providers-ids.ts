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
import type { fwssView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getApprovedProvidersIds {
  export type OptionsType = {
    /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
    offset?: bigint
    /** Maximum number of providers to return. Use 0 to get all remaining providers. Defaults to 0. */
    limit?: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
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
 * Get all approved provider IDs with optional pagination
 *
 * For large lists, use pagination to avoid gas limit issues. If limit=0,
 * returns all remaining providers starting from offset.
 *
 * @param client - The client to use to get the approved providers.
 * @param options - {@link getApprovedProvidersIds.OptionsType}
 * @returns Array of approved provider IDs {@link getApprovedProvidersIds.OutputType}
 * @throws Errors {@link getApprovedProvidersIds.ErrorType}
 *
 * @example
 * ```ts
 * import { getApprovedProvidersIds } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Get first 100 providers
 * const providerIds = await getApprovedProvidersIds(client, {
 *   offset: 0n,
 *   limit: 100n,
 * })
 *
 * console.log(providerIds)
 * ```
 */
export async function getApprovedProvidersIds(
  client: Client<Transport, Chain>,
  options: getApprovedProvidersIds.OptionsType = {}
): Promise<getApprovedProvidersIds.OutputType> {
  const data = await readContract(
    client,

    getApprovedProvidersIdsCall({
      chain: client.chain,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return data as getApprovedProvidersIds.OutputType
}

export namespace getApprovedProvidersIdsCall {
  export type OptionsType = Simplify<getApprovedProvidersIds.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getApprovedProviders'>
}

/**
 * Create a call to the {@link getApprovedProvidersIds} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getApprovedProvidersIdsCall.OptionsType}
 * @returns Call object {@link getApprovedProvidersIdsCall.OutputType}
 * @throws Errors {@link getApprovedProvidersIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getApprovedProvidersIdsCall } from '@filoz/synapse-core/warm-storage'
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
 *     getApprovedProvidersIdsCall({ chain: calibration, offset: 0n, limit: 50n }),
 *     getApprovedProvidersIdsCall({ chain: calibration, offset: 50n, limit: 50n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getApprovedProvidersIdsCall(options: getApprovedProvidersIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getApprovedProviders',
    args: [options.offset ?? 0n, options.limit ?? 0n],
  } satisfies getApprovedProvidersIdsCall.OutputType
}
