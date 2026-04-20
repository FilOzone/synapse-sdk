import PQueue from 'p-queue'
import type { Chain, Client, ReadContractErrorType, Transport } from 'viem'
import type { asChain } from '../chains.ts'

import { type getClientDataSets, getClientDataSetsIterable } from './get-client-data-sets.ts'
import { readPdpDataSetInfo } from './get-pdp-data-set.ts'
import type { PdpDataSet } from './types.ts'

export namespace getPdpDataSets {
  export type OptionsType = getClientDataSets.OptionsType

  /** Array of PDP data set info entries */
  export type OutputType = PdpDataSet[]

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get PDP data sets
 *
 * @param client - The client to use to get data sets for a client address.
 * @param options - {@link getPdpDataSets.OptionsType}
 * @returns Array of PDP data set info entries {@link getPdpDataSets.OutputType}
 * @throws Errors {@link getPdpDataSets.ErrorType}
 *
 * @example
 * ```ts
 * import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSets = await getPdpDataSets(client, {
 *   client: '0x0000000000000000000000000000000000000000',
 * })
 *
 * console.log(dataSets[0]?.dataSetId)
 * ```
 */
export async function getPdpDataSets(
  client: Client<Transport, Chain>,
  options: getPdpDataSets.OptionsType
): Promise<getPdpDataSets.OutputType> {
  const queue = new PQueue({
    concurrency: 10,
    interval: 1000,
    intervalCap: 20,
    strict: true, // sliding window
  })

  const dataSets: PdpDataSet[] = []

  try {
    for await (const dataSet of getClientDataSetsIterable(client, {
      address: options.address,
      offset: options.offset,
    })) {
      await queue.onSizeLessThan(20)

      queue
        .add(async () => {
          const pdDataSetInfo = await readPdpDataSetInfo(client, {
            dataSetInfo: dataSet,
            providerId: dataSet.providerId,
          })
          dataSets.push({
            ...dataSet,
            ...pdDataSetInfo,
          })
        })
        .catch(() => {
          /* ignore */
        })
    }
    await Promise.race([queue.onError(), queue.onIdle()])
    return dataSets
  } catch (error) {
    queue.pause()
    throw error
  }
}
