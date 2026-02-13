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
import type { Synapse } from './synapse.ts'
import type { WarmStorageService } from './warm-storage/service.ts'

// Re-export PieceCID, PDPProvider, and PullStatus types
export type { PieceCID, PDPProvider, PullStatus }
export type PrivateKey = string
export type TokenAmount = bigint
export type DataSetId = bigint
export type ServiceProvider = Address

export type { RailInfo } from '@filoz/synapse-core/pay'
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

export type DownloadOptions = {
  withCDN?: boolean
  pieceCid: string | PieceCID
}

export interface PieceFetchOptions {
  pieceCid: PieceCID // Internal interface uses PieceCID type for validation
  client: Address
  providerAddress?: Address // Restrict to specific provider
  withCDN?: boolean // Enable CDN retrieval attempts
  signal?: AbortSignal // Optional AbortSignal for request cancellation
}

/**
 * PieceRetriever interface for fetching pieces from various sources
 * Returns standard Web API Response objects for flexibility
 */
export interface PieceRetriever {
  /**
   * Fetch a piece from available sources
   * @param options - Retrieval parameters
   * @param options.pieceCid - The PieceCID identifier of the piece (validated internally)
   * @param options.client - The client address requesting the piece
   * @param options.providerAddress - Restrict retrieval to a specific provider
   * @param options.withCDN - Enable CDN retrieval attempts
   * @param options.signal - Optional AbortSignal for request cancellation
   * @returns A Response object that can be processed for the piece data
   */
  fetchPiece: (options: PieceFetchOptions) => Promise<Response>
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
// StorageServiceOptions extends BaseContextOptions with singular fields
// (providerId, dataSetId) for single-context creation via createContext().
//
// CreateContextsOptions extends BaseContextOptions with plural fields
// (providerIds, dataSetIds, count, excludeProviderIds) for createContexts().
//
// StorageManagerUploadOptions (in manager.ts) extends CreateContextsOptions
// with upload-specific fields (contexts, pieceCid, pieceMetadata, signal).
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
  /** Whether to enable CDN services */
  withCDN?: boolean

  /**
   * Custom metadata for data sets (key-value pairs).
   * Used to match existing data sets during provider selection.
   */
  metadata?: Record<string, string>

  /** Callbacks for creation process */
  callbacks?: StorageContextCallbacks
}

/**
 * Options for creating multiple storage contexts via createContexts()
 *
 * Extends BaseContextOptions with plural provider/dataset selection
 * and count for multi-provider redundancy.
 */
export interface CreateContextsOptions extends BaseContextOptions {
  /** Number of contexts to create (optional, defaults to 2) */
  count?: number
  /**
   * Specific data set IDs to use (mutually exclusive with providerIds)
   */
  dataSetIds?: bigint[]
  /**
   * Specific provider IDs to use (mutually exclusive with dataSetIds)
   */
  providerIds?: bigint[]
  /** Do not select any of these providers */
  excludeProviderIds?: bigint[]
}

export interface ContextCreateContextsOptions extends CreateContextsOptions {
  /** The Synapse instance */
  synapse: Synapse
  /** The WarmStorageService instance */
  warmStorageService: WarmStorageService
}

/**
 * Options for creating or selecting a single storage context via createContext()
 *
 * Extends BaseContextOptions with singular provider/dataset selection.
 */
export interface StorageServiceOptions extends BaseContextOptions {
  /** Specific provider ID to use (optional) */
  providerId?: bigint
  /** Do not select any of these providers */
  excludeProviderIds?: bigint[]
  /** Specific data set ID to use (optional) */
  dataSetId?: bigint
}

export interface StorageContextCreateOptions extends StorageServiceOptions {
  /** The Synapse instance */
  synapse: Synapse
  /** The WarmStorageService instance */
  warmStorageService: WarmStorageService
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
// 1. UploadCallbacks - Progress callbacks only (used by all upload methods)
// 2. UploadOptions - For StorageContext.upload() (adds piece metadata)
// 3. StorageManagerUploadOptions - For StorageManager.upload() (internal type
//    that combines context creation + upload in one call)
// ============================================================================

export interface UploadCallbacks {
  /** Called periodically during upload with bytes uploaded so far */
  onProgress?: (bytesUploaded: number) => void
  /** Called when piece data has been stored on a provider (before on-chain commit) */
  onStored?: (providerId: bigint, pieceCid: PieceCID) => void
  /** Called when the addPieces transaction has been submitted for a provider */
  onPiecesAdded?: (transaction: Hex, providerId: bigint, pieces: { pieceCid: PieceCID }[]) => void
  /** Called when the addPieces transaction is confirmed on-chain for a provider */
  onPiecesConfirmed?: (dataSetId: bigint, providerId: bigint, pieces: PieceRecord[]) => void
  /** Called when a secondary copy completes successfully */
  onCopyComplete?: (providerId: bigint, pieceCid: PieceCID) => void
  /** Called when a secondary copy fails */
  onCopyFailed?: (providerId: bigint, pieceCid: PieceCID, error: Error) => void
  /** Called with pull status updates during SP-to-SP transfer */
  onPullProgress?: (providerId: bigint, pieceCid: PieceCID, status: PullStatus) => void
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
export interface UploadOptions extends StoreOptions, UploadCallbacks {
  /** Custom metadata for this specific piece (key-value pairs) */
  pieceMetadata?: MetadataObject
}

/**
 * Result for a single successful copy of data on a provider
 */
export interface CopyResult {
  /** Provider ID that holds this copy */
  providerId: bigint
  /** Data set ID on this provider */
  dataSetId: bigint
  /** Piece ID within the data set */
  pieceId: bigint
  /** Whether this is the primary (store) or secondary (pull) copy */
  role: 'primary' | 'secondary'
  /** URL where this copy can be retrieved */
  retrievalUrl: string
  /** Whether a new data set was created for this copy */
  isNewDataSet: boolean
}

/**
 * Record of a failed copy attempt
 */
export interface FailedCopy {
  /** Provider ID that failed */
  providerId: bigint
  /** Role of the failed copy */
  role: 'primary' | 'secondary'
  /** Error description */
  error: string
  /** Whether the provider was explicitly specified (no auto-retry for explicit) */
  explicit: boolean
}

/**
 * Upload result information
 */
export interface UploadResult {
  /** PieceCID of the uploaded data */
  pieceCid: PieceCID
  /** Size of the original data */
  size: number
  /** Successful copies across providers */
  copies: CopyResult[]
  /** Failed copy attempts (individual failures don't throw; check copies.length) */
  failures: FailedCopy[]
}

// ============================================================================
// Split Operation Types
// ============================================================================
// The upload flow can be decomposed into: store → pull → commit
// These types support that split flow for advanced use cases.
// ============================================================================

/**
 * Options for storing data on a provider without on-chain commit
 */
export interface StoreOptions {
  /** Optional pre-calculated PieceCID to skip CommP calculation */
  pieceCid?: PieceCID
  /** Optional AbortSignal to cancel the store */
  signal?: AbortSignal
  /** Progress callback for upload bytes */
  onProgress?: (bytesUploaded: number) => void
}

/**
 * Result of a store operation
 */
export interface StoreResult {
  /** PieceCID of the stored data */
  pieceCid: PieceCID
  /** Size of the original data in bytes */
  size: number
}

/**
 * Source for pulling pieces from another provider
 */
export type PullSource = string | { getPieceUrl: (pieceCid: PieceCID) => string }

/**
 * Options for pulling pieces from a source provider
 */
export interface PullOptions {
  /** Pieces to pull */
  pieces: PieceCID[]
  /** Source provider to pull from (URL or context with getPieceUrl) */
  from: PullSource
  /** Optional AbortSignal */
  signal?: AbortSignal
  /** Pull progress callback */
  onProgress?: (pieceCid: PieceCID, status: PullStatus) => void
  /** Pre-built signed extraData (avoids double wallet prompts) */
  extraData?: Hex
}

/**
 * Result of a pull operation
 */
export interface PullResult {
  /** Overall status */
  status: 'complete' | 'failed'
  /** Per-piece status */
  pieces: Array<{ pieceCid: PieceCID; status: 'complete' | 'failed' }>
}

/**
 * Options for committing pieces on-chain
 */
export interface CommitOptions {
  /** Pieces to commit with optional per-piece metadata */
  pieces: Array<{ pieceCid: PieceCID; pieceMetadata?: MetadataObject }>
  /** Pre-built signed extraData (avoids re-signing) */
  extraData?: Hex
  /** Called when the commit transaction is submitted (before on-chain confirmation) */
  onSubmitted?: (txHash: Hex) => void
}

/**
 * Result of a commit operation
 */
export interface CommitResult {
  /** Transaction hash */
  txHash: Hex
  /** Piece IDs assigned by the contract */
  pieceIds: bigint[]
  /** Data set ID (may be newly created) */
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
