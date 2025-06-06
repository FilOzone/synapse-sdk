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
 */
export interface DownloadOptions {
  /** Skip verification of downloaded data against CommP (default: false) */
  noVerify?: boolean
  /** Force use of CDN or direct SP retrieval (overrides instance setting) */
  withCDN?: boolean
}

/**
 * Payment settlement result
 */
export interface SettlementResult {
  /** Amount settled in USDFC base units */
  settledAmount: bigint
  /** Epoch at which settlement occurred */
  epoch: number
}

/**
 * Storage service interface
 */
export interface StorageService {
  /** The proof set ID being used */
  readonly proofSetId: ProofSetId
  /** The storage provider being used */
  readonly storageProvider: StorageProvider

  /** Upload a binary blob and return an upload task */
  upload: (data: Uint8Array | ArrayBuffer) => UploadTask

  /**
   * Download a blob by CommP
   * @param commp - CommP as a CID object or string. Will be validated to ensure correct codec/hash
   */
  download: (commp: CommP | string, options?: DownloadOptions) => Promise<Uint8Array>

  /**
   * Delete a blob from storage
   * @param commp - CommP as a CID object or string. Will be validated to ensure correct codec/hash
   */
  delete: (commp: CommP | string) => Promise<void>

  /** Settle payments up to current epoch */
  settlePayments: () => Promise<SettlementResult>
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
  /** ID of the payment rail */
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
  /** Client's dataset ID */
  clientDataSetId: number
  /** Whether the proof set is using CDN */
  withCDN: boolean
}
