import type { PDPProvider } from '../sp-registry/types.ts'
import type { MetadataObject } from '../utils/metadata.ts'

/**
 * Dataset with piece-presence information used for provider selection.
 *
 * Picks the fields that selectProviders() and findMatchingDataSets()
 * need, plus whether the data set contains at least one active piece.
 *
 * Core callers can spread a PdpDataSet directly.
 * SDK callers map from EnhancedDataSetInfo (different field names).
 */
export interface SelectionDataSet {
  /** PDP Verifier data set ID */
  dataSetId: bigint
  /** Provider that owns this data set */
  providerId: bigint
  /** Data set metadata (key-value pairs) */
  metadata: MetadataObject
  /** Whether the data set contains at least one active piece */
  hasActivePieces: boolean
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
 * The `endorsedIds` array controls pool restriction:
 * - Non-empty: only providers in this set are considered (primary selection)
 * - Empty: all providers in the `providers` list are considered (secondary selection)
 */
export interface ProviderSelectionInput {
  /** Available PDP providers (typically from getApprovedPDPProviders) */
  providers: PDPProvider[]
  /** Array of endorsed provider IDs (from endorsements.getProviderIds).
   *  Non-empty = restrict to endorsed only. Empty = use all providers. */
  endorsedIds: bigint[]
  /** Client's existing datasets with metadata and piece-presence information */
  clientDataSets: SelectionDataSet[]
}

/**
 * Options for selectProviders(). Combines pre-fetched chain data
 * with selection parameters in a single argument.
 */
export interface ProviderSelectionOptions extends ProviderSelectionInput {
  /** Number of providers to select (default: 1) */
  count?: number
  /** Provider IDs to exclude (for retry after ping failure or multi-copy exclusion) */
  excludeProviderIds?: bigint[]
  /** Desired metadata for dataset matching (empty object matches only empty-metadata datasets) */
  metadata?: MetadataObject
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
  /** Dataset metadata (matched from existing dataset, or the requested metadata for new datasets) */
  dataSetMetadata: MetadataObject
}
