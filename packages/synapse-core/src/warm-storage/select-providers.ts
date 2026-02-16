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
 * Within matching datasets, those with existing pieces sort before empty
 * ones, and older datasets (lower ID) sort before newer ones.
 *
 * This function does NOT perform health checks — the caller should
 * validate reachability via SP.ping() and call again with
 * excludeProviderIds if a provider fails.
 *
 * @param options - Pre-fetched chain data and selection parameters
 * @returns Ranked array of locations up to `count` length.
 *   May be shorter if fewer providers are available.
 *   Empty if no providers match constraints.
 */
export function selectProviders(options: ProviderSelectionOptions): ResolvedLocation[] {
  const count = options.count ?? 1
  const excludeProviderIds = options.excludeProviderIds ?? new Set<bigint>()
  const metadata = options.metadata ?? {}

  // Determine the eligible pool: restricted to endorsed if endorsedIds is non-empty
  const isPoolRestricted = options.endorsedIds.size > 0
  const eligibleProviders = options.providers.filter(
    (p) => !excludeProviderIds.has(p.id) && (!isPoolRestricted || options.endorsedIds.has(p.id))
  )

  if (eligibleProviders.length === 0) {
    return []
  }

  const providerMap = new Map(eligibleProviders.map((p) => [p.id, p]))

  // Find metadata-matching datasets from eligible providers
  const eligibleDataSets = options.clientDataSets.filter((ds) => providerMap.has(ds.providerId))
  const matchingDataSets = findMatchingDataSets(eligibleDataSets, metadata)

  const results: ResolvedLocation[] = []
  const selectedProviderIds = new Set<bigint>()

  for (let i = 0; i < count; i++) {
    let found = false

    // Prefer a provider with an existing matching dataset (reuses payment rail)
    for (const ds of matchingDataSets) {
      if (selectedProviderIds.has(ds.providerId)) continue
      const provider = providerMap.get(ds.providerId)
      if (provider == null) continue

      results.push({
        provider,
        dataSetId: ds.dataSetId,
        endorsed: options.endorsedIds.has(ds.providerId),
        dataSetMetadata: ds.metadata,
      })
      selectedProviderIds.add(ds.providerId)
      found = true
      break
    }

    // Otherwise pick any eligible provider (new dataset created on commit)
    if (!found) {
      for (const provider of eligibleProviders) {
        if (selectedProviderIds.has(provider.id)) continue
        results.push({
          provider,
          dataSetId: null,
          endorsed: options.endorsedIds.has(provider.id),
          dataSetMetadata: metadata,
        })
        selectedProviderIds.add(provider.id)
        found = true
        break
      }
    }

    if (!found) break
  }

  return results
}
