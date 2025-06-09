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
   * @param txHash - Transaction hash for tracking
   * @param statusUrl - URL to check status (optional)
   */
  onProofSetCreationStarted?: (txHash: string, statusUrl?: string) => void

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
  }) => void
}

/**
 * Storage service implementation options
 */
export interface StorageServiceOptions {
  /** Specific provider ID to use (optional) */
  providerId?: number
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
  onUploadComplete?: (commp: string) => void
  /** Called when root is added to proof set */
  onRootAdded?: () => void
}

/**
 * Upload result information
 */
export interface UploadResult {
  /** CommP of the uploaded data */
  commp: string
  /** Size of the original data */
  size: number
  /** Root ID in the proof set */
  rootId?: number
}
