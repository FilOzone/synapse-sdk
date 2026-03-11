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
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'

export namespace getNextChallengeEpoch {
  export type OptionsType = {
    /** The ID of the data set to get next challenge epoch for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  export type OutputType = bigint
  /**
   * `uint256`
   */
  export type ContractOutputType = ContractFunctionReturnType<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'getNextChallengeEpoch'
  >

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get next challenge epoch
 *
 * @example
 * ```ts
 * import { getNextChallengeEpoch } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const nextChallengeEpoch = await getNextChallengeEpoch(client, {
 *   dataSetId: 1n,
 * })
 * ```
 *
 * @param client - The client to use to get the active pieces.
 * @param options - {@link getNextChallengeEpoch.OptionsType}
 * @returns The next challenge epoch for the data set {@link getNextChallengeEpoch.OutputType}
 * @throws Errors {@link getNextChallengeEpoch.ErrorType}
 */
export async function getNextChallengeEpoch(
  client: Client<Transport, Chain>,
  options: getNextChallengeEpoch.OptionsType
): Promise<getNextChallengeEpoch.OutputType> {
  const data = await readContract(
    client,
    getNextChallengeEpochCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return data
}

export namespace getNextChallengeEpochCall {
  export type OptionsType = Simplify<getNextChallengeEpoch.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof pdpVerifierAbi, 'pure' | 'view', 'getNextChallengeEpoch'>
}

/**
 * Create a call to the {@link getNextChallengeEpoch} function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getNextChallengeEpochCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getNextChallengeEpochCall({ chain: calibration, dataSetId: 1n }),
 *     getNextChallengeEpochCall({ chain: calibration, dataSetId: 101n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getNextChallengeEpochCall.OptionsType}
 * @returns The call to the getNextChallengeEpoch function {@link getNextChallengeEpochCall.OutputType}
 * @throws Errors {@link getNextChallengeEpochCall.ErrorType}
 */
export function getNextChallengeEpochCall(options: getNextChallengeEpochCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getNextChallengeEpoch',
    args: [options.dataSetId],
  } satisfies getNextChallengeEpochCall.OutputType
}
