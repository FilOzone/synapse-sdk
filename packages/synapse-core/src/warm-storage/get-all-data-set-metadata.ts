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
import type { fwssView as storageViewAbi } from '../abis/index.ts'
import { asChain } from '../chains.ts'
import type { ActionCallChain } from '../types.ts'
import { type MetadataObject, metadataArrayToObject } from '../utils/metadata.ts'

export namespace getAllDataSetMetadata {
  export type OptionsType = {
    /** The ID of the data set to get metadata for. */
    dataSetId: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }
  export type ContractOutputType = ContractFunctionReturnType<
    typeof storageViewAbi,
    'pure' | 'view',
    'getAllDataSetMetadata'
  >

  export type OutputType = MetadataObject

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get all metadata for a data set formatted as a MetadataObject
 *
 * @param client - The client to use to get the data set metadata.
 * @param options - {@link getAllDataSetMetadata.OptionsType}
 * @returns The metadata formatted as a MetadataObject {@link getAllDataSetMetadata.OutputType}
 * @throws Errors {@link getAllDataSetMetadata.ErrorType}
 *
 * @example
 * ```ts
 * import { getAllDataSetMetadata } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const metadata = await getAllDataSetMetadata(client, {
 *   dataSetId: 1n,
 * })
 *
 * console.log(metadata)
 * ```
 */
export async function getAllDataSetMetadata(
  client: Client<Transport, Chain>,
  options: getAllDataSetMetadata.OptionsType
): Promise<getAllDataSetMetadata.OutputType> {
  const data = await readContract(
    client,
    getAllDataSetMetadataCall({
      chain: client.chain,
      dataSetId: options.dataSetId,
      contractAddress: options.contractAddress,
    })
  )
  return parseAllDataSetMetadata(data)
}

export namespace getAllDataSetMetadataCall {
  export type OptionsType = Simplify<getAllDataSetMetadata.OptionsType & ActionCallChain>

  export type ErrorType = asChain.ErrorType
  export type OutputType = ContractFunctionParameters<typeof storageViewAbi, 'pure' | 'view', 'getAllDataSetMetadata'>
}

/**
 * Create a call to the getAllDataSetMetadata function
 *
 * This function is used to create a call to the getAllDataSetMetadata function for use with the multicall or readContract function.
 *
 * Use {@link parseAllDataSetMetadata} to parse the output into a MetadataObject.
 *
 * @param options - {@link getAllDataSetMetadataCall.OptionsType}
 * @returns The call to the getAllDataSetMetadata function {@link getAllDataSetMetadataCall.OutputType}
 * @throws Errors {@link getAllDataSetMetadataCall.ErrorType}
 *
 * @example
 * ```ts
 * import { getAllDataSetMetadataCall } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { multicall } from 'viem/actions'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const results = await multicall(client, {
 *   contracts: [
 *     getAllDataSetMetadataCall({ chain: calibration, dataSetId: 1n }),
 *     getAllDataSetMetadataCall({ chain: calibration, dataSetId: 2n }),
 *   ],
 * })
 *
 * const formattedMetadata = results.map(parseAllDataSetMetadata)
 *
 * console.log(formattedMetadata)
 * ```
 */
export function getAllDataSetMetadataCall(options: getAllDataSetMetadataCall.OptionsType) {
  const chain = asChain(options.chain)
  return {
    abi: chain.contracts.fwssView.abi,
    address: options.contractAddress ?? chain.contracts.fwssView.address,
    functionName: 'getAllDataSetMetadata',
    args: [options.dataSetId],
  } satisfies getAllDataSetMetadataCall.OutputType
}

/**
 * Parse the contract output into a MetadataObject
 *
 * @param data - The contract output from the getAllDataSetMetadata function {@link getAllDataSetMetadata.ContractOutputType}
 * @returns The metadata formatted as a MetadataObject {@link getAllDataSetMetadata.OutputType}
 */
export function parseAllDataSetMetadata(
  data: getAllDataSetMetadata.ContractOutputType
): getAllDataSetMetadata.OutputType {
  return metadataArrayToObject(data)
}
