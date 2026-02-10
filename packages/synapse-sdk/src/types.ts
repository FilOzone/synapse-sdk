/**
 * Synapse SDK Type Definitions
 *
 * This file contains type aliases, option objects, and data structures
 * used throughout the SDK. Concrete classes are defined in their own files.
 */

import type { Chain } from '@filoz/synapse-core/chains'
import type { PieceCID } from '@filoz/synapse-core/piece'
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
  /** Whether to filter providers by IPNI availability */
  withIpni?: boolean
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
  /** Whether to filter providers by IPNI availability */
  withIpni?: boolean
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
// These types are used when creating or selecting storage contexts
// (provider + data set pairs)
// ============================================================================

/**
 * Callbacks for storage service creation process
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

export interface CreateContextsOptions {
  /** Number of contexts to create (optional, defaults to 2) */
  count?: number
  /**
   * Specific data set IDs to use
   */
  dataSetIds?: bigint[]
  /**
   * Specific provider IDs to use
   */
  providerIds?: bigint[]
  /** Do not select any of these providers */
  excludeProviderIds?: bigint[]
  /** Whether to enable CDN services */
  withCDN?: boolean
  withIpni?: boolean
  dev?: boolean
  /**
   * Custom metadata for the data sets (key-value pairs)
   * When smart-selecting data sets, this metadata will be used to match.
   */
  metadata?: Record<string, string>
  /** Create new data sets, even if candidates exist */
  forceCreateDataSets?: boolean
  /** Callbacks for creation process (will need to change to handle multiples) */
  callbacks?: StorageContextCallbacks
  /** Maximum number of uploads to process in a single batch (default: 32, minimum: 1) */
  uploadBatchSize?: number
}

/**
 * Options for creating or selecting a storage context
 *
 * Used by StorageManager.createContext() and indirectly by StorageManager.upload()
 * when auto-creating contexts. Allows specification of:
 * - Provider selection (by ID or address)
 * - Data set selection or creation
 * - CDN enablement and metadata
 * - Creation process callbacks
 */
export interface StorageServiceOptions {
  /** Specific provider ID to use (optional) */
  providerId?: bigint
  /** Do not select any of these providers */
  excludeProviderIds?: bigint[]
  /** Specific provider address to use (optional) */
  providerAddress?: Address
  /** Specific data set ID to use (optional) */
  dataSetId?: bigint
  /** Whether to enable CDN services */
  withCDN?: boolean
  withIpni?: boolean
  /** Force creation of a new data set, even if a candidate exists */
  forceCreateDataSet?: boolean
  /** Maximum number of uploads to process in a single batch (default: 32, minimum: 1) */
  uploadBatchSize?: number
  /** Callbacks for creation process */
  callbacks?: StorageContextCallbacks
  /** Custom metadata for the data set (key-value pairs) */
  metadata?: Record<string, string>
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
  /** Called when upload to service provider completes */
  onUploadComplete?: (pieceCid: PieceCID) => void
  /** Called when the service provider has added the piece(s) and submitted the transaction to the chain */
  onPiecesAdded?: (transaction: Hex, pieces?: { pieceCid: PieceCID }[]) => void
  /** @deprecated Use onPiecesAdded instead */
  onPieceAdded?: (transaction?: Hex) => void
  /** Called when the service provider agrees that the piece addition(s) are confirmed on-chain */
  onPiecesConfirmed?: (dataSetId: bigint, pieces: PieceRecord[]) => void
  /** @deprecated Use onPiecesConfirmed instead */
  onPieceConfirmed?: (pieceIds: bigint[]) => void
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
  metadata?: MetadataObject
  /** Optional pre-calculated PieceCID to skip CommP calculation (BYO PieceCID) */
  pieceCid?: PieceCID
  /** Optional AbortSignal to cancel the upload */
  signal?: AbortSignal
}

/**
 * Upload result information
 */
export interface UploadResult {
  /** PieceCID of the uploaded data */
  pieceCid: PieceCID
  /** Size of the original data */
  size: number
  /** Piece ID in the data set */
  pieceId?: bigint
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
