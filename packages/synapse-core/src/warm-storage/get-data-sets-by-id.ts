import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import type { getDataSet } from './get-data-set.ts'
import { getDataSetCall, parseGetDataSet } from './get-data-set.ts'

export namespace getDataSetsById {
  export type OptionsType = {
    /** IDs of the data sets to get. Duplicate IDs are read once. */
    dataSetIds: readonly bigint[]
    /** Warm storage contract address. If not provided, the chain's default FWSS view contract is used. */
    contractAddress?: Address
  }

  /** Data-set information indexed by ID. Missing data sets map to null. */
  export type OutputType = Map<bigint, getDataSet.OutputType>

  export type ErrorType = MulticallErrorType | getDataSetCall.ErrorType
}

/**
 * Get one or more FWSS data sets by ID via a single multicall.
 *
 * Duplicate IDs are read once and empty input returns an empty map. Every
 * requested ID is present in the result; a non-existent data set maps to
 * `null`, matching {@link getDataSet}.
 *
 * @param client - The client to use to get the data sets
 * @param options - {@link getDataSetsById.OptionsType}
 * @returns Data-set information indexed by ID {@link getDataSetsById.OutputType}
 * @throws Errors {@link getDataSetsById.ErrorType}
 *
 * @example
 * ```ts
 * import { getDataSetsById } from '@filoz/synapse-core/warm-storage'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSets = await getDataSetsById(client, {
 *   dataSetIds: [1n, 2n],
 * })
 *
 * console.log(dataSets.get(1n))
 * ```
 */
export async function getDataSetsById(
  client: Client<Transport, Chain>,
  options: getDataSetsById.OptionsType
): Promise<getDataSetsById.OutputType> {
  if (options.dataSetIds.length === 0) {
    return new Map()
  }

  const dataSetIds = [...new Set(options.dataSetIds)]
  const results = await multicall(client, {
    contracts: dataSetIds.map((dataSetId) =>
      getDataSetCall({
        chain: client.chain,
        dataSetId,
        contractAddress: options.contractAddress,
      })
    ),
    allowFailure: false,
  })

  return new Map(results.map((result, index) => [dataSetIds[index], parseGetDataSet(result)]))
}
