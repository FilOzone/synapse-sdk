/**
 * Synapse SDK TypeScript Definition
 * A JavaScript interface to Filecoin Synapse
 *
 * Focused on storage of binary blobs with PDP (Proof of Data Possession)
 * and optional CDN retrieval services.
 */

import { LegacyPieceLink } from '@web3-storage/data-segment'
import type { ethers } from 'ethers'

// Type definitions for common values
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
 * CommP - A constrained CID type for Piece Commitments
 * This is implemented as a Link type which is made concrete by a CID. A CommP
 * uses the fil-commitment-unsealed codec (0xf101) and
 * sha2-256-trunc254-padded multihash function (0x1012). This will eventually be
 * replaced by a CommPv2 which uses the raw codec (0x55) and the
 * fr32-sha256-trunc254-padbintree multihash function (0x1011), which is a
 * specialised form of sha2-256-trunc254-padded multihash that also encodes the
 * content length and the height of the merkle tree.
 */
export type CommP = LegacyPieceLink

/**
 * Options for initializing the Synapse instance
 * Must provide one of:
 * 1. privateKey + rpcURL (for server environments)
 * 2. provider (for browser environments - user handles MetaMask coupling)
 * 3. signer (legacy interface - for backward compatibility)
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
  /** Ethers Signer instance (legacy - for backward compatibility) */
  signer?: ethers.Signer
  /** Whether to disable NonceManager for automatic nonce management (default: false, meaning NonceManager is used) */
  disableNonceManager?: boolean
  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
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
  /** Amount settled in USDFC (in smallest unit, not human readable) */
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
 * Main Synapse interface
 */
export interface Synapse {
  /** Get current USDFC balance available for storage operations */
  balance: (token?: TokenIdentifier) => Promise<bigint>

  /** Get the token balance of the wallet (FIL or USDFC). Defaults to FIL if no token specified. */
  walletBalance: (() => Promise<bigint>) & ((token: TokenIdentifier) => Promise<bigint>)

  /** Get the number of decimals for a token (always 18 for FIL and USDFC) */
  decimals: (token?: TokenIdentifier) => number

  /** Deposit USDFC for storage operations, returns transaction hash */
  deposit: (amount: TokenAmount, token?: TokenIdentifier) => Promise<string>

  /** Withdraw USDFC from the system, returns transaction hash */
  withdraw: (amount: TokenAmount, token?: TokenIdentifier) => Promise<string>

  /** Create a storage service instance */
  createStorage: (options?: StorageOptions) => Promise<StorageService>
}
