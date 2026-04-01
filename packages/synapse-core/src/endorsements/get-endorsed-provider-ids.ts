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
import type { providerIdSetAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getEndorsedProviderIds {
  export type OptionsType = {
    /** Endorsements contract address. If not provided, the default is the endorsements contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof providerIdSetAbi,
    'pure' | 'view',
    'getProviderIds'
  >

  /** Array of endorsed provider IDs */
  export type OutputType = bigint[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get all endorsed provider IDs
 *
 * @param client - The client to use to get the endorsed providers.
 * @param options - {@link getEndorsedProviderIds.OptionsType}
 * @returns Array of endorsed provider IDs {@link getEndorsedProviderIds.OutputType}
 * @throws Errors {@link getEndorsedProviderIds.ErrorType}
 *
 * @example
 * ```ts
 * import { getEndorsedProviderIds } from '@filoz/synapse-core/endorsements'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const providerIds = await getEndorsedProviderIds(client)
 *
 * console.log(providerIds)
 * ```
 */
export async function getEndorsedProviderIds(
  client: Client<Transport, Chain>,
  options: getEndorsedProviderIds.OptionsType = {}
): Promise<getEndorsedProviderIds.OutputType> {
  const data = await readContract(
    client,
    getEndorsedProviderIdsCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )
  return parseGetEndorsedProviderIds(data)
}

export namespace getEndorsedProviderIdsCall {
  export type OptionsType = Simplify<getEndorsedProviderIds.OptionsType & ActionCallChain>

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof providerIdSetAbi, 'pure' | 'view', 'getProviderIds'>
}

/**
 * Create a call to the getEndorsedProviderIds function
 *
 * This function is used to create a call to the getEndorsedProviderIds function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parseGetEndorsedProviderIds} to transform the contract output.
 *
 * @param options - {@link getEndorsedProviderIdsCall.OptionsType}
 * @returns The call to the getProviderIds function {@link getEndorsedProviderIdsCall.OutputType}
 * @throws Errors {@link getEndorsedProviderIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getEndorsedProviderIdsCall } from '@filoz/synapse-core/endorsements'
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
 *     getEndorsedProviderIdsCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getEndorsedProviderIdsCall(options: getEndorsedProviderIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.endorsements.abi,
    address: options.contractAddress ?? chain.contracts.endorsements.address,
    functionName: 'getProviderIds',
    args: [],
  } satisfies getEndorsedProviderIdsCall.OutputType
}

/**
 * Parse the result of the getEndorsedProviderIds function
 *
 * @param data - The result of the getEndorsedProviderIds function {@link getEndorsedProviderIds.ContractOutputType}
 * @returns Array of endorsed provider IDs {@link getEndorsedProviderIds.OutputType}
 *
 * @example
 * ```ts
 * import { parseGetEndorsedProviderIds } from '@filoz/synapse-core/endorsements'
 *
 * const providerIds = parseGetEndorsedProviderIds([1n, 2n, 1n])
 * console.log(providerIds) // [1n, 2n]
 * ```
 */
export function parseGetEndorsedProviderIds(
  data: getEndorsedProviderIds.ContractOutputType
): getEndorsedProviderIds.OutputType {
  // deduplicate provider IDs
  return Array.from(new Set(data))
}
