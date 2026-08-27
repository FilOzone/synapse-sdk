import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import type { asChain } from '../chains.ts'
import { STRING_ERRORS, stringErrorEquals } from '../utils/contract-errors.ts'
import { type getDataSetLeafCount, getDataSetLeafCountCall } from './get-data-set-leaf-count.ts'

export namespace getDataSetLeafCounts {
  export type OptionsType = {
    /** IDs of the data sets to get leaf counts for. */
    dataSetIds: readonly bigint[]
    /** PDP Verifier contract address. If not provided, the default is the PDP Verifier contract address for the chain. */
    contractAddress?: Address
  }

  /** PDP leaf count indexed by data set ID. */
  export type OutputType = Map<bigint, bigint>

  export type ErrorType = MulticallErrorType | asChain.ErrorType
}

/**
 * Get the PDP leaf counts for one or more data sets via a single multicall.
 *
 * A data set that is not live is represented by `0n`, matching
 * {@link getDataSetLeafCount}. Duplicate IDs are read once. The returned leaf
 * counts are not converted to byte sizes, so callers can aggregate counts
 * before applying pricing conversions.
 *
 * @param client - The client to use to get the data set leaf counts.
 * @param options - {@link getDataSetLeafCounts.OptionsType}
 * @returns Leaf counts indexed by data set ID {@link getDataSetLeafCounts.OutputType}
 * @throws Errors {@link getDataSetLeafCounts.ErrorType}
 *
 * @example
 * ```ts
 * import { getDataSetLeafCounts } from '@filoz/synapse-core/pdp-verifier'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const leafCounts = await getDataSetLeafCounts(client, {
 *   dataSetIds: [1n, 2n, 3n],
 * })
 *
 * console.log(leafCounts.get(1n))
 * ```
 */
export async function getDataSetLeafCounts(
  client: Client<Transport, Chain>,
  options: getDataSetLeafCounts.OptionsType
): Promise<getDataSetLeafCounts.OutputType> {
  if (options.dataSetIds.length === 0) {
    return new Map()
  }

  const dataSetIds = [...new Set(options.dataSetIds)]
  const results = await multicall(client, {
    contracts: dataSetIds.map((dataSetId) =>
      getDataSetLeafCountCall({
        chain: client.chain,
        dataSetId,
        contractAddress: options.contractAddress,
      })
    ),
    allowFailure: true,
  })

  return new Map(
    results.map((result, index) => {
      const dataSetId = dataSetIds[index]

      if (result.error == null) {
        return [dataSetId, result.result]
      }

      if (stringErrorEquals(result.error, STRING_ERRORS.PDP_VERIFIER_DATA_SET_NOT_LIVE)) {
        return [dataSetId, 0n]
      }

      throw result.error
    })
  )
}
