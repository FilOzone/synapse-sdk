import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'

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
  export type OptionsType = {
    /** The ID of the data set to get the listener for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the data set listener. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getDataSetListener'>
}

/**
 * Create a call to the getDataSetListener function
 *
 * This function is used to create a call to the getDataSetListener function for use with the multicall or readContract function.
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
