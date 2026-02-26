import type { Address, Chain, Client, Transport } from 'viem'
import { getProviderIds } from '../endorsements/get-provider-ids.ts'
import { getApprovedPDPProviders } from '../sp-registry/get-pdp-providers.ts'
import { getPdpDataSets } from './get-pdp-data-sets.ts'
import type { ProviderSelectionInput } from './location-types.ts'

export namespace fetchProviderSelectionInput {
  export type OptionsType = {
    /** Client wallet address (for dataset lookup) */
    address: Address
  }
}

/**
 * Fetch all chain data needed for provider selection.
 *
 * Executes parallel queries for:
 *   - Approved PDP providers (via spRegistry)
 *   - Endorsed provider IDs (via endorsements)
 *   - Client's existing datasets with enrichment (via getPdpDataSets)
 *
 * Returns a ProviderSelectionInput ready to pass to selectProviders().
 *
 * For users who need custom caching or only need a subset of this data,
 * assemble ProviderSelectionInput manually instead.
 *
 * @param client - Viem public client configured for the target chain
 * @param options - Client address for dataset lookup
 * @returns ProviderSelectionInput (caller provides metadata via selectProviders options)
 */
export async function fetchProviderSelectionInput(
  client: Client<Transport, Chain>,
  options: fetchProviderSelectionInput.OptionsType
): Promise<ProviderSelectionInput> {
  const [providers, endorsedIds, pdpDataSets] = await Promise.all([
    getApprovedPDPProviders(client),
    getProviderIds(client),
    getPdpDataSets(client, { address: options.address }),
  ])

  return {
    providers,
    endorsedIds,
    clientDataSets: pdpDataSets,
  }
}
