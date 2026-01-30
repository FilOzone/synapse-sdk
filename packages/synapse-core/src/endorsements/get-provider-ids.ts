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

export namespace getProviderIds {
  export type OptionsType = {
    /** Endorsements contract address. If not provided, the default is the endorsements contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof providerIdSetAbi,
    'pure' | 'view',
    'getProviderIds'
  >

  /** Set of endorsed provider IDs */
  export type OutputType = Set<bigint>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get all endorsed provider IDs
 *
 * @param client - The client to use to get the endorsed providers.
 * @param options - {@link getProviderIds.OptionsType}
 * @returns Set of endorsed provider IDs {@link getProviderIds.OutputType}
 * @throws Errors {@link getProviderIds.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderIds } from '@filoz/synapse-core/endorsements'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const providerIds = await getProviderIds(client)
 *
 * console.log(providerIds)
 * ```
 */
export async function getProviderIds(
  client: Client<Transport, Chain>,
  options: getProviderIds.OptionsType = {}
): Promise<getProviderIds.OutputType> {
  const data = await readContract(
    client,
    getProviderIdsCall({
      chain: client.chain,
      contractAddress: options.contractAddress,
    })
  )
  return parseGetProviderIds(data)
}

export namespace getProviderIdsCall {
  export type OptionsType = Simplify<
    getProviderIds.OptionsType & {
      /** The chain to use to get the endorsed providers. */
      chain: Chain
    }
  >

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof providerIdSetAbi, 'pure' | 'view', 'getProviderIds'>
}

/**
 * Create a call to the getProviderIds function
 *
 * This function is used to create a call to the getProviderIds function for use with the multicall or readContract function.
 *
 * To get the same output type as the action, use {@link parseGetProviderIds} to transform the contract output.
 *
 * @param options - {@link getProviderIdsCall.OptionsType}
 * @returns The call to the getProviderIds function {@link getProviderIdsCall.OutputType}
 * @throws Errors {@link getProviderIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getProviderIdsCall } from '@filoz/synapse-core/endorsements'
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
 *     getProviderIdsCall({ chain: calibration }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getProviderIdsCall(options: getProviderIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.endorsements.abi,
    address: options.contractAddress ?? chain.contracts.endorsements.address,
    functionName: 'getProviderIds',
    args: [],
  } satisfies getProviderIdsCall.OutputType
}

/**
 * Parse the result of the getProviderIds function
 *
 * @param data - The result of the getProviderIds function {@link getProviderIds.ContractOutputType}
 * @returns Set of endorsed provider IDs {@link getProviderIds.OutputType}
 *
 * @example
 * ```ts
 * import { parseGetProviderIds } from '@filoz/synapse-core/endorsements'
 *
 * const providerIds = parseGetProviderIds([1n, 2n, 1n])
 * console.log(providerIds) // Set { 1n, 2n }
 * ```
 */
export function parseGetProviderIds(data: getProviderIds.ContractOutputType): getProviderIds.OutputType {
  return new Set(data)
}
