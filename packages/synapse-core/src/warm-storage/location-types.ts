import type { PDPProvider } from '../sp-registry/types.ts'
import type { MetadataObject } from '../utils/metadata.ts'

/**
 * Dataset with piece count, for provider selection.
 *
 * Picks the fields that selectProviders() and findMatchingDataSets()
 * need, plus activePieceCount which is fetched separately via multicall.
 *
 * Core callers can spread a PdpDataSet directly: `{ ...ds, activePieceCount }`.
 * SDK callers map from EnhancedDataSetInfo (different field names).
 */
export interface SelectionDataSet {
  /** PDP Verifier data set ID */
  dataSetId: bigint
  /** Provider that owns this data set */
  providerId: bigint
  /** Data set metadata (key-value pairs) */
  metadata: MetadataObject
  /** Number of active pieces in the dataset (0 = empty) */
  activePieceCount: bigint
  /** End epoch for PDP service (0 = active) */
  pdpEndEpoch: bigint
  /** Whether the data set is live in the PDP Verifier */
  live: boolean
  /** Whether the data set is managed by the current Warm Storage contract */
  managed: boolean
}

/**
 * Pre-fetched data for provider selection.
 *
 * The caller gathers this from chain queries (or cached results)
 * and passes it to selectProviders(). Separating data fetching
 * from selection keeps selectProviders() pure and testable.
 *
 * The `endorsedIds` set controls pool restriction:
 * - Non-empty: only providers in this set are considered (primary selection)
 * - Empty: all providers in the `providers` list are considered (secondary selection)
 */
export interface ProviderSelectionInput {
  /** Available PDP providers (typically from getApprovedPDPProviders) */
  providers: PDPProvider[]
  /** Set of endorsed provider IDs (from endorsements.getProviderIds).
   *  Non-empty = restrict to endorsed only. Empty = use all providers. */
  endorsedIds: Set<bigint>
  /** Client's existing datasets with metadata and piece counts */
  clientDataSets: SelectionDataSet[]
  /** Desired metadata for dataset matching */
  metadata: MetadataObject
}

/**
 * Options for selectProviders().
 */
export interface ProviderSelectionOptions {
  /** Number of providers to select (default: 1) */
  count?: number
  /** Provider IDs to exclude (for retry after ping failure or multi-copy exclusion) */
  excludeProviderIds?: Set<bigint>
}

/**
 * A resolved provider+dataset pair ready for upload.
 *
 * The currency between selection and upload. selectProviders() returns
 * an array of these; the caller passes them to upload/pull/commit functions.
 */
export interface ResolvedLocation {
  /** The selected provider */
  provider: PDPProvider
  /** Matched dataset ID, or null if a new dataset should be created */
  dataSetId: bigint | null
  /** Whether this provider is endorsed */
  endorsed: boolean
}
