import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import type { asChain } from '../chains.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { getDataSetLeafCount, getDataSetLeafCountCall } from './get-data-set-leaf-count.ts'

export namespace getDatasetSize {
  export type OptionsType = {
    /** The ID of the data set to get the size for. */
    dataSetId: bigint
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  /** Size in bytes */
  export type OutputType = bigint

  export type ErrorType = getDataSetLeafCount.ErrorType
}

/**
 * Get the size of a data set in bytes.
 *
 * Wraps `getDataSetLeafCount` and converts leaf count to bytes using `BYTES_PER_LEAF`.
 *
 * @example
 * ```ts
 * import { getDatasetSize } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const sizeInBytes = await getDatasetSize(client, { dataSetId: 1n })
 * ```
 *
 * @param client - The client to use.
 * @param options - {@link getDatasetSize.OptionsType}
 * @returns The data set size in bytes {@link getDatasetSize.OutputType}
 * @throws Errors {@link getDatasetSize.ErrorType}
 */
export async function getDatasetSize(
  client: Client<Transport, Chain>,
  options: getDatasetSize.OptionsType
): Promise<getDatasetSize.OutputType> {
  const leafCount = await getDataSetLeafCount(client, {
    dataSetId: options.dataSetId,
    contractAddress: options.contractAddress,
  })
  return leafCount * SIZE_CONSTANTS.BYTES_PER_LEAF
}

export namespace getMultiDatasetSize {
  export type OptionsType = {
    /** The IDs of the data sets to get sizes for. */
    dataSetIds: bigint[]
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  /** Sizes in bytes, same order as input dataSetIds */
  export type OutputType = bigint[]

  export type ErrorType = MulticallErrorType | asChain.ErrorType
}

/**
 * Get the sizes of multiple data sets in bytes via a single multicall.
 *
 * Takes an array of dataset IDs and returns an array of sizes in the same order.
 * Uses multicall internally for efficiency.
 *
 * @example
 * ```ts
 * import { getMultiDatasetSize } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const sizes = await getMultiDatasetSize(client, {
 *   dataSetIds: [1n, 2n, 3n],
 * })
 * ```
 *
 * @param client - The client to use.
 * @param options - {@link getMultiDatasetSize.OptionsType}
 * @returns Array of data set sizes in bytes {@link getMultiDatasetSize.OutputType}
 * @throws Errors {@link getMultiDatasetSize.ErrorType}
 */
export async function getMultiDatasetSize(
  client: Client<Transport, Chain>,
  options: getMultiDatasetSize.OptionsType
): Promise<getMultiDatasetSize.OutputType> {
  if (options.dataSetIds.length === 0) {
    return []
  }

  const contracts = options.dataSetIds.map((dataSetId) =>
    getDataSetLeafCountCall({
      chain: client.chain,
      dataSetId,
      contractAddress: options.contractAddress,
    })
  )

  const leafCounts = await multicall(client, {
    contracts,
    allowFailure: false,
  })

  return (leafCounts as bigint[]).map((leafCount) => leafCount * SIZE_CONSTANTS.BYTES_PER_LEAF)
}
