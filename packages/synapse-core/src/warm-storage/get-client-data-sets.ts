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
 *   client: '0x0000000000000000000000000000000000000000',
 * })
 *
 * console.log(dataSets[0]?.dataSetId)
 * ```
 */
export async function getClientDataSets(
  client: Client<Transport, Chain>,
  options: getClientDataSets.OptionsType
): Promise<getClientDataSets.OutputType> {
  const data = await readContract(
    client,
    getClientDataSetsCall({
      chain: client.chain,
      address: options.address,
      contractAddress: options.contractAddress,
    })
  )
  return data as getClientDataSets.OutputType
}

export namespace getClientDataSetsCall {
  export type OptionsType = Simplify<getClientDataSets.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getClientDataSets'>
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
 *       client: '0x0000000000000000000000000000000000000000',
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
    args: [options.address],
  } satisfies getClientDataSetsCall.OutputType
}
