import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { paginate } from '../pagination.ts'
import { dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import { getDataSetLeafCountCall } from '../pdp-verifier/get-data-set-leaf-count.ts'
import { leafCountToRawSize } from '../utils/pdp-size.ts'
import { getClientDataSets } from './get-client-data-sets.ts'

export namespace getAccountTotalStorageSize {
  export type OptionsType = {
    /** Client address to query. */
    address: Address
    /** Warm storage view contract address override. */
    contractAddress?: Address
    /** PDP Verifier contract address override. */
    pdpContractAddress?: Address
  }

  export type OutputType = {
    /** Sum of the FWSS-priced approximate byte sizes of all live data sets. */
    totalSizeBytes: bigint
    /** Number of live datasets. */
    datasetCount: number
  }

  export type ErrorType = getClientDataSets.ErrorType | MulticallErrorType
}

/**
 * Get the total FWSS-priced approximate storage size for an account.
 *
 * Fetches all datasets for the given address from FWSS, checks liveness via
 * PDP Verifier, converts each aggregate data-set leaf count using the same
 * approximation as FWSS pricing, and sums the results. This is not the exact
 * sum of raw piece payload sizes.
 *
 * @example
 * ```ts
 * import { getAccountTotalStorageSize } from '@filoz/synapse-core/warm-storage'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createPublicClient, http } from 'viem'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { totalSizeBytes, datasetCount } = await getAccountTotalStorageSize(client, {
 *   address: '0x...',
 * })
 * ```
 *
 * @param client - The client to use to get the account total storage size.
 * @param options - {@link getAccountTotalStorageSize.OptionsType}
 * @returns Total storage size and dataset count {@link getAccountTotalStorageSize.OutputType}
 * @throws Errors {@link getAccountTotalStorageSize.ErrorType}
 */
export async function getAccountTotalStorageSize(
  client: Client<Transport, Chain>,
  options: getAccountTotalStorageSize.OptionsType
): Promise<getAccountTotalStorageSize.OutputType> {
  let totalSizeBytes = 0n
  let datasetCount = 0
  let dataSets: Array<getClientDataSets.OutputType['items'][number]> = []

  const processPage = async () => {
    if (dataSets.length === 0) return

    const liveResults = await multicall(client, {
      contracts: dataSets.map((dataSet) =>
        dataSetLiveCall({
          chain: client.chain,
          dataSetId: dataSet.dataSetId,
          contractAddress: options.pdpContractAddress,
        })
      ),
      allowFailure: false,
    })
    const liveDataSets = dataSets.filter((_, index) => liveResults[index])

    if (liveDataSets.length > 0) {
      const leafCounts = await multicall(client, {
        contracts: liveDataSets.map((dataSet) =>
          getDataSetLeafCountCall({
            chain: client.chain,
            dataSetId: dataSet.dataSetId,
            contractAddress: options.pdpContractAddress,
          })
        ),
        allowFailure: false,
      })

      for (const leafCount of leafCounts) {
        totalSizeBytes += leafCountToRawSize(leafCount)
        datasetCount++
      }
    }
    dataSets = []
  }

  for await (const dataSet of paginate(({ cursor }) =>
    getClientDataSets(client, {
      address: options.address,
      cursor,
      limit: 100n,
      contractAddress: options.contractAddress,
    })
  )) {
    dataSets.push(dataSet)
    if (dataSets.length === 100) {
      await processPage()
    }
  }
  await processPage()

  return { totalSizeBytes, datasetCount }
}
