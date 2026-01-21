import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'

export namespace getActivePieceCount {
  export type OptionsType = {
    /** The ID of the data set to get the active piece count for. */
    dataSetId: bigint
    /** The address of the PDP Verifier contract. If not provided, the default is the PDP Verifier contract address for the chain. */
    address?: Address
  }

  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the active piece count for a data set (non-zero leaf count)
 *
 * @param client - The client to use to get the active piece count.
 * @param options - {@link getActivePieceCount.OptionsType}
 * @returns The active piece count for the data set {@link getActivePieceCount.OutputType}
 * @throws Errors {@link getActivePieceCount.ErrorType}
 */
export async function getActivePieceCount(
  client: Client<Transport, Chain>,
  options: getActivePieceCount.OptionsType
): Promise<getActivePieceCount.OutputType> {
  const data = await readContract(
    client,
    getActivePieceCountCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      address: options.address,
    })
  )
  return data
}

export namespace getActivePieceCountCall {
  export type OptionsType = {
    /** The ID of the data set to get the active piece count for. */
    dataSetId: bigint
    /** The address of the PDP Verifier contract. If not provided, the default is the PDP Verifier contract address for the chain. */
    address?: Address
    /** The chain to use to get the active piece count. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieceCount'>
}

/**
 * Create a call to the getActivePieceCount function
 *
 * This function is used to create a call to the getActivePieceCount function for use with the multicall or readContract function.
 *
 * @param options - {@link getActivePieceCountCall.OptionsType}
 * @returns The call to the getActivePieceCount function {@link getActivePieceCountCall.OutputType}
 * @throws Errors {@link getActivePieceCountCall.ErrorType}
 */
export function getActivePieceCountCall(options: getActivePieceCountCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.address ?? chain.contracts.pdp.address,
    functionName: 'getActivePieceCount',
    args: [options.dataSetId],
  } satisfies getActivePieceCountCall.OutputType
}
