import { type Address, type Chain, type Client, isAddressEqual, type Transport } from 'viem'
import { multicall } from 'viem/actions'
import { asChain } from '../chains.ts'
import { getProviderIds } from '../endorsements/get-provider-ids.ts'
import { dataSetLiveCall } from '../pdp-verifier/data-set-live.ts'
import { getActivePieceCountCall } from '../pdp-verifier/get-active-piece-count.ts'
import { getDataSetListenerCall } from '../pdp-verifier/get-data-set-listener.ts'
import { getApprovedPDPProviders } from '../sp-registry/get-pdp-providers.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import { getAllDataSetMetadataCall, parseAllDataSetMetadata } from './get-all-data-set-metadata.ts'
import { getClientDataSets } from './get-client-data-sets.ts'
import type { ProviderSelectionInput, SelectionDataSet } from './location-types.ts'

export namespace fetchProviderSelectionInput {
  export type OptionsType = {
    /** Client wallet address (for dataset lookup) */
    address: Address
    /** Desired metadata for dataset matching */
    metadata: MetadataObject
  }
}

/**
 * Fetch all chain data needed for provider selection.
 *
 * Executes parallel queries for:
 *   - Approved PDP providers (via spRegistry)
 *   - Endorsed provider IDs (via endorsements)
 *   - Client's existing datasets (via warmStorage view)
 *
 * Then enriches datasets with a single batched multicall for:
 *   - Live status, listener (managed check), metadata, active piece count
 *
 * Returns a ProviderSelectionInput ready to pass to selectProviders().
 *
 * For users who need custom caching or only need a subset of this data,
 * assemble ProviderSelectionInput manually instead.
 *
 * @param client - Viem public client configured for the target chain
 * @param options - Client address and desired metadata
 * @returns ProviderSelectionInput with all fields populated
 */
export async function fetchProviderSelectionInput(
  client: Client<Transport, Chain>,
  options: fetchProviderSelectionInput.OptionsType
): Promise<ProviderSelectionInput> {
  const chain = asChain(client.chain)

  // Parallel fetch of providers, endorsements, and base dataset info
  const [providers, endorsedIds, baseDataSets] = await Promise.all([
    getApprovedPDPProviders(client),
    getProviderIds(client),
    getClientDataSets(client, { address: options.address }),
  ])

  if (baseDataSets.length === 0) {
    return {
      providers,
      endorsedIds,
      clientDataSets: [],
      metadata: options.metadata,
    }
  }

  // Single batched multicall: 4 items per dataset (live, listener, metadata, pieceCount)
  const CALLS_PER_DS = 4
  const results = await multicall(client, {
    allowFailure: false,
    contracts: baseDataSets.flatMap((ds) => [
      dataSetLiveCall({ chain: client.chain, dataSetId: ds.dataSetId }),
      getDataSetListenerCall({ chain: client.chain, dataSetId: ds.dataSetId }),
      getAllDataSetMetadataCall({ chain: client.chain, dataSetId: ds.dataSetId }),
      getActivePieceCountCall({ chain: client.chain, dataSetId: ds.dataSetId }),
    ]),
  })

  const clientDataSets: SelectionDataSet[] = baseDataSets.map((ds, i) => {
    const base = i * CALLS_PER_DS
    const live = results[base] as boolean
    const listener = results[base + 1] as Address
    const rawMetadata = parseAllDataSetMetadata(results[base + 2] as [readonly string[], readonly string[]])
    const activePieceCount = results[base + 3] as bigint

    return {
      dataSetId: ds.dataSetId,
      providerId: ds.providerId,
      metadata: rawMetadata,
      activePieceCount,
      pdpEndEpoch: ds.pdpEndEpoch,
      live,
      managed: isAddressEqual(listener, chain.contracts.fwss.address),
    }
  })

  return {
    providers,
    endorsedIds,
    clientDataSets,
    metadata: options.metadata,
  }
}
