import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getDataSetLeafCount {
  export type OptionsType = {
    /** The ID of the data set to get the leaf count for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the leaf count for a data set
 *
 * @example
 * ```ts
 * import { getDataSetLeafCount } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const leafCount = await getDataSetLeafCount(client, { dataSetId: 1n })
 * ```
 *
 * @param client - The client to use to get the data set leaf count.
 * @param options - {@link getDataSetLeafCount.OptionsType}
 * @returns The leaf count for the data set {@link getDataSetLeafCount.OutputType}
 * @throws Errors {@link getDataSetLeafCount.ErrorType}
 */
export async function getDataSetLeafCount(
  client: Client<Transport, Chain>,
  options: getDataSetLeafCount.OptionsType
): Promise<getDataSetLeafCount.OutputType> {
  const data = await readContract(
    client,
    getDataSetLeafCountCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getDataSetLeafCountCall {
  export type OptionsType = Simplify<getDataSetLeafCount.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getDataSetLeafCount'>
}

/**
 * Create a call to the getDataSetLeafCount function
 *
 * This function is used to create a call to the getDataSetLeafCount function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getDataSetLeafCountCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getDataSetLeafCountCall({ chain: calibration, dataSetId: 1n }),
 *     getDataSetLeafCountCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getDataSetLeafCountCall.OptionsType}
 * @returns The call to the getDataSetLeafCount function {@link getDataSetLeafCountCall.OutputType}
 * @throws Errors {@link getDataSetLeafCountCall.ErrorType}
 */
export function getDataSetLeafCountCall(options: getDataSetLeafCountCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getDataSetLeafCount',
    args: [options.dataSetId],
  } satisfies getDataSetLeafCountCall.OutputType
}
