import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace dataSetLive {
  export type OptionsType = {
    /** The ID of the data set to check if it is live. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = boolean

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Check if a data set is live
 *
 * @example
 * ```ts
 * import { dataSetLive } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const isLive = await dataSetLive(client, { dataSetId: 1n })
 * ```
 *
 * @param client - The client to use to check if the data set is live.
 * @param options - {@link dataSetLive.OptionsType}
 * @returns Whether the data set is live {@link dataSetLive.OutputType}
 * @throws Errors {@link dataSetLive.ErrorType}
 */
export async function dataSetLive(
  client: Client<Transport, Chain>,
  options: dataSetLive.OptionsType
): Promise<dataSetLive.OutputType> {
  const data = await readContract(
    client,
    dataSetLiveCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace dataSetLiveCall {
  export type OptionsType = Simplify<dataSetLive.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'dataSetLive'>
}

/**
 * Create a call to the dataSetLive function
 *
 * This function is used to create a call to the dataSetLive function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { dataSetLiveCall } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     dataSetLiveCall({ chain: calibration, dataSetId: 1n }),
 *     dataSetLiveCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link dataSetLiveCall.OptionsType}
 * @returns The call to the dataSetLive function {@link dataSetLiveCall.OutputType}
 * @throws Errors {@link dataSetLiveCall.ErrorType}
 */
export function dataSetLiveCall(options: dataSetLiveCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'dataSetLive',
    args: [options.dataSetId],
  } satisfies dataSetLiveCall.OutputType
}
