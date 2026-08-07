import { type Address, type Chain, isAddressEqual, type ReadContractErrorType } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import { dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import type { getActivePiecesByCursor } from '../pdp-verifier/get-active-pieces-by-cursor.ts'
import { type getDataSetLeafCount, getDataSetLeafCountCall } from '../pdp-verifier/get-data-set-leaf-count.ts'
import { getDataSetListenerCall } from '../pdp-verifier/get-data-set-listener.ts'
import { getPDPProviderCall, parsePDPProvider } from '../sp-registry/get-pdp-provider.ts'
import type { ReadClient } from '../types.ts'
import { getAllDataSetMetadataCall, parseAllDataSetMetadata } from './get-all-data-set-metadata.ts'
import { getDataSet } from './get-data-set.ts'
import type { DataSetInfo, PdpDataSet, PdpDataSetInfo } from './types.ts'

export namespace getPdpDataSet {
  export type OptionsType = {
    /** The ID of the data set to get. */
    dataSetId: bigint
    /** Warm storage contract address. If not provided, the default is the storage view contract address for the chain. */
    contractAddress?: Address
  }

  /** PDP data set or undefined if the data set does not exist. */
  export type OutputType = PdpDataSet | null

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get a PDP data set by ID.
 *
 * The result reports piece presence from a non-zero {@link getDataSetLeafCount}
 * read, which is an O(1) storage lookup, rather than scanning piece IDs. Exact
 * active-piece counts are omitted because the contract's count getter performs
 * a linear scan and can fail for large data sets. To derive an exact count
 * explicitly, traverse {@link getActivePiecesByCursor} with `paginate` and
 * count the yielded pieces.
 *
 * @param client - The read-only client to use to get the PDP data set.
 * @param options - {@link getPdpDataSet.OptionsType}
 * @returns PDP data set or undefined if the data set does not exist {@link getPdpDataSet.OutputType}
 * @throws Errors {@link getPdpDataSet.ErrorType}
 *
 * @example
 * ```ts
 * import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const dataSet = await getPdpDataSet(client, {
 *   dataSetId: 1n,
 * })
 *
 * if (dataSet) {
 *   console.log(dataSet.dataSetId)
 * } else {
 *   console.log('Data set does not exist')
 * }
 * ```
 */
export async function getPdpDataSet<chain extends Chain>(
  client: ReadClient<chain>,
  options: getPdpDataSet.OptionsType
): Promise<getPdpDataSet.OutputType> {
  const data = await getDataSet(client, options)
  if (!data) {
    return null
  }

  const pdpInfo = await readPdpDataSetInfo(client, {
    dataSetInfo: data,
    providerId: data.providerId,
  })

  return {
    ...data,
    ...pdpInfo,
  }
}

/**
 * Read PDP data set information.
 *
 * @param client - The read-only client to use to read the PDP data set info.
 * @param options
 * @returns PDP data set info {@link PdpDataSetInfo}
 */
export async function readPdpDataSetInfo<chain extends Chain>(
  client: ReadClient<chain>,
  options: {
    dataSetInfo: DataSetInfo
    providerId: bigint
  }
): Promise<PdpDataSetInfo> {
  const chain = asChain(client.chain)
  const [live, listener, _metadata, _pdpProvider, leafCount] = await multicall(client, {
    allowFailure: false,
    contracts: [
      dataSetLiveCall({
        chain: client.chain,
        dataSetId: options.dataSetInfo.dataSetId,
      }),
      getDataSetListenerCall({
        chain: client.chain,
        dataSetId: options.dataSetInfo.dataSetId,
      }),
      getAllDataSetMetadataCall({
        chain: client.chain,
        dataSetId: options.dataSetInfo.dataSetId,
      }),
      getPDPProviderCall({
        chain: client.chain,
        providerId: options.providerId,
      }),
      getDataSetLeafCountCall({
        chain: client.chain,
        dataSetId: options.dataSetInfo.dataSetId,
      }),
    ],
  })

  const pdpProvider = parsePDPProvider(_pdpProvider)
  const metadata = parseAllDataSetMetadata(_metadata)

  return {
    live,
    managed: isAddressEqual(listener, chain.contracts.fwss.address),
    cdn: options.dataSetInfo.cdnRailId > 0n && 'withCDN' in metadata,
    metadata,
    provider: pdpProvider,
    hasActivePieces: leafCount > 0n,
  }
}
