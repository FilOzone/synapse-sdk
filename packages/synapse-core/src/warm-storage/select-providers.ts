import { findMatchingDataSets } from './find-matching-data-sets.ts'
import type { ProviderSelectionOptions, ResolvedLocation } from './location-types.ts'

/**
 * Select providers for storage from an eligible pool.
 *
 * The eligible provider pool is determined by `endorsedIds`:
 * - Non-empty: only providers in this set are considered (use for primary selection)
 * - Empty: all providers in the `providers` list are considered (use for secondary selection)
 *
 * Within the eligible pool, providers with an existing metadata-matching
 * dataset are preferred (reuses payment rail). Otherwise a provider
 * without a matching dataset is selected (new dataset created on commit).
 *
 * Within matching datasets, compact datasets sort before legacy ones, then
 * those with existing pieces sort before empty ones, and older datasets
 * (lower ID) sort before newer ones.
 *
 * With `providerId`, the pool is that one provider, whether or not it is
 * endorsed, and the result is its best matching dataset or a new-dataset
 * location. The result is empty when the provider is not in `providers` or is
 * listed in `excludeProviderIds`.
 *
 * This function does NOT perform health checks. Use
 * selectReachableProviders() to select providers that answer a ping.
 *
 * @param options - Pre-fetched chain data and selection parameters
 * @returns Ranked array of locations up to `count` length.
 *   May be shorter if fewer providers are available.
 *   Empty if no providers match constraints.
 */
export function selectProviders(options: ProviderSelectionOptions): ResolvedLocation[] {
  const count = options.count ?? 1
  const excludeProviderIds = options.excludeProviderIds ?? []
  const metadata = options.metadata ?? {}

  // Determine the eligible pool: an explicit provider, otherwise restricted
  // to endorsed if endorsedIds is non-empty
  const providerId = options.providerId
  const isPoolRestricted = options.endorsedIds.length > 0
  const eligibleProviders = options.providers.filter(
    (p) =>
      !excludeProviderIds.includes(p.id) &&
      (providerId == null ? !isPoolRestricted || options.endorsedIds.includes(p.id) : p.id === providerId)
  )

  if (eligibleProviders.length === 0) {
    return []
  }

  const providerMap = new Map(eligibleProviders.map((p) => [p.id, p]))

  // Find metadata-matching datasets from eligible providers
  const eligibleDataSets = options.clientDataSets.filter((ds) => providerMap.has(ds.providerId))
  const matchingDataSets = findMatchingDataSets(eligibleDataSets, metadata, options.legacyPieceStorageIdLimit)

  const results: ResolvedLocation[] = []
  const selectedProviderIds: bigint[] = []

  for (let i = 0; i < count; i++) {
    let found = false

    // Prefer a provider with an existing matching dataset (reuses payment rail)
    for (const ds of matchingDataSets) {
      if (selectedProviderIds.includes(ds.providerId)) continue
      const provider = providerMap.get(ds.providerId)
      if (provider == null) continue

      results.push({
        provider,
        dataSetId: ds.dataSetId,
        clientDataSetId: ds.clientDataSetId,
        endorsed: options.endorsedIds.includes(ds.providerId),
        dataSetMetadata: ds.metadata,
      })
      selectedProviderIds.push(ds.providerId)
      found = true
      break
    }

    // Otherwise pick any eligible provider (new dataset created on commit)
    if (!found) {
      for (const provider of eligibleProviders) {
        if (selectedProviderIds.includes(provider.id)) continue
        results.push({
          provider,
          dataSetId: null,
          clientDataSetId: null,
          endorsed: options.endorsedIds.includes(provider.id),
          dataSetMetadata: metadata,
        })
        selectedProviderIds.push(provider.id)
        found = true
        break
      }
    }

    if (!found) break
  }

  return results
}
