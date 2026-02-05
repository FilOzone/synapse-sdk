import type { Simplify } from 'type-fest'
import type { Address, Chain, Client, ContractFunctionParameters, ReadContractErrorType, Transport } from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getNextPieceId {
  export type OptionsType = {
    /** The ID of the data set to get the next piece ID for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = bigint

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the next piece ID for a data set
 *
 * Total pieces ever added; does not decrease when pieces are removed
 *
 * @example
 * ```ts
 * import { getNextPieceId } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const nextPieceId = await getNextPieceId(client, { dataSetId: 1n })
 * ```
 *
 * @param client - The client to use to get the next piece ID.
 * @param options - {@link getNextPieceId.OptionsType}
 * @returns The next piece ID for the data set {@link getNextPieceId.OutputType}
 * @throws Errors {@link getNextPieceId.ErrorType}
 */
export async function getNextPieceId(
  client: Client<Transport, Chain>,
  options: getNextPieceId.OptionsType
): Promise<getNextPieceId.OutputType> {
  const data = await readContract(
    client,
    getNextPieceIdCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getNextPieceIdCall {
  export type OptionsType = Simplify<getNextPieceId.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getNextPieceId'>
}

/**
 * Create a call to the getNextPieceId function
 *
 * This function is used to create a call to the getNextPieceId function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getNextPieceIdCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getNextPieceIdCall({ chain: calibration, dataSetId: 1n }),
 *     getNextPieceIdCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getNextPieceIdCall.OptionsType}
 * @returns The call to the getNextPieceId function {@link getNextPieceIdCall.OutputType}
 * @throws Errors {@link getNextPieceIdCall.ErrorType}
 */
export function getNextPieceIdCall(options: getNextPieceIdCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getNextPieceId',
    args: [options.dataSetId],
  } satisfies getNextPieceIdCall.OutputType
}
