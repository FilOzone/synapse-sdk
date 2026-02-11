import { type Address, type Chain, type Client, isAddressEqual, type ReadContractErrorType, type Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import { dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import { getDataSetListenerCall } from '../pdp-verifier/get-data-set-listener.ts'
import { getPDPProviderCall, parsePDPProvider } from '../sp-registry/get-pdp-provider.ts'
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
  export type OutputType = PdpDataSet | undefined

  export type ErrorType = asChain.ErrorType | ReadContractErrorType
}

/**
 * Get a PDP data set by ID
 *
 * @param client - The client to use to get the PDP data set.
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
export async function getPdpDataSet(
  client: Client<Transport, Chain>,
  options: getPdpDataSet.OptionsType
): Promise<getPdpDataSet.OutputType> {
  const data = await getDataSet(client, options)
  if (!data) {
    return undefined
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
 * Read the PDP data set info.
 *
 * @param client - The client to use to read the PDP data set info.
 * @param options
 * @returns PDP data set info {@link PdpDataSetInfo}
 */
export async function readPdpDataSetInfo(
  client: Client<Transport, Chain>,
  options: {
    dataSetInfo: DataSetInfo
    providerId: bigint
  }
): Promise<PdpDataSetInfo> {
  const chain = asChain(client.chain)
  const [live, listener, _metadata, _pdpProvider] = await multicall(client, {
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
  }
}
