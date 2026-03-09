import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import type { asChain } from '../chains.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { getDataSetLeafCountCall } from './get-data-set-leaf-count.ts'

export namespace getDataSetSizes {
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
 * Get the sizes of one or more data sets in bytes via a single multicall.
 *
 * Takes an array of dataset IDs and returns an array of sizes in the same order.
 * Uses multicall internally for efficiency.
 *
 * @example
 * ```ts
 * import { getDataSetSizes } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const sizes = await getDataSetSizes(client, {
 *   dataSetIds: [1n, 2n, 3n],
 * })
 *
 * // Single dataset
 * const [size] = await getDataSetSizes(client, { dataSetIds: [1n] })
 * ```
 *
 * @param client - The client to use.
 * @param options - {@link getDataSetSizes.OptionsType}
 * @returns Array of data set sizes in bytes {@link getDataSetSizes.OutputType}
 * @throws Errors {@link getDataSetSizes.ErrorType}
 */
export async function getDataSetSizes(
  client: Client<Transport, Chain>,
  options: getDataSetSizes.OptionsType
): Promise<getDataSetSizes.OutputType> {
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
