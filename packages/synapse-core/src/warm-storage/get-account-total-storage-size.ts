import type { Address, Chain, Client, MulticallErrorType, Transport } from 'viem'
import { multicall } from 'viem/actions'
import { paginate } from '../pagination.ts'
import { dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import { getDataSetLeafCountCall } from '../pdp-verifier/get-data-set-leaf-count.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
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
    /** Total storage size in bytes across all live datasets. */
    totalSizeBytes: bigint
    /** Number of live datasets. */
    datasetCount: number
  }

  export type ErrorType = getClientDataSets.ErrorType | MulticallErrorType
}

/**
 * Get the total storage size across all live datasets for an account.
 *
 * Fetches all datasets for the given address from FWSS, checks liveness via
 * PDP Verifier, and sums the sizes of live datasets.
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
    const calls = dataSets.flatMap((dataSet) => [
      dataSetLiveCall({
        chain: client.chain,
        dataSetId: dataSet.dataSetId,
        contractAddress: options.pdpContractAddress,
      }),
      getDataSetLeafCountCall({
        chain: client.chain,
        dataSetId: dataSet.dataSetId,
        contractAddress: options.pdpContractAddress,
      }),
    ])
    if (calls.length > 0) {
      const results = await multicall(client, { contracts: calls, allowFailure: false })
      for (let index = 0; index < dataSets.length; index++) {
        const isLive = results[index * 2] as boolean
        const leafCount = results[index * 2 + 1] as bigint
        if (isLive) {
          totalSizeBytes += leafCount * SIZE_CONSTANTS.BYTES_PER_LEAF
          datasetCount++
        }
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
