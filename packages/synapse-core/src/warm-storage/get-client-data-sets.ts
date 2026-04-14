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
import type { getPdpDataSets } from './get-pdp-data-sets.ts'
import type { DataSetInfo } from './types.ts'

export namespace getClientDataSets {
  export type OptionsType = {
    /** Client address to fetch data sets for. */
    address: Address
    /** Starting index (0-based). Use `0` to start from the beginning. Defaults to `0n`. */
    offset?: bigint
    /** Maximum number of data sets to return. Use `0` to get all remaining. Defaults to `0n` (all). */
    limit?: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getClientDataSets'
  >

  /** Array of client data set info entries */
  export type OutputType = DataSetInfo[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get client data sets
 *
 * Use {@link getPdpDataSets} instead to get PDP data sets.
 *
 * @param client - The client to use to get data sets for a client address.
 * @param options - {@link getClientDataSets.OptionsType}
 * @returns Array of data set info entries {@link getClientDataSets.OutputType}
 * @throws Errors {@link getClientDataSets.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSets } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSets = await getClientDataSets(client, {
 *   address: '0x0000000000000000000000000000000000000000',
 * })
 *
 * console.log(dataSets[0]?.dataSetId)
 * ```
 */
export async function getClientDataSets(
  client: Client<Transport, Chain>,
  options: getClientDataSets.OptionsType
): Promise<getClientDataSets.OutputType> {
  const limit = options.limit ?? 100n
  let offset = options.offset ?? 0n
  let needsMore = true
  const dataSets: getClientDataSets.OutputType = []

  while (needsMore) {
    const data = await readContract(
      client,
      getClientDataSetsCall({
        chain: client.chain,
        address: options.address,
        offset,
        limit,
        contractAddress: options.contractAddress,
      })
    )

    for (const dataSet of data) {
      if (dataSets.length < limit) {
        dataSets.push(dataSet)
      } else {
        needsMore = false
        break
      }
    }
    if (data.length < limit) {
      needsMore = false
    }
    offset += limit
  }
  return dataSets
}

export namespace getClientDataSetsIterable {
  export type OptionsType = {
    /** Client address to fetch data sets for. */
    address: Address
    /** Starting index (0-based). Use `0` to start from the beginning. Defaults to `0n`. */
    offset?: bigint
    /** Batch size for each pagination call. Defaults to `100n`. */
    batchSize?: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = AsyncGenerator<DataSetInfo>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get client data sets iterable
 *
 * @param client - The client to use to get data sets for a client address.
 * @param options - {@link getClientDataSetsIterable.OptionsType}
 * @returns Async generator of data set info entries {@link getClientDataSetsIterable.OutputType}
 * @throws Errors {@link getClientDataSetsIterable.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetsIterable } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSets = await getClientDataSetsIterable(client, {
 *   address: '0x0000000000000000000000000000000000000000',
 * })
 *
 * for await (const dataSet of dataSets) {
 *   console.log(dataSet.dataSetId)
 * }
 * ```
 */
export async function* getClientDataSetsIterable(
  client: Client<Transport, Chain>,
  options: getClientDataSetsIterable.OptionsType
): getClientDataSetsIterable.OutputType {
  const batchSize = options.batchSize ?? 100n
  let offset = options.offset ?? 0n
  let hasMore = true

  while (hasMore) {
    const data = await readContract(
      client,
      getClientDataSetsCall({
        chain: client.chain,
        address: options.address,
        offset,
        limit: batchSize,
        contractAddress: options.contractAddress,
      })
    )
    for (const dataSet of data) {
      yield dataSet
    }
    if (data.length < batchSize) {
      hasMore = false
    }
    offset += batchSize
  }
}

export namespace getClientDataSetsCall {
  export type OptionsType = Simplify<getClientDataSets.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof storageViewAbi,
    'pure' | 'view',
    'getClientDataSets',
    [Address, bigint, bigint]
  >
}

/**
 * Create a call to the {@link getClientDataSets} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientDataSetsCall.OptionsType}
 * @returns The call to the getClientDataSets function {@link getClientDataSetsCall.OutputType}
 * @throws Errors {@link getClientDataSetsCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetsCall } from '@filoz/synapse-core/warm-storage'
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
 *     getClientDataSetsCall({
 *       chain: calibration,
 *       address: '0x0000000000000000000000000000000000000000',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getClientDataSetsCall(options: getClientDataSetsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getClientDataSets',
    args: [options.address, options.offset ?? 0n, options.limit ?? 0n],
  } satisfies getClientDataSetsCall.OutputType
}
