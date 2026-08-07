import type { Simplify } from 'type-fest'
import {
  type Address,
  type Chain,
  type Client,
  type ContractFunctionParameters,
  type ContractFunctionReturnType,
  type ReadContractErrorType,
  type Transport,
  zeroAddress,
} from 'viem'
import { readContract } from 'viem/actions'
import type { pdpVerifierAbi } from '../abis/generated.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'
import { STRING_ERRORS, stringErrorEquals } from '../utils/contract-errors.ts'

export namespace getDataSetStorageProvider {
  export type OptionsType = {
    /** The ID of the data set to get the storage provider for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  /**
   * `[storageProvider, proposedStorageProvider]`
   * - `storageProvider`: The storage provider address
   * - `proposedStorageProvider`: The proposed storage provider address or null if no proposed storage provider
   */
  export type OutputType = readonly [storageProvider: Address, proposedStorageProvider: Address | null] | null

  export type ContractOutputType = ContractFunctionReturnType<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'getDataSetStorageProvider'
  >

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get the storage provider addresses for a data set
 *
 * @example
 * ```ts
 * import { getDataSetStorageProvider } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [storageProvider, proposedStorageProvider] = await getDataSetStorageProvider(client, {
 *   dataSetId: 1n,
 * })
 * ```
 *
 * @param client - The client to use to get the data set storage provider.
 * @param options - {@link getDataSetStorageProvider.OptionsType}
 * @returns The storage provider addresses for the data set {@link getDataSetStorageProvider.OutputType}. Returns null if the data set is not live or does not exist.
 * @throws Errors {@link getDataSetStorageProvider.ErrorType}
 */
export async function getDataSetStorageProvider(
  client: Client<Transport, Chain>,
  options: getDataSetStorageProvider.OptionsType
): Promise<getDataSetStorageProvider.OutputType> {
  try {
    const data = await readContract(
      client,
      getDataSetStorageProviderCall({
        chain: client.chain,
        dataSetId: options.dataSetId,
        contractAddress: options.contractAddress,
      })
    )
    return parseDataSetStorageProvider(data)
  } catch (error) {
    if (stringErrorEquals(error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE)) {
      return null
    }
    throw error
  }
}

export namespace getDataSetStorageProviderCall {
  export type OptionsType = Simplify<getDataSetStorageProvider.OptionsType & ActionCallChain>
  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<
    typeof pdpVerifierAbi,
    'pure' | 'view',
    'getDataSetStorageProvider'
  >
}

/**
 * Create a call to the getDataSetStorageProvider function
 *
 * This function is used to create a call to the getDataSetStorageProvider function for use with the multicall or readContract function.
 *
 * @example
 * ```ts
 * import { getDataSetStorageProviderCall } from '@filoz/synapse-core/pdp-verifier'
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
 *     getDataSetStorageProviderCall({ chain: calibration, dataSetId: 1n }),
 *     getDataSetStorageProviderCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 * ```
 *
 * @param options - {@link getDataSetStorageProviderCall.OptionsType}
 * @returns The call to the getDataSetStorageProvider function {@link getDataSetStorageProviderCall.OutputType}
 * @throws Errors {@link getDataSetStorageProviderCall.ErrorType}
 */
export function getDataSetStorageProviderCall(options: getDataSetStorageProviderCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.pdp.abi,
    address: options.contractAddress ?? chain.contracts.pdp.address,
    functionName: 'getDataSetStorageProvider',
    args: [options.dataSetId],
  } satisfies getDataSetStorageProviderCall.OutputType
}

/**
 * Parse the contract output into a {@link getDataSetStorageProvider.OutputType}.
 *
 * @param data - The contract output from the getDataSetStorageProvider function {@link getDataSetStorageProvider.ContractOutputType}
 * @returns The storage provider addresses for the data set {@link getDataSetStorageProvider.OutputType}
 */
export function parseDataSetStorageProvider(
  data: getDataSetStorageProvider.ContractOutputType
): getDataSetStorageProvider.OutputType {
  return [data[0], data[1] === zeroAddress ? null : data[1]]
}
