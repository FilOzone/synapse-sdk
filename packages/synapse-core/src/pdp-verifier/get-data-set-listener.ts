import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getDataSetListener {
  export type OptionsType = {
    /** The ID of the data set to get the listener for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = Address

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the data set listener contract address (record keeper)
 *
 * @example
 * ```ts
 * import { getDataSetListener } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const listenerAddress = await getDataSetListener(client, { dataSetId: 1n })
 * ```
 *
 * @param client - The client to use to get the data set listener.
 * @param options - {@link getDataSetListener.OptionsType}
 * @returns Listener contract address {@link getDataSetListener.OutputType}
 * @throws Errors {@link getDataSetListener.ErrorType}
 */
export async function getDataSetListener(
  client: Client<Transport, Chain>,
  options: getDataSetListener.OptionsType
): Promise<getDataSetListener.OutputType> {
  const data = await readContract(
    client,
    getDataSetListenerCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getDataSetListenerCall {
  export type OptionsType = Simplify<getDataSetListener.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getDataSetListener'>
}

/**
 * Create a call to the getDataSetListener function
 *
 * This function is used to create a call to the getDataSetListener function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getDataSetListenerCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getDataSetListenerCall({ chain: calibration, dataSetId: 1n }),
 *     getDataSetListenerCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getDataSetListenerCall.OptionsType}
 * @returns The call to the getDataSetListener function {@link getDataSetListenerCall.OutputType}
 * @throws Errors {@link getDataSetListenerCall.ErrorType}
 */
export function getDataSetListenerCall(options: getDataSetListenerCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getDataSetListener',
    args: [options.dataSetId],
  } satisfies getDataSetListenerCall.OutputType
}
