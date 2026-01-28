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
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'

export namespace getScheduledRemovals {
  export type OptionsType = {
    /** The ID of the data set to get the scheduled removals for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = ContractFunctionReturnType<typeof pdpVerifierAbi, 'pure' | 'view', 'getScheduledRemovals'>

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the scheduled removals for a data set (deduped)
 *
 * @param client - The client to use to get the scheduled removals.
 * @param options - {@link getScheduledRemovals.OptionsType}
 * @returns The piece IDs scheduled for removal {@link getScheduledRemovals.OutputType}
 * @throws Errors {@link getScheduledRemovals.ErrorType}
 */
export async function getScheduledRemovals(
  client: Client<Transport, Chain>,
  options: getScheduledRemovals.OptionsType
): Promise<getScheduledRemovals.OutputType> {
  const data = await readContract(
    client,
    getScheduledRemovalsCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return Array.from(new Set(data))
}

export namespace getScheduledRemovalsCall {
  export type OptionsType = {
    /** The ID of the data set to get the scheduled removals for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
    /** The chain to use to get the scheduled removals. */
    chain: Chain
  }

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getScheduledRemovals'>
}

/**
 * Create a call to the getScheduledRemovals function
 *
 * This function is used to create a call to the getScheduledRemovals function for use with the multicall or readContract function.
 *
 * May require manual deduplication of the output if the data set has multiple scheduled removals for the same piece.
 *
 * @param options - {@link getScheduledRemovalsCall.OptionsType}
 * @returns The call to the getScheduledRemovals function {@link getScheduledRemovalsCall.OutputType}
 * @throws Errors {@link getScheduledRemovalsCall.ErrorType}
 */
export function getScheduledRemovalsCall(options: getScheduledRemovalsCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getScheduledRemovals',
    args: [options.dataSetId],
  } satisfies getScheduledRemovalsCall.OutputType
}
