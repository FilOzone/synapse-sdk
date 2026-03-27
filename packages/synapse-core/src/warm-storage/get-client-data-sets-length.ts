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

export namespace getClientDataSetsLength {
  export type OptionsType = {
    /** Client address to count data sets for. */
    address: Address
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getClientDataSetsLength'
  >

  /** Total count of data sets for the client */
  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get total count of client data sets
 *
 * @param client - The client to use to get the data set count.
 * @param options - {@link getClientDataSetsLength.OptionsType}
 * @returns Total count of data sets {@link getClientDataSetsLength.OutputType}
 * @throws Errors {@link getClientDataSetsLength.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetsLength } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const count = await getClientDataSetsLength(client, {
 *   address: '0x0000000000000000000000000000000000000000',
 * })
 *
 * console.log(count)
 * ```
 */
export async function getClientDataSetsLength(
  client: Client<Transport, Chain>,
  options: getClientDataSetsLength.OptionsType
): Promise<getClientDataSetsLength.OutputType> {
  const data = await readContract(
    client,
    getClientDataSetsLengthCall({
      chain: client.chain,
      address: options.address,
      contractAddress: options.contractAddress,
    })
  )
  return data as getClientDataSetsLength.OutputType
}

export namespace getClientDataSetsLengthCall {
  export type OptionsType = Simplify<getClientDataSetsLength.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getClientDataSetsLength'>
}

/**
 * Create a call to the {@link getClientDataSetsLength} function for use with the Viem multicall, readContract, or simulateContract functions.
 *
 * @param options - {@link getClientDataSetsLengthCall.OptionsType}
 * @returns The call to the getClientDataSetsLength function {@link getClientDataSetsLengthCall.OutputType}
 * @throws Errors {@link getClientDataSetsLengthCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getClientDataSetsLengthCall } from '@filoz/synapse-core/warm-storage'
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
 *     getClientDataSetsLengthCall({
 *       chain: calibration,
 *       address: '0x0000000000000000000000000000000000000000',
 *     }),
 *   ],
 * })
 *
 * console.log(results[0])
 * ```
 */
export function getClientDataSetsLengthCall(options: getClientDataSetsLengthCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getClientDataSetsLength',
    args: [options.address],
  } satisfies getClientDataSetsLengthCall.OutputType
}
