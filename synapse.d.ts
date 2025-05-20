/**
 * Synapse SDK TypeScript Definition
 * A JavaScript interface to Filecoin Synapse
 */

// Type definitions for common values
type RpcUrl = string // HTTP/HTTPS or WS/WSS URL
type PrivateKey = string
type Address = string
type CID = string
type TokenAmount = string | number | bigint

/**
 * Options for initializing the Synapse instance
 */
interface SynapseOptions {
  /** RPC URL for blockchain provider (HTTP/HTTPS or WS/WSS) */
  rpcUrl: RpcUrl
  /** Private key for signing transactions */
  privateKey: PrivateKey
  /** Optional gas settings */
  gas?: {
    maxFeePerGas?: bigint
    maxPriorityFeePerGas?: bigint
    gasLimit?: bigint
  }
}

/**
 * Storage Service SLA configuration
 */
interface StorageConfig {
  /** Duration of the storage agreement in days */
  duration?: number
  /** Number of replicas to maintain */
  replicas?: number
  /** Number of retrieval checks to perform during the duration */
  retrievalCheck?: number
  /** Whether to archive the data with PoRep */
  archive?: boolean
}

/**
 * Metadata for content (files or directories)
 */
interface ContentMetadata {
  /** Name of the content (filename or directory name) */
  name: string
  /** MIME type of the content (for files) */
  mimeType?: string
  /** Last modified timestamp */
  mtime?: number
  /** File mode (permissions) */
  mode?: number
  /** File size in bytes (if known) */
  size?: number
}

/**
 * Source of content data and metadata
 */
interface ContentSource {
  /** Content metadata */
  metadata: ContentMetadata
  /** Get content as bytes */
  bytes(): Promise<Uint8Array | ArrayBuffer>
}

/**
 * Source of directory structure and metadata
 */
interface DirectorySource {
  /** Directory metadata */
  metadata: ContentMetadata
  /** Get entries in this directory */
  entries(): Promise<Array<ContentSource | DirectorySource>>
}

/**
 * Upload options
 */
interface UploadOptions {
  /** SLA parameters that override the defaults */
  sla?: StorageConfig
  /** Chunking strategy */
  chunking?: {
    strategy: 'fixed' | 'rabin'
    size?: number
  }
  /** Wrap single files in a directory */
  wrapWithDirectory?: boolean
}

/**
 * Download options
 */
interface DownloadOptions {
  /** Timeout in milliseconds */
  timeout?: number
  /** Preferred provider address, if any */
  preferredProvider?: Address
  /** Verify data integrity after download */
  verify?: boolean
}

/**
 * Payment info object
 */
interface PaymentInfo {
  amount: TokenAmount
  recipient: Address
  timestamp: number
  txHash?: string
  status: 'pending' | 'complete' | 'failed'
}

/**
 * Storage check result
 */
interface CheckResult {
  verified: boolean
  providers: Address[]
  timestamp: number
  faults?: {
    count: number
    lastFault?: number
  }
}

/**
 * Storage status object
 */
interface StorageStatus {
  size: number
  created: number
  providers: Address[]
  status: 'active' | 'expired' | 'pending'
  expiresAt?: number
  proofSetId?: string
  nextChallengeEpoch?: number
}

/**
 * Storage service class
 */
declare class Storage {
  /** Upload content and get a CID */
  upload(content: ContentSource, options?: UploadOptions): Promise<CID>
  
  /** Upload directory structure and get a CID */
  uploadDirectory(directory: DirectorySource, options?: UploadOptions): Promise<CID>
  
  /** Upload raw bytes and get a CID */
  uploadBytes(data: Uint8Array | ArrayBuffer, name?: string, options?: UploadOptions): Promise<CID>
  
  /** Archive data for long-term storage with PoRep */
  archive(cid: CID): Promise<void> // TODO: return type?
  
  /** Download content by CID */
  download(cid: CID, options?: DownloadOptions): Promise<ContentSource>
  
  /** Download directory by CID */
  downloadDirectory(cid: CID, options?: DownloadOptions): Promise<DirectorySource>
  
  /** Check if a CID is available in the network */
  isAvailable(cid: CID): Promise<boolean>
  
  /** Check if a CID is retrievable by the current user */
  isRetrievable(cid: CID): Promise<boolean>
  
  /** Check if a CID is archived with PoRep */
  isArchived(cid: CID): Promise<boolean>
  
  /** Perform a verification check on a stored CID */
  check(cid: CID): Promise<CheckResult>
  
  /** Get detailed storage status information for a CID */
  status(cid: CID): Promise<StorageStatus>
}

/**
 * Main Synapse class
 */
declare class Synapse {
  constructor(options: SynapseOptions)

  /** Get the connected wallet address */
  get address(): Address

  /** Create a storage service instance */
  createStorage(options?: StorageConfig): Storage

  /** Get the balance of the connected wallet */
  getBalance(): Promise<TokenAmount>

  /** Deposit funds for storage services */
  paymentDeposit(amount: TokenAmount): Promise<PaymentInfo>

  /** Settle payment with a provider */
  paymentSettle(provider: Address, amount: TokenAmount): Promise<PaymentInfo>

  /** Withdraw funds */
  paymentWithdraw(amount: TokenAmount): Promise<PaymentInfo>

  /** Close connections and clean up resources */
  disconnect(): Promise<void>
}

export { 
  Synapse,
  Storage,
  ContentSource,
  DirectorySource,
  ContentMetadata,
  StorageConfig,
  UploadOptions,
  DownloadOptions,
  CheckResult,
  StorageStatus,
  PaymentInfo
}