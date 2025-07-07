/**
 * Synapse SDK Type Definitions
 *
 * This file contains type aliases, option objects, and data structures
 * used throughout the SDK. Concrete classes are defined in their own files.
 */

import type { ethers } from 'ethers'
import type { CommP } from './commp/index.js'

// Re-export CommP type
export type { CommP }
export type PrivateKey = string
export type Address = string
export type TokenAmount = number | bigint
export type ProofSetId = string
export type StorageProvider = string

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
  /** Private key for signing transactions (requires rpcURL) */
  privateKey?: PrivateKey
  /** RPC URL for Filecoin node (required with privateKey) */
  rpcURL?: string
  /** Authorization header value for API authentication (e.g., Bearer token) */
  authorization?: string
  /** Ethers Provider instance (handles both reads and transactions) */
  provider?: ethers.Provider
  /** Ethers Signer instance (for direct ethers.js integration) */
  signer?: ethers.Signer
  /** Whether to disable NonceManager for automatic nonce management (default: false, meaning NonceManager is used) */
  disableNonceManager?: boolean
  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
  /** Override Pandora service contract address (defaults to network's default) */
  pandoraAddress?: string
  /** Optional override for piece retrieval */
  pieceRetriever?: PieceRetriever
  /** Optional override for default subgraph service, to enable subgraph-based retrieval. */
  subgraphService?: SubgraphRetrievalService
  /** Optional configuration for the default subgraph service, to enable subgraph-based retrieval. */
  subgraphConfig?: SubgraphConfig
}

/**
 * Storage service options
 */
export interface StorageOptions {
  /** Existing proof set ID to use (optional) */
  proofSetId?: ProofSetId
  /** Preferred storage provider (optional) */
  storageProvider?: StorageProvider
}

/**
 * Upload task tracking
 */
export interface UploadTask {
  /** Get the CommP (Piece CID) once calculated */
  commp: () => Promise<CommP>
  /** Get the storage provider once data is stored */
  store: () => Promise<StorageProvider>
  /** Wait for the entire upload process to complete, returns transaction hash */
  done: () => Promise<string>
}

/**
 * Download options
 * Currently empty, reserved for future options
 */
// eslint-disable-next-line @typescript-eslint/no-empty-interface
export interface DownloadOptions {
  // Reserved for future options
}

/**
 * PieceRetriever interface for fetching pieces from various sources
 * Returns standard Web API Response objects for flexibility
 */
export interface PieceRetriever {
  /**
   * Fetch a piece from available sources
   * @param commp - The CommP identifier of the piece (validated internally)
   * @param client - The client address requesting the piece
   * @param options - Optional retrieval parameters
   * @returns A Response object that can be processed for the piece data
   */
  fetchPiece: (
    commp: CommP, // Internal interface uses CommP type for validation
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
   * Finds providers that have registered a specific data segment (CommP).
   *
   * @param commP - The CommP of the data segment.
   * @returns A promise that resolves to an array of `ApprovedProviderInfo` objects.
   */
  getApprovedProvidersForCommP: (commP: CommP) => Promise<ApprovedProviderInfo[]>

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
 * Root data for adding to proof sets
 */
export interface RootData {
  /** The CommP CID */
  cid: CommP | string
  /** The raw (unpadded) size of the original data in bytes */
  rawSize: number
}

/**
 * Proof set information returned from Pandora contract
 */
export interface ProofSetInfo {
  /** Pandora payment rail ID (different from PDPVerifier proof set ID) */
  railId: number
  /** Address paying for storage */
  payer: string
  /** SP's beneficiary address */
  payee: string
  /** Commission rate in basis points */
  commissionBps: number
  /** General metadata for the proof set */
  metadata: string
  /** Array of metadata for each root */
  rootMetadata: string[]
  /** Client's sequential dataset ID within this Pandora contract */
  clientDataSetId: number
  /** Whether the proof set is using CDN */
  withCDN: boolean
}

/**
 * Enhanced proof set information with chain details and clear ID separation
 */
export interface EnhancedProofSetInfo extends ProofSetInfo {
  /** PDPVerifier global proof set ID */
  pdpVerifierProofSetId: number
  /** Next root ID to use when adding roots */
  nextRootId: number
  /** Current number of roots in the proof set */
  currentRootCount: number
  /** Whether the proof set is live on-chain */
  isLive: boolean
  /** Whether this proof set is managed by the current Pandora contract */
  isManaged: boolean
}

/**
 * Information about an approved storage provider
 */
export interface ApprovedProviderInfo {
  /** Provider's wallet address */
  owner: string
  /** PDP server URL */
  pdpUrl: string
  /** Piece retrieval URL */
  pieceRetrievalUrl: string
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
   * Called when a storage provider has been selected
   * @param provider - The selected provider info
   */
  onProviderSelected?: (provider: ApprovedProviderInfo) => void

  /**
   * Called when proof set resolution is complete
   * @param info - Information about the resolved proof set
   */
  onProofSetResolved?: (info: {
    isExisting: boolean
    proofSetId: number
    provider: ApprovedProviderInfo
  }) => void

  /**
   * Called when proof set creation transaction is submitted
   * Only fired when creating a new proof set
   * @param transaction - Transaction response object
   * @param statusUrl - URL to check status (optional)
   */
  onProofSetCreationStarted?: (transaction: ethers.TransactionResponse, statusUrl?: string) => void

  /**
   * Called periodically during proof set creation
   * Only fired when creating a new proof set
   * @param status - Current creation status
   */
  onProofSetCreationProgress?: (status: {
    transactionMined: boolean
    transactionSuccess: boolean
    proofSetLive: boolean
    serverConfirmed: boolean
    proofSetId?: number
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
  /** Specific proof set ID to use (optional) */
  proofSetId?: number
  /** Whether to enable CDN services */
  withCDN?: boolean
  /** Callbacks for creation process */
  callbacks?: StorageCreationCallbacks
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
  /** Selected storage provider */
  selectedProvider: ApprovedProviderInfo
  /** Selected proof set ID */
  selectedProofSetId: number
}

/**
 * Upload progress callbacks
 */
export interface UploadCallbacks {
  /** Called when upload to storage provider completes */
  onUploadComplete?: (commp: CommP) => void
  /** Called when root is added to proof set (with optional transaction for new servers) */
  onRootAdded?: (transaction?: ethers.TransactionResponse) => void
  /** Called when root addition is confirmed on-chain (new servers only) */
  onRootConfirmed?: (rootIds: number[]) => void
}

/**
 * Upload result information
 */
export interface UploadResult {
  /** CommP of the uploaded data */
  commp: CommP
  /** Size of the original data */
  size: number
  /** Root ID in the proof set */
  rootId?: number
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

  /** List of approved storage providers */
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
    /** Pandora service contract address */
    pandoraAddress: string
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
 * Proof set data returned from the API
 */
export interface ProofSetData {
  /** The proof set ID */
  id: number
  /** Array of root data in the proof set */
  roots: ProofSetRootData[]
  /** Next challenge epoch */
  nextChallengeEpoch: number
}

/**
 * Individual proof set root data from API
 */
export interface ProofSetRootData {
  /** Root ID within the proof set */
  rootId: number
  /** The root CID */
  rootCid: CommP
  /** Sub-root CID (usually same as rootCid) */
  subrootCid: CommP
  /** Sub-root offset */
  subrootOffset: number
}
