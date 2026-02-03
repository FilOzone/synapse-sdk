/**
 * Synapse SDK Type Definitions
 *
 * This file contains type aliases, option objects, and data structures
 * used throughout the SDK. Concrete classes are defined in their own files.
 */

import type { Chain } from '@filoz/synapse-core/chains'
import type { PieceCID } from '@filoz/synapse-core/piece'
import type { PullStatus } from '@filoz/synapse-core/sp'
import type { PDPProvider } from '@filoz/synapse-core/sp-registry'
import type { MetadataObject } from '@filoz/synapse-core/utils'
import type { Account, Address, Client, Hex, Transport } from 'viem'

// Re-export PieceCID and PDPProvider types
export type { PieceCID, PDPProvider }
export type PrivateKey = string
export type TokenAmount = bigint
export type DataSetId = bigint
export type ServiceProvider = Address

export type { RailInfo } from '@filoz/synapse-core/pay'
export type { PullStatus } from '@filoz/synapse-core/sp'
export type { MetadataEntry, MetadataObject } from '@filoz/synapse-core/utils'

/**
 * Supported Filecoin network types
 */
export type FilecoinNetworkType = 'mainnet' | 'calibration' | 'devnet'

/**
 * Token identifier for balance queries
 */
export type TokenIdentifier = 'USDFC' | string

/**
 * Options for initializing the Synapse instance
 */
export interface SynapseOptions {
  /**
   * Viem transport
   *
   * @see https://viem.sh/docs/clients/intro#transports
   */
  transport?: Transport

  /**
   * Filecoin chain
   *
   */
  chain?: Chain

  /**
   * Viem account
   *
   * @see https://viem.sh/docs/accounts/jsonRpc
   * @see https://viem.sh/docs/accounts/local
   */
  account: Account | Address

  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
}

export interface SynapseFromClientOptions {
  /**
   * Viem wallet client
   *
   * @see https://viem.sh/docs/clients/wallet#optional-hoist-the-account
   */
  client: Client<Transport, Chain, Account>
  // Advanced Configuration

  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
}

/**
 * Storage service options
 */
export interface StorageOptions {
  /** Existing data set ID to use (optional) */
  dataSetId?: DataSetId
  /** Preferred service provider (optional) */
  serviceProvider?: ServiceProvider
}

/**
 * Upload task tracking
 */
export interface UploadTask {
  /** Get the PieceCID (Piece CID) once calculated */
  pieceCid: () => Promise<PieceCID>
  /** Get the service provider once data is stored */
  store: () => Promise<ServiceProvider>
  /** Wait for the entire upload process to complete, returns transaction hash */
  done: () => Promise<string>
}

/**
 * Download options
 * Currently empty, reserved for future options
 */

// biome-ignore lint/complexity/noBannedTypes: future proofing
export type DownloadOptions = {}

/**
 * PieceRetriever interface for fetching pieces from various sources
 * Returns standard Web API Response objects for flexibility
 */
export interface PieceRetriever {
  /**
   * Fetch a piece from available sources
   * @param pieceCid - The PieceCID identifier of the piece (validated internally)
   * @param client - The client address requesting the piece
   * @param options - Optional retrieval parameters
   * @returns A Response object that can be processed for the piece data
   */
  fetchPiece: (
    pieceCid: PieceCID, // Internal interface uses PieceCID type for validation
    client: Address,
    options?: {
      providerAddress?: Address // Restrict to specific provider
      withCDN?: boolean // Enable CDN retrieval attempts
      signal?: AbortSignal // Optional AbortSignal for request cancellation
    }
  ) => Promise<Response>
}

/**
 * Configuration for the SubgraphService, determining how to connect to a
 * Synapse-compatible subgraph for provider discovery.
 */
export interface SubgraphConfig {
  /** Direct GraphQL endpoint URL. Takes precedence if provided. */
  endpoint?: string
  /** Configuration for Goldsky subgraphs. Used if 'endpoint' is not provided. */
  goldsky?: {
    projectId: string
    subgraphName: string
    version: string
  }
  /** Optional API key for authenticated subgraph access */
  apiKey?: string
}

/**
 * Defines the contract for a service that can retrieve provider information from a data source,
 * typically a Synapse-compatible subgraph.
 *
 * This interface allows for custom implementations to be provided in place of the default
 * SubgraphService. Any service that implements this interface can be used with the
 * Synapse SDK by passing it via the `subgraphService` option when creating a Synapse instance.
 *
 * This enables integration with alternative data sources or custom implementations
 * while maintaining compatibility with the SDK's retrieval system.
 */
export interface SubgraphRetrievalService {
  /**
   * Finds providers that have registered a specific data segment (PieceCID).
   *
   * @param pieceCid - The PieceCID of the data segment.
   * @returns A promise that resolves to an array of `ProviderInfo` objects.
   */
  getApprovedProvidersForPieceCID: (pieceCid: PieceCID) => Promise<PDPProvider[]>

  /**
   * Retrieves details for a specific provider by their address.
   *
   * @param address - The unique address (ID) of the provider.
   * @returns A promise that resolves to `PDPProvider` if found, otherwise `null`.
   */
  getProviderByAddress: (address: Address) => Promise<PDPProvider | null>
}

/**
 * Signature data for authenticated operations
 */
export interface AuthSignature {
  /** The full signature string (0x-prefixed) */
  signature: string
  /** Recovery parameter */
  v: number
  /** R component of signature */
  r: string
  /** S component of signature */
  s: string
  /** The ABI-encoded data that was signed (for verification) */
  signedData: string
}

/**
 * Data set information returned from Warm Storage contract
 */
export interface DataSetInfo {
  /** ID of the PDP payment rail */
  pdpRailId: bigint
  /** For CDN add-on: ID of the cache miss payment rail */
  cacheMissRailId: bigint
  /** For CDN add-on: ID of the CDN payment rail */
  cdnRailId: bigint
  /** Address paying for storage */
  payer: Address
  /** SP's beneficiary address */
  payee: Address
  /** Service provider address (operator) */
  serviceProvider: Address
  /** Commission rate in basis points (dynamic based on CDN usage) */
  commissionBps: bigint
  /** Client's sequential dataset ID within this Warm Storage contract */
  clientDataSetId: bigint
  /** Epoch when PDP payments end (0 if not terminated) */
  pdpEndEpoch: bigint
  /** Provider ID from the ServiceProviderRegistry */
  providerId: bigint
  // Legacy alias for backward compatibility
  paymentEndEpoch?: bigint
  /** PDP Data Set ID */
  dataSetId: bigint
}

/**
 * Enhanced data set information with chain details and clear ID separation
 */
export interface EnhancedDataSetInfo extends DataSetInfo {
  /** PDPVerifier global data set ID */
  pdpVerifierDataSetId: bigint
  /** Number of active pieces in the data set (excludes removed pieces) */
  activePieceCount: bigint
  /** Whether the data set is live on-chain */
  isLive: boolean
  /** Whether this data set is managed by the current Warm Storage contract */
  isManaged: boolean
  /** Whether the data set is using CDN (cdnRailId > 0 and withCDN metadata key present) */
  withCDN: boolean
  /** Metadata associated with this data set (key-value pairs) */
  metadata: Record<string, string>
}

/**
 * Settlement result from settling a payment rail
 */
export interface SettlementResult {
  /** Total amount that was settled */
  totalSettledAmount: bigint
  /** Net amount sent to payee after commission */
  totalNetPayeeAmount: bigint
  /** Commission amount for operator */
  totalOperatorCommission: bigint
  /** Payments contract network fee */
  totalNetworkFee: bigint
  /** Final epoch that was settled */
  finalSettledEpoch: bigint
  /** Note about the settlement */
  note: string
}

// ============================================================================
// Storage Context Creation Types
// ============================================================================
//
// BaseContextOptions contains shared fields: withCDN, metadata, callbacks.
//
// CreateContextOptions extends BaseContextOptions with singular fields
// (providerId, dataSetId) for single-context creation methods.
//
// CreateContextsOptions extends BaseContextOptions with plural fields
// (providerIds, dataSetIds, count, excludeProviderIds) for multi-context methods.
//
// StorageManagerUploadOptions (in manager.ts) extends CreateContextsOptions
// with upload-specific fields (contexts, pieceCid, signal).
//
// ============================================================================

/**
 * Callbacks for storage context creation process
 *
 * These callbacks provide visibility into the context creation process,
 * including provider and data set selection.
 */
export interface StorageContextCallbacks {
  /**
   * Called when a service provider has been selected
   * @param provider - The selected provider info
   */
  onProviderSelected?: (provider: PDPProvider) => void

  /**
   * Called when data set resolution is complete
   * @param info - Information about the resolved data set
   */
  onDataSetResolved?: (info: { isExisting: boolean; dataSetId: bigint; provider: PDPProvider }) => void
}

/**
 * Base options shared by all context creation methods
 *
 * Contains fields common to both single and multi-context creation:
 * CDN enablement, metadata matching, and creation callbacks.
 */
export interface BaseContextOptions {
  /** Whether to enable CDN services for the context */
  withCDN?: boolean

  /**
   * Custom metadata for data sets (key-value pairs).
   * Used to match existing data sets during provider selection or smart selection.
   */
  metadata?: Record<string, string>

  /** Callbacks for context creation process */
  callbacks?: StorageContextCallbacks
}

/**
 * Options for creating a single storage context
 *
 * Used by `StorageManager.createContext()` and `StorageContext.create()`.
 * Uses singular `providerId` and `dataSetId` to match the single-context semantics.
 *
 * @example
 * ```typescript
 * // Create context for specific provider
 * const ctx = await storage.createContext({ providerId: 1n })
 *
 * // Create context for specific data set
 * const ctx = await storage.createContext({ dataSetId: 5n })
 *
 * // Let smart selection choose (with CDN enabled)
 * const ctx = await storage.createContext({ withCDN: true })
 * ```
 */
export interface CreateContextOptions extends BaseContextOptions {
  /**
   * Specific provider ID to use.
   *
   * When provided:
   * - Context is created for this specific provider
   * - Provider must exist in the registry
   * - Existing data set matching `metadata` is reused when available
   * - Mutually exclusive with `dataSetId`
   *
   * @throws If provider is not found in registry
   * @throws If combined with `dataSetId`
   */
  providerId?: bigint

  /**
   * Specific data set ID to use.
   *
   * When provided:
   * - Context is created for this specific data set
   * - Data set must exist and belong to the current client
   * - Mutually exclusive with `providerId`
   *
   * @throws If data set does not exist or is not owned by client
   * @throws If combined with `providerId`
   */
  dataSetId?: bigint
}

/**
 * Options for creating multiple storage contexts
 *
 * Used by `StorageManager.createContexts()` and `StorageContext.createContexts()`.
 * Uses plural `providerIds` and `dataSetIds` to match the multi-context semantics.
 *
 * Three mutually exclusive modes:
 * 1. `dataSetIds` provided: creates contexts for exactly those data sets
 * 2. `providerIds` provided: creates contexts for exactly those providers
 * 3. Neither provided: uses smart selection with `count` (default 2)
 *
 * @example
 * ```typescript
 * // Create contexts for specific providers
 * const ctxs = await storage.createContexts({ providerIds: [1n, 2n] })
 *
 * // Create 3 contexts via smart selection
 * const ctxs = await storage.createContexts({ count: 3 })
 *
 * // Create contexts for specific data sets
 * const ctxs = await storage.createContexts({ dataSetIds: [5n, 10n] })
 * ```
 */
export interface CreateContextsOptions extends BaseContextOptions {
  /**
   * Number of contexts to create.
   *
   * - When NEITHER `dataSetIds` nor `providerIds` are specified: controls smart selection
   * - When explicit IDs are provided: if specified, must match the deduplicated array length
   *
   * @default 2 (only for smart selection)
   */
  count?: number

  /**
   * Specific data set IDs to use.
   *
   * When provided:
   * - Contexts are created for exactly these data sets (duplicates removed)
   * - If `count` is specified, it must match the deduplicated length
   * - Each data set must exist and belong to the current client
   * - Each data set must belong to a unique provider (no duplicates)
   * - Mutually exclusive with `providerIds`
   *
   * **Note:** Bypasses smart selection. Endorsed provider prioritization and
   * ordering logic are your responsibility when using explicit IDs.
   *
   * @throws If any data set does not exist or is not owned by client
   * @throws If data sets resolve to duplicate providers
   * @throws If combined with `providerIds`
   * @throws If `count` does not match deduplicated array length
   */
  dataSetIds?: bigint[]

  /**
   * Specific provider IDs to use.
   *
   * When provided:
   * - Contexts are created for exactly these providers (duplicates removed)
   * - If `count` is specified, it must match the deduplicated length
   * - Each provider must exist in the registry
   * - Existing data sets matching `metadata` are reused when available
   * - Mutually exclusive with `dataSetIds`
   *
   * **Note:** Bypasses smart selection. Endorsed provider prioritization and
   * ordering logic are your responsibility when using explicit IDs.
   *
   * @throws If any provider is not found in registry
   * @throws If combined with `dataSetIds`
   * @throws If `count` does not match deduplicated array length
   */
  providerIds?: bigint[]

  /**
   * Provider IDs to exclude from smart selection.
   *
   * Only applies when NEITHER `dataSetIds` nor `providerIds` are specified.
   * Used internally by retry logic to avoid re-selecting failed providers.
   *
   * @internal Not recommended for general use
   */
  excludeProviderIds?: bigint[]
}

/**
 * Preflight information for storage uploads
 */
export interface PreflightInfo {
  /** Estimated storage costs */
  estimatedCost: {
    perEpoch: bigint
    perDay: bigint
    perMonth: bigint
  }
  /** Allowance check results */
  allowanceCheck: {
    sufficient: boolean
    message?: string
  }
  /** Selected service provider (null when no specific provider selected) */
  selectedProvider: PDPProvider | null
  /** Selected data set ID (null when no specific dataset selected) */
  selectedDataSetId: number | null
}

// ============================================================================
// Upload Types
// ============================================================================
// The SDK provides different upload options for different use cases:
//
// 1. UploadCallbacks - Upload lifecycle callbacks (used by all upload methods)
// 2. UploadOptions - For StorageContext.upload() (adds piece metadata)
// 3. StorageManagerUploadOptions - For StorageManager.upload() (internal type
//    that combines context creation + upload in one call)
// ============================================================================

/**
 * Callbacks for upload operations
 *
 * These callbacks provide visibility into the upload lifecycle:
 * - store → pull to secondaries → commit flow
 *
 * Provider-scoped callbacks follow a consistent signature pattern:
 * (providerId, pieceCid, ...extra) for correlating events with both the
 * provider and the specific piece.
 */
export interface UploadCallbacks {
  /** Called periodically during upload with bytes uploaded so far */
  onProgress?: (bytesUploaded: number) => void

  /** Called after data is stored on a provider (uploaded but not yet committed on-chain) */
  onStored?: (providerId: bigint, pieceCid: PieceCID) => void

  /** Called with progress updates during pull to secondary providers */
  onPullProgress?: (providerId: bigint, pieceCid: PieceCID, status: PullStatus) => void

  /** Called when a copy to a secondary provider completes successfully */
  onCopyComplete?: (providerId: bigint, pieceCid: PieceCID) => void

  /** Called when a copy to a secondary provider fails */
  onCopyFailed?: (providerId: bigint, pieceCid: PieceCID, error: Error) => void

  /** Called when the addPieces transaction has been submitted for a provider (before on-chain confirmation) */
  onPieceAdded?: (providerId: bigint, pieceCid: PieceCID) => void

  /** Called after the addPieces transaction is confirmed on-chain for a provider */
  onPieceConfirmed?: (providerId: bigint, pieceCid: PieceCID, pieceId: bigint) => void
}

/**
 * Canonical representation of a piece within a data set.
 *
 * This is used when reporting confirmed pieces and when iterating over pieces
 * in a data set.
 */
export interface PieceRecord {
  pieceId: bigint
  pieceCid: PieceCID
}

/**
 * Options for uploading individual pieces to an existing storage context
 *
 * Used by StorageContext.upload() for uploading data to a specific provider
 * and data set that has already been created/selected.
 */
export interface UploadOptions extends UploadCallbacks {
  /** Custom metadata for this specific piece (key-value pairs) */
  pieceMetadata?: MetadataObject
  /** Optional pre-calculated PieceCID to skip CommP calculation (BYO PieceCID) */
  pieceCid?: PieceCID
  /** Optional AbortSignal to cancel the upload */
  signal?: AbortSignal
}

/**
 * Input types for upload operations
 */
export type UploadData = Uint8Array | ReadableStream<Uint8Array>

/**
 * Result of a successful copy to a single provider
 */
export interface CopyResult {
  /** Provider ID */
  providerId: bigint
  /** Data set ID on this provider */
  dataSetId: bigint
  /** Piece ID within the data set */
  pieceId: bigint
  /** Role in the upload flow */
  role: 'primary' | 'secondary'
  /** Direct retrieval URL */
  retrievalUrl: string
  /** Whether a new data set was created for this copy */
  isNewDataSet: boolean
}

/**
 * Information about a failed copy attempt
 */
export interface FailedCopy {
  /** Provider ID that failed */
  providerId: bigint
  /** Role of the provider that failed */
  role: 'primary' | 'secondary'
  /** Error message */
  error: string
  /** Was this an explicitly requested provider? */
  explicit: boolean
}

/**
 * Upload result information with multi-copy support.
 *
 * **Important:** Receiving an UploadResult does not guarantee all copies succeeded.
 * Always check `copies.length` against your requested count and inspect `failures`
 * if fewer copies than expected were created.
 *
 * @example
 * ```typescript
 * const result = await synapse.storage.upload(data, { count: 3 })
 *
 * if (result.copies.length < 3) {
 *   console.warn(`Only ${result.copies.length}/3 copies succeeded`)
 *   for (const failure of result.failures) {
 *     console.error(`Provider ${failure.providerId} failed: ${failure.error}`)
 *   }
 * }
 * ```
 */
export interface UploadResult {
  /** The piece CID (same across all copies) */
  pieceCid: PieceCID
  /** Raw data size in bytes */
  size: number
  /**
   * Successful copies. Primary is first (index 0) when it succeeds.
   * Length may be less than requested count if some providers failed.
   */
  copies: CopyResult[]
  /**
   * Failed provider attempts. Empty if all copies succeeded.
   *
   * Note: `failures.length + copies.length` may exceed the requested count
   * because failed providers are retried with alternates. For example,
   * requesting 2 copies might yield 2 successful copies and 3 failures
   * if multiple retry attempts were needed.
   */
  failures: FailedCopy[]
}

/**
 * Options for the store() split operation
 */
export interface StoreOptions {
  /** Pre-calculated PieceCID (skip calculation) */
  pieceCid?: PieceCID
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Called periodically during upload with bytes uploaded so far */
  onProgress?: (bytesUploaded: number) => void
}

/**
 * Result of a store() operation
 */
export interface StoreResult {
  /** PieceCID of the stored data */
  pieceCid: PieceCID
  /** Size in bytes */
  size: number
}

/**
 * Source for pull operations - either a StorageContext or base URL
 */
export type PullSource = { getPieceUrl(pieceCid: PieceCID): string } | string

/**
 * Options for the pull() split operation
 */
export interface PullOptions {
  /** Pieces to pull */
  pieces: PieceCID[]
  /** Source to pull from (StorageContext or base URL) */
  from: PullSource
  /** AbortSignal for cancellation */
  signal?: AbortSignal
  /** Progress callback */
  onProgress?: (pieceCid: PieceCID, status: PullStatus) => void
  /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
  extraData?: Hex
}

/**
 * Result of a pull() operation
 */
export interface PullResult {
  /** Overall status - 'complete' only if ALL pieces succeeded */
  status: 'complete' | 'failed'
  /** Per-piece results */
  pieces: Array<{
    pieceCid: PieceCID
    status: 'complete' | 'failed'
    error?: string
  }>
}

/**
 * Options for the commit() split operation
 */
export interface CommitOptions {
  /** Pieces to commit on-chain */
  pieces: Array<{
    pieceCid: PieceCID
    /** Per-piece metadata (distinct from dataset metadata) */
    pieceMetadata?: Record<string, string>
  }>
  /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
  extraData?: Hex
  /** Called after the addPieces transaction is submitted but before on-chain confirmation */
  onSubmitted?: () => void
}

/**
 * Result of a commit() operation
 */
export interface CommitResult {
  /** Transaction hash */
  txHash: Hex
  /** Piece IDs assigned */
  pieceIds: bigint[]
  /** Data set ID */
  dataSetId: bigint
  /** Whether a new data set was created */
  isNewDataSet: boolean
}

/**
 * Comprehensive storage service information
 */
export interface StorageInfo {
  /** Pricing information for storage services */
  pricing: {
    /** Pricing without CDN */
    noCDN: {
      /** Cost per TiB per month in token units */
      perTiBPerMonth: bigint
      /** Cost per TiB per day in token units */
      perTiBPerDay: bigint
      /** Cost per TiB per epoch in token units */
      perTiBPerEpoch: bigint
    }
    /** Pricing with CDN enabled */
    withCDN: {
      /** Cost per TiB per month in token units */
      perTiBPerMonth: bigint
      /** Cost per TiB per day in token units */
      perTiBPerDay: bigint
      /** Cost per TiB per epoch in token units */
      perTiBPerEpoch: bigint
    }
    /** Token contract address */
    tokenAddress: Address
    /** Token symbol (always USDFC for now) */
    tokenSymbol: string
  }

  /** List of approved service providers */
  providers: PDPProvider[]

  /** Service configuration parameters */
  serviceParameters: {
    /** Number of epochs in a month */
    epochsPerMonth: bigint
    /** Number of epochs in a day */
    epochsPerDay: bigint
    /** Duration of each epoch in seconds */
    epochDuration: number
    /** Minimum allowed upload size in bytes */
    minUploadSize: number
    /** Maximum allowed upload size in bytes */
    maxUploadSize: number
  }

  /** Current user allowances (null if wallet not connected) */
  allowances: {
    /** Whether the service operator is approved to act on behalf of the wallet */
    isApproved: boolean
    /** Service contract address */
    service: Address
    /** Maximum payment rate per epoch allowed */
    rateAllowance: bigint
    /** Maximum lockup amount allowed */
    lockupAllowance: bigint
    /** Current rate allowance used */
    rateUsed: bigint
    /** Current lockup allowance used */
    lockupUsed: bigint
  } | null
}

/**
 * Data set data returned from the API
 */
export interface DataSetData {
  /** The data set ID */
  id: bigint
  /** Array of piece data in the data set */
  pieces: DataSetPieceData[]
  /** Next challenge epoch */
  nextChallengeEpoch: number
}

/**
 * Individual data set piece data from API
 */
export interface DataSetPieceData {
  /** Piece ID within the data set */
  pieceId: bigint
  /** The piece CID */
  pieceCid: PieceCID
  /** Sub-piece CID (usually same as pieceCid) */
  subPieceCid: PieceCID
  /** Sub-piece offset */
  subPieceOffset: number
}

/**
 * Status information for a piece stored on a provider
 * Note: Proofs are submitted for entire data sets, not individual pieces.
 * The timing information reflects the data set's status.
 */
export interface PieceStatus {
  /** Whether the piece exists on the service provider */
  exists: boolean
  /** When the data set containing this piece was last proven on-chain (null if never proven or not yet due) */
  dataSetLastProven: Date | null
  /** When the next proof is due for the data set containing this piece (end of challenge window) */
  dataSetNextProofDue: Date | null
  /** URL where the piece can be retrieved (null if not available) */
  retrievalUrl: string | null
  /** The piece ID if the piece is in the data set */
  pieceId?: bigint
  /** Whether the data set is currently in a challenge window */
  inChallengeWindow?: boolean
  /** Time until the data set enters the challenge window (in hours) */
  hoursUntilChallengeWindow?: number
  /** Whether the proof is overdue (past the challenge window without being submitted) */
  isProofOverdue?: boolean
}

/**
 * Result of provider selection and data set resolution
 */
export interface ProviderSelectionResult {
  /** Selected service provider */
  provider: PDPProvider
  /** Selected data set ID */
  dataSetId: bigint
  /** Whether this is an existing data set */
  isExisting?: boolean
  /** Data set metadata */
  dataSetMetadata: Record<string, string>
}
