import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getActivePieceCount {
  export type OptionsType = {
    /** The ID of the data set to get the active piece count for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the active piece count for a data set (non-zero leaf count)
 *
 * @example
 * ```ts
 * import { getActivePieceCount } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const activePieceCount = await getActivePieceCount(client, { dataSetId: 1n })
 * ```
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
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getActivePieceCountCall {
  export type OptionsType = Simplify<getActivePieceCount.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getActivePieceCount'>
}

/**
 * Create a call to the getActivePieceCount function
 *
 * This function is used to create a call to the getActivePieceCount function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getActivePieceCountCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getActivePieceCountCall({ chain: calibration, dataSetId: 1n }),
 *     getActivePieceCountCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getActivePieceCountCall.OptionsType}
 * @returns The call to the getActivePieceCount function {@link getActivePieceCountCall.OutputType}
 * @throws Errors {@link getActivePieceCountCall.ErrorType}
 */
export function getActivePieceCountCall(options: getActivePieceCountCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getActivePieceCount',
    args: [options.dataSetId],
  } satisfies getActivePieceCountCall.OutputType
}
