import type { Address, Chain } from 'viem'
import { getEndorsedProviderIds } from '../endorsements/get-endorsed-provider-ids.ts'
import { paginate } from '../pagination.ts'
import { getApprovedPDPProviders } from '../sp-registry/get-pdp-providers.ts'
import type { ReadClient } from '../types.ts'
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
 * @param client - The read-only client to use to fetch provider selection input.
 * @param options - Client address for dataset lookup
 * @returns ProviderSelectionInput (caller provides metadata via selectProviders options)
 */
export async function fetchProviderSelectionInput<chain extends Chain>(
  client: ReadClient<chain>,
  options: fetchProviderSelectionInput.OptionsType
): Promise<ProviderSelectionInput> {
  const [providers, endorsedIds, pdpDataSets] = await Promise.all([
    getApprovedPDPProviders(client),
    getEndorsedProviderIds(client),
    Array.fromAsync(paginate(({ cursor }) => getPdpDataSets(client, { address: options.address, cursor }))),
  ])

  return {
    providers,
    endorsedIds,
    clientDataSets: pdpDataSets,
  }
}
