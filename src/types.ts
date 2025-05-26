/**
 * Synapse SDK TypeScript Definition
 * A JavaScript interface to Filecoin Synapse
 *
 * Focused on storage of binary blobs with PDP (Proof of Data Possession)
 * and optional CDN retrieval services.
 */

import type { CID } from 'multiformats/cid'

// Type definitions for common values
export type PrivateKey = string
export type Address = string
export type TokenAmount = string | number | bigint
export type ProofSetId = string
export type StorageProvider = string

/**
 * CommP - A constrained CID type for Piece Commitments
 * Uses fil-commitment-unsealed codec (0xf101) and sha2-256-trunc254-padded hasher (0x1012)
 */
export type CommP = CID & {
  readonly code: 0xf101 // fil-commitment-unsealed
  readonly multihash: { code: 0x1012 } // sha2-256-trunc254-padded
}

/**
 * Options for initializing the Synapse instance
 */
export interface SynapseOptions {
  /** Private key for signing transactions */
  privateKey: PrivateKey
  /** Whether to use CDN for retrievals (default: false) */
  withCDN?: boolean
  /** RPC API endpoint (optional, defaults to Filecoin mainnet with Glif nodes) */
  rpcAPI?: string
  /** Subgraph API endpoint (optional) */
  subgraphAPI?: string
  /** Service contract address (optional) */
  serviceContract?: Address
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
  commp(): Promise<CommP>
  /** Get the storage provider once data is stored */
  store(): Promise<StorageProvider>
  /** Wait for the entire upload process to complete, returns transaction hash */
  done(): Promise<string>
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
  /** Amount settled in USDFC */
  settledAmount: TokenAmount
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
  upload(data: Uint8Array | ArrayBuffer): UploadTask

  /**
   * Download a blob by CommP
   * @param commp - CommP as a CID object or string. Will be validated to ensure correct codec/hash
   */
  download(commp: CommP | string, options?: DownloadOptions): Promise<Uint8Array>

  /**
   * Delete a blob from storage
   * @param commp - CommP as a CID object or string. Will be validated to ensure correct codec/hash
   */
  delete(commp: CommP | string): Promise<void>

  /** Settle payments up to current epoch */
  settlePayments(): Promise<SettlementResult>
}

/**
 * Main Synapse interface
 */
export interface Synapse {
  /** Get current USDFC balance available for storage operations */
  balance(): Promise<TokenAmount>

  /** Deposit USDFC for storage operations */
  deposit(amount: TokenAmount): Promise<TokenAmount>

  /** Withdraw USDFC from the system */
  withdraw(amount: TokenAmount): Promise<TokenAmount>

  /** Create a storage service instance */
  createStorage(options?: StorageOptions): Promise<StorageService>
}

// Re-export CID type from multiformats for convenience
export type { CID } from 'multiformats/cid'