import { type Chain, type Client, isAddressEqual, type ReadContractErrorType, type Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import type { Page, paginate } from '../pagination.ts'
import { type dataSetLive, dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import type { getActivePiecesByCursor } from '../pdp-verifier/get-active-pieces-by-cursor.ts'
import { type getDataSetLeafCount, getDataSetLeafCountCall } from '../pdp-verifier/get-data-set-leaf-count.ts'
import { type getDataSetListener, getDataSetListenerCall } from '../pdp-verifier/get-data-set-listener.ts'
import { type getPDPProvider, getPDPProviderCall, parsePDPProvider } from '../sp-registry/get-pdp-provider.ts'
import type { PDPProvider } from '../sp-registry/types.ts'
import {
  type getAllDataSetMetadata,
  getAllDataSetMetadataCall,
  parseAllDataSetMetadata,
} from './get-all-data-set-metadata.ts'
import { getClientDataSets } from './get-client-data-sets.ts'
import type { DataSetInfo, PdpDataSet } from './types.ts'

const ENRICHMENT_BATCH_SIZE = 20
// Keep aligned with DataSetEnrichmentResults and the per-data-set entries in dataSetCalls.
const DATA_SET_CALL_COUNT = 4

type DataSetEnrichmentResults = [
  dataSetLive.OutputType,
  getDataSetListener.ContractOutputType,
  getAllDataSetMetadata.ContractOutputType,
  getDataSetLeafCount.OutputType,
]

export namespace getPdpDataSets {
  export type OptionsType = getClientDataSets.OptionsType

  /** A page of PDP data set info entries. */
  export type OutputType = Page<PdpDataSet>

  export type ErrorType = getClientDataSets.ErrorType | ReadContractErrorType
}

/**
 * Get one bounded page of enriched PDP data sets.
 *
 * Only the current source page is enriched, in bounded batches with source
 * order preserved. Pass `nextCursor` back as `cursor`; treat it as
 * opaque. Use {@link paginate} to traverse every page. Results report piece
 * presence from a non-zero {@link getDataSetLeafCount} read, which is an O(1)
 * storage lookup, rather than scanning piece IDs. Exact active-piece counts are
 * omitted because the contract's count getter performs a linear scan and can
 * fail for large data sets. To derive a count explicitly, traverse
 * {@link getActivePiecesByCursor} and count the yielded pieces.
 *
 * @param client - The client to use to get data sets for a client address.
 * @param options - {@link getPdpDataSets.OptionsType}
 * @returns A page of PDP data set info entries {@link getPdpDataSets.OutputType}
 * @throws Errors {@link getPdpDataSets.ErrorType}
 *
 * @example Read the first page
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
 * const address = '0x0000000000000000000000000000000000000000'
 * const page = await getPdpDataSets(client, { address })
 * console.log(page.items, page.nextCursor)
 * ```
 *
 * @example Iterate over every page
 * ```ts
 * import { paginate } from '@filoz/synapse-core'
 * import { getPdpDataSets } from '@filoz/synapse-core/warm-storage'
 *
 * for await (const dataSet of paginate(({ cursor }) =>
 *   getPdpDataSets(client, { address, cursor })
 * )) {
 *   console.log(dataSet.dataSetId)
 * }
 * ```
 */
export async function getPdpDataSets(
  client: Client<Transport, Chain>,
  options: getPdpDataSets.OptionsType
): Promise<getPdpDataSets.OutputType> {
  const page = await getClientDataSets(client, options)
  const items: PdpDataSet[] = []
  const providers = new Map<bigint, PDPProvider>()

  for (let offset = 0; offset < page.items.length; offset += ENRICHMENT_BATCH_SIZE) {
    const dataSets = page.items.slice(offset, offset + ENRICHMENT_BATCH_SIZE)
    items.push(...(await enrichDataSetBatch(client, dataSets, providers)))
  }

  return {
    items,
    ...(page.nextCursor == null ? {} : { nextCursor: page.nextCursor }),
  }
}

/**
 * Enrich one bounded batch of source data sets with their PDP state, metadata,
 * provider details, and active-piece presence.
 *
 * The four data-set-specific reads are flattened into one Viem multicall. PDP
 * provider reads are deduplicated by provider ID and cached in `providers`, so
 * a provider shared by multiple data sets—or by multiple batches in the same
 * page—is read only once. Viem retains its default multicall byte limit and may
 * safely split the flattened calls into smaller RPC requests.
 *
 * Results are reconstructed in the same order as `dataSets`. With
 * `allowFailure: false`, any failed contract read rejects the entire batch and
 * prevents a partially enriched page from being returned.
 *
 * @param client - Client used to execute the enrichment multicall.
 * @param dataSets - Source data sets to enrich, in page order.
 * @param providers - Page-local cache populated with decoded PDP providers.
 * @returns The enriched data sets in the same order as the source batch.
 * @throws When any contract read or provider decoding fails.
 */
async function enrichDataSetBatch(
  client: Client<Transport, Chain>,
  dataSets: DataSetInfo[],
  providers: Map<bigint, PDPProvider>
): Promise<PdpDataSet[]> {
  const chain = asChain(client.chain)
  const missingProviderIds = [...new Set(dataSets.map(({ providerId }) => providerId))].filter(
    (providerId) => !providers.has(providerId)
  )
  const dataSetCalls = dataSets.flatMap(({ dataSetId }) => [
    dataSetLiveCall({ chain: client.chain, dataSetId }),
    getDataSetListenerCall({ chain: client.chain, dataSetId }),
    getAllDataSetMetadataCall({ chain: client.chain, dataSetId }),
    getDataSetLeafCountCall({ chain: client.chain, dataSetId }),
  ])
  const providerCalls = missingProviderIds.map((providerId) => getPDPProviderCall({ chain: client.chain, providerId }))
  const results = await multicall(client, {
    allowFailure: false,
    // Retain Viem's default 1024-byte batch size so large chunks are split safely.
    contracts: [...dataSetCalls, ...providerCalls],
  })
  const dataSetResultCount = dataSets.length * DATA_SET_CALL_COUNT
  const providerResults = results.slice(dataSetResultCount) as getPDPProvider.ContractOutputType[]

  for (const [index, providerId] of missingProviderIds.entries()) {
    const result = providerResults[index]
    if (result == null) {
      throw new Error(`Missing PDP provider result for provider ${providerId}`)
    }
    providers.set(providerId, parsePDPProvider(result))
  }

  return dataSets.map((dataSet, index) => {
    const resultOffset = index * DATA_SET_CALL_COUNT
    const [live, listener, rawMetadata, leafCount] = results.slice(
      resultOffset,
      resultOffset + DATA_SET_CALL_COUNT
    ) as DataSetEnrichmentResults
    const provider = providers.get(dataSet.providerId)
    if (provider == null) {
      throw new Error(`Missing PDP provider for provider ${dataSet.providerId}`)
    }
    const metadata = parseAllDataSetMetadata(rawMetadata)

    return {
      ...dataSet,
      live,
      managed: isAddressEqual(listener, chain.contracts.fwss.address),
      cdn: dataSet.cdnRailId > 0n && 'withCDN' in metadata,
      metadata,
      provider,
      hasActivePieces: leafCount > 0n,
    }
  })
}
