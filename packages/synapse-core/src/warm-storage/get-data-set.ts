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
import type { getPdpDataSet } from './get-pdp-data-set.ts'
import type { DataSetInfo } from './types.ts'

export namespace getDataSet {
  export type OptionsType = {
    /** The ID of the data set to get. */
    dataSetId: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<typeof storageViewAbi, 'pure' | 'view', 'getDataSet'>

  /** Data set info or undefined if the data set does not exist. */
  export type OutputType = DataSetInfo | undefined

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get a data set by ID
 *
 * Use {@link getPdpDataSet} instead to get PDP data sets.
 *
 * @param client - The client to use to get the data set.
 * @param options - {@link getDataSet.OptionsType}
 * @returns Data set info or undefined if the data set does not exist {@link getDataSet.OutputType}
 * @throws Errors {@link getDataSet.ErrorType}
 *
 * @example
 * ```ts
 * import { getDataSet } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSet = await getDataSet(client, {
 *   dataSetId: 1n,
 * })
 *
 * if (dataSet) {
 *   console.log(dataSet.dataSetId)
 * } else {
 *   console.log('Data set does not exist')
 * }
 * ```
 */
export async function getDataSet(
  client: Client<Transport, Chain>,
  options: getDataSet.OptionsType
): Promise<getDataSet.OutputType> {
  const data = await readContract(
    client,
    getDataSetCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  if (data.pdpRailId === 0n) {
    return undefined
  }
  return data
}

export namespace getDataSetCall {
  export type OptionsType = Simplify<getDataSet.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getDataSet'>
}

/**
 * Create a call to the {@link getDataSet} function for use with the multicall or readContract function.
 *
 * @param options - {@link getDataSetCall.OptionsType}
 * @returns The call to the {@link getDataSet} function {@link getDataSetCall.OutputType}
 * @throws Errors {@link getDataSetCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getDataSetCall } from '@filoz/synapse-core/warm-storage'
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
 *     getDataSetCall({ chain: calibration, dataSetId: 1n }),
 *     getDataSetCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 *
 * console.log(results)
 * ```
 */
export function getDataSetCall(options: getDataSetCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getDataSet',
    args: [options.dataSetId],
  } satisfies getDataSetCall.OutputType
}
