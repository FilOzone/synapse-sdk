/**
 * Synapse SDK Type Definitions
 *
 * This file contains type aliases, option objects, and data structures
 * used throughout the SDK. Concrete classes are defined in their own files.
 */

import type { ethers } from 'ethers'
import type { PieceCID } from './piece/index.js'

// Re-export PieceCID type
export type { PieceCID }
export type PrivateKey = string
export type Address = string
export type TokenAmount = number | bigint
export type DataSetId = string
export type ServiceProvider = string

/**
 * Supported Filecoin network types
 */
export type FilecoinNetworkType = 'mainnet' | 'calibration'

/**
 * Token identifier for balance queries
 */
export type TokenIdentifier = 'USDFC' | string

/**
 * Options for initializing the Synapse instance
 * Must provide one of:
 * 1. privateKey + rpcURL (for server environments)
 * 2. provider (for browser environments - user handles MetaMask coupling)
 * 3. signer (for direct ethers.js integration)
 */
export interface SynapseOptions {
  // Wallet Configuration (exactly one required)

  /** Private key for signing transactions (requires rpcURL) */
  privateKey?: PrivateKey
  /** Ethers Provider instance (handles both reads and transactions) */
  provider?: ethers.Provider
  /** Ethers Signer instance (for direct ethers.js integration) */
  signer?: ethers.Signer

  // Network Configuration

  /** RPC URL for Filecoin node (required with privateKey) */
  rpcURL?: string
  /** Authorization header value for API authentication (e.g., Bearer token) */
  authorization?: string

  // Advanced Configuration

  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
  /** Optional override for piece retrieval */
  pieceRetriever?: PieceRetriever
  /** Whether to disable NonceManager for automatic nonce management (default: false, meaning NonceManager is used) */
  disableNonceManager?: boolean
  /** Override Warm Storage service contract address (defaults to network's default) */
  warmStorageAddress?: string
  /** Override PDPVerifier contract address (defaults to network's default) */
  pdpVerifierAddress?: string

  // Subgraph Integration (provide ONE of these options)
  /** Optional override for default subgraph service, to enable subgraph-based retrieval. */
  subgraphService?: SubgraphRetrievalService
  /** Optional configuration for the default subgraph service, to enable subgraph-based retrieval. */
  subgraphConfig?: SubgraphConfig
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
    client: string,
    options?: {
      providerAddress?: string // Restrict to specific provider
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
   * @returns A promise that resolves to an array of `ApprovedProviderInfo` objects.
   */
  getApprovedProvidersForPieceCID: (pieceCid: PieceCID) => Promise<ApprovedProviderInfo[]>

  /**
   * Retrieves details for a specific provider by their address.
   *
   * @param address - The unique address (ID) of the provider.
   * @returns A promise that resolves to `ApprovedProviderInfo` if found, otherwise `null`.
   */
  getProviderByAddress: (address: string) => Promise<ApprovedProviderInfo | null>
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
  /** Warm Storage payment rail ID (different from PDPVerifier data set ID) */
  railId: number
  /** Address paying for storage */
  payer: string
  /** SP's beneficiary address */
  payee: string
  /** Commission rate in basis points */
  commissionBps: number
  /** General metadata for the data set */
  metadata: string
  /** Array of metadata strings for each piece */
  pieceMetadata: string[]
  /** Client's sequential dataset ID within this Warm Storage contract */
  clientDataSetId: number
  /** Whether the data set is using CDN */
  withCDN: boolean
}

/**
 * Enhanced data set information with chain details and clear ID separation
 */
export interface EnhancedDataSetInfo extends DataSetInfo {
  /** PDPVerifier global data set ID */
  pdpVerifierDataSetId: number
  /** Next piece ID to use when adding pieces */
  nextPieceId: number
  /** Current number of pieces in the data set */
  currentPieceCount: number
  /** Whether the data set is live on-chain */
  isLive: boolean
  /** Whether this data set is managed by the current Warm Storage contract */
  isManaged: boolean
}

/**
 * Information about an approved service provider
 */
export interface ApprovedProviderInfo {
  /** Service provider address */
  serviceProvider: string
  /** Service URL */
  serviceURL: string
  /** Peer ID */
  peerId: string
  /** Timestamp when registered */
  registeredAt: number
  /** Timestamp when approved */
  approvedAt: number
}

/**
 * Callbacks for storage service creation process
 */
export interface StorageCreationCallbacks {
  /**
   * Called when a service provider has been selected
   * @param provider - The selected provider info
   */
  onProviderSelected?: (provider: ApprovedProviderInfo) => void

  /**
   * Called when data set resolution is complete
   * @param info - Information about the resolved data set
   */
  onDataSetResolved?: (info: { isExisting: boolean; dataSetId: number; provider: ApprovedProviderInfo }) => void

  /**
   * Called when data set creation transaction is submitted
   * Only fired when creating a new data set
   * @param transaction - Transaction response object
   * @param statusUrl - URL to check status (optional)
   */
  onDataSetCreationStarted?: (transaction: ethers.TransactionResponse, statusUrl?: string) => void

  /**
   * Called periodically during data set creation
   * Only fired when creating a new data set
   * @param status - Current creation status
   */
  onDataSetCreationProgress?: (status: {
    transactionMined: boolean
    transactionSuccess: boolean
    dataSetLive: boolean
    serverConfirmed: boolean
    dataSetId?: number
    elapsedMs: number
    receipt?: ethers.TransactionReceipt
  }) => void
}

/**
 * Storage service implementation options
 */
export interface StorageServiceOptions {
  /** Specific provider ID to use (optional) */
  providerId?: number
  /** Specific provider address to use (optional) */
  providerAddress?: string
  /** Specific data set ID to use (optional) */
  dataSetId?: number
  /** Whether to enable CDN services */
  withCDN?: boolean
  /** Force creation of a new data set, even if a candidate exists */
  forceCreateDataSet?: boolean
  /** Callbacks for creation process */
  callbacks?: StorageCreationCallbacks
  /** Maximum number of uploads to process in a single batch (default: 32, minimum: 1) */
  uploadBatchSize?: number
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
  selectedProvider: ApprovedProviderInfo | null
  /** Selected data set ID (null when no specific dataset selected) */
  selectedDataSetId: number | null
}

/**
 * Upload progress callbacks
 */
export interface UploadCallbacks {
  /** Called when upload to service provider completes */
  onUploadComplete?: (pieceCid: PieceCID) => void
  /** Called when piece is added to data set (with optional transaction for new servers) */
  onPieceAdded?: (transaction?: ethers.TransactionResponse) => void
  /** Called when piece addition is confirmed on-chain (new servers only) */
  onPieceConfirmed?: (pieceIds: number[]) => void
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
  pieceId?: number
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
    tokenAddress: string
    /** Token symbol (always USDFC for now) */
    tokenSymbol: string
  }

  /** List of approved service providers */
  providers: ApprovedProviderInfo[]

  /** Service configuration parameters */
  serviceParameters: {
    /** Network type (mainnet or calibration) */
    network: FilecoinNetworkType
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
    /** Warm Storage service contract address */
    warmStorageAddress: string
    /** Payments contract address */
    paymentsAddress: string
    /** PDP Verifier contract address */
    pdpVerifierAddress: string
  }

  /** Current user allowances (null if wallet not connected) */
  allowances: {
    /** Service contract address */
    service: string
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
  id: number
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
  pieceId: number
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
  pieceId?: number
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
  provider: ApprovedProviderInfo
  /** Selected data set ID */
  dataSetId: number
  /** Whether this is a new data set that was created */
  isNewDataSet?: boolean
  /** Whether this is an existing data set */
  isExisting?: boolean
}

export type MetadataEntry = {
  key: string
  value: string
}
