import type { Address, Chain, Client, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { getEndorsedProviderIds } from '../endorsements/get-endorsed-provider-ids.ts'
import { PDPProviderUnavailableError } from '../errors/warm-storage.ts'
import { paginate } from '../pagination.ts'
import { getPDPProvidersByIds } from '../sp-registry/get-pdp-providers.ts'
import type { MetadataObject } from '../utils/metadata.ts'
import { getPdpDataSets } from './get-pdp-data-sets.ts'
import type { ResolvedLocation } from './location-types.ts'
import { selectProviders } from './select-providers.ts'

export namespace resolveProviderLocations {
  export type OptionsType = {
    /** Client wallet address (for dataset lookup) */
    address: Address
    /** The providers to resolve a location on */
    providerIds: bigint[]
    /** Desired metadata for dataset matching (empty object matches only empty-metadata datasets). Defaults to `{}`. */
    metadata?: MetadataObject
  }

  /** One location per entry in `providerIds`, in the same order: the provider's best matching dataset, or a new-dataset location. */
  export type OutputType = ResolvedLocation[]

  export type ErrorType =
    | getPDPProvidersByIds.ErrorType
    | getEndorsedProviderIds.ErrorType
    | getPdpDataSets.ErrorType
    | PDPProviderUnavailableError
}

/**
 * Resolve the location to store on for each of a set of specific providers.
 *
 * Reads the providers from the registry, so they do not need to be approved,
 * and the client's data sets with {@link getPdpDataSets} once, then selects
 * with {@link selectProviders} and `providerId` for each provider. Each
 * location is the provider's best metadata-matching data set, or a new-dataset
 * location when none matches.
 *
 * This function does NOT ping the providers.
 *
 * @example
 * ```ts
 * import { resolveProviderLocations } from '@filoz/synapse-core/warm-storage'
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const [first, second] = await resolveProviderLocations(client, {
 *   address: '0x1234567890123456789012345678901234567890',
 *   providerIds: [1n, 2n],
 *   metadata: { source: 'my-app' },
 * })
 *
 * console.log(first.dataSetId ?? 'new data set', second.dataSetId ?? 'new data set')
 * ```
 *
 * @param client - The client to use to read the providers and data sets.
 * @param options - {@link resolveProviderLocations.OptionsType}
 * @returns The resolved locations {@link resolveProviderLocations.OutputType}
 * @throws Errors {@link resolveProviderLocations.ErrorType}. Throws
 *   `PDPProviderUnavailableError` for the first provider that does not exist
 *   or has no active PDP product.
 */
export async function resolveProviderLocations(
  client: Client<Transport, Chain>,
  options: resolveProviderLocations.OptionsType
): Promise<resolveProviderLocations.OutputType> {
  const { providerIds } = options
  if (providerIds.length === 0) return []

  const [providers, endorsedIds, clientDataSets] = await Promise.all([
    getPDPProvidersByIds(client, { providerIds }),
    getEndorsedProviderIds(client),
    Array.fromAsync(paginate(({ cursor }) => getPdpDataSets(client, { address: options.address, cursor }))),
  ])
  const legacyPieceStorageIdLimit = asChain(client.chain).legacyPieceStorageIdLimit

  return providerIds.map((providerId) => {
    // selectProviders returns the explicit provider whenever it is in `providers`
    const [location] = selectProviders({
      providers,
      endorsedIds,
      clientDataSets,
      legacyPieceStorageIdLimit,
      metadata: options.metadata,
      providerId,
    })
    if (location == null) {
      throw new PDPProviderUnavailableError(providerId)
    }
    return location
  })
}
