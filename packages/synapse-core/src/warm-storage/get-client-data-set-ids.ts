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

export namespace getClientDataSetIds {
  export type OptionsType = {
    /** Client address to fetch data set IDs for. */
    address: Address
    /** Starting index (0-based). Use 0 to start from beginning. Defaults to 0. */
    offset?: bigint
    /** Maximum number of dataset IDs to return. Use 0 to get all remaining IDs. Defaults to 0. */
    limit?: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'clientDataSets',
    [Address, bigint, bigint]
  >

  /** Array of client data set IDs */
  export type OutputType = bigint[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get client data set IDs with optional pagination
 *
 * For large lists, use pagination to avoid gas limit issues. If limit=0,
 * returns all remaining IDs starting from offset.
 *
 * @param client - The client to use to get data set IDs.
 * @param options - {@link getClientDataSetIds.OptionsType}
 * @returns Array of data set IDs {@link getClientDataSetIds.OutputType}
 * @throws Errors {@link getClientDataSetIds.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetIds } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Get first 100 dataset IDs
 * const ids = await getClientDataSetIds(client, {
 *   address: '0x0000000000000000000000000000000000000000',
 *   offset: 0n,
 *   limit: 100n,
 * })
 *
 * console.log(ids)
 * ```
 */
export async function getClientDataSetIds(
  client: Client<Transport, Chain>,
  options: getClientDataSetIds.OptionsType
): Promise<getClientDataSetIds.OutputType> {
  const data = await readContract(
    client,
    getClientDataSetIdsCall({
      chain: client.chain,
      address: options.address,
      offset: options.offset,
      limit: options.limit,
      contractAddress: options.contractAddress,
    })
  )
  return data as getClientDataSetIds.OutputType
}

export namespace getClientDataSetIdsCall {
  export type OptionsType = Simplify<getClientDataSetIds.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof storageViewAbi,
    'pure' | 'view',
    'clientDataSets',
    [Address, bigint, bigint]
  >
}

/**
 * Create a call to the {@link getClientDataSetIds} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientDataSetIdsCall.OptionsType}
 * @returns The call to the clientDataSets function {@link getClientDataSetIdsCall.OutputType}
 * @throws Errors {@link getClientDataSetIdsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetIdsCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * // Paginate through IDs in batches of 50
 * const results = await multicall(client, {
 *   contracts: [
 *     getClientDataSetIdsCall({ chain: calibration, address: '0x...', offset: 0n, limit: 50n }),
 *     getClientDataSetIdsCall({ chain: calibration, address: '0x...', offset: 50n, limit: 50n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getClientDataSetIdsCall(options: getClientDataSetIdsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'clientDataSets',
    args: [options.address, options.offset ?? 0n, options.limit ?? 0n],
  } satisfies getClientDataSetIdsCall.OutputType
}
