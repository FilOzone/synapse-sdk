/**
 * Constants for the Synapse SDK
 */

import { erc20Abi, multicall3Abi } from 'viem'
import { erc20PermitAbi } from '../abis/erc20-permit.ts'
import * as abis from '../abis/gen.ts'
import type { FilecoinNetworkType } from '../types.ts'

/**
 * Token identifiers
 */
export const TOKENS = {
  USDFC: 'USDFC' as const,
  FIL: 'FIL' as const,
} as const

/**
 * Network chain IDs
 */
export const CHAIN_IDS: Record<FilecoinNetworkType, number> = {
  mainnet: 314,
  calibration: 314159,
} as const

/**
 * Contract ABIs
 */
export const CONTRACT_ABIS = {
  /**
   * ERC20 ABI - minimal interface needed for balance and approval operations
   */
  ERC20: erc20Abi,

  /**
   * Minimal ERC20Permit ABI - for reading nonces() and version()
   */
  ERC20_PERMIT: erc20PermitAbi,

  /**
   * Payments contract ABI - based on fws-payments contract
   */
  PAYMENTS: abis.paymentsAbi,

  /**
   * PDPVerifier contract ABI - core PDP verification functions
   */
  PDP_VERIFIER: abis.pdpVerifierAbi,

  /**
   * Warm Storage ABI - write functions and service provider management
   * View methods are in the WARM_STORAGE_VIEW contract
   */
  WARM_STORAGE: abis.filecoinWarmStorageServiceAbi,

  /**
   * Warm Storage View contract ABI - read-only view methods separated from main contract
   * These methods were moved from the main Warm Storage contract to reduce contract size
   */
  WARM_STORAGE_VIEW: abis.filecoinWarmStorageServiceStateViewAbi,

  /**
   * Multicall3 ABI - for batching multiple contract calls into a single RPC request
   */
  MULTICALL3: multicall3Abi,

  /**
   * ServiceProviderRegistry ABI - for provider management
   */
  SERVICE_PROVIDER_REGISTRY: abis.serviceProviderRegistryAbi,

  /**
   * SessionKeyRegistry ABI - for session key management
   */
  SESSION_KEY_REGISTRY: abis.sessionKeyRegistryAbi,
} as const

/**
 * EIP-2612 typed data schema (Permit)
 */
export const EIP2612_PERMIT_TYPES: Record<string, { name: string; type: string }[]> = {
  Permit: [
    { name: 'owner', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
}

/**
 * Time and size constants
 */
export const TIME_CONSTANTS = {
  /**
   * Duration of each epoch in seconds on Filecoin
   */
  EPOCH_DURATION: 30,

  /**
   * Number of epochs in a day (24 hours * 60 minutes * 2 epochs per minute)
   */
  EPOCHS_PER_DAY: 2880n,

  /**
   * Number of epochs in a month (30 days)
   */
  EPOCHS_PER_MONTH: 86400n, // 30 * 2880

  /**
   * Number of days in a month (used for pricing calculations)
   */
  DAYS_PER_MONTH: 30n,

  /**
   * Default lockup period in days
   */
  DEFAULT_LOCKUP_DAYS: 30n,
} as const

/**
 * Genesis timestamps for Filecoin networks (Unix timestamp in seconds)
 */
export const GENESIS_TIMESTAMPS: Record<FilecoinNetworkType, number> = {
  /**
   * Mainnet genesis: August 24, 2020 22:00:00 UTC
   */
  mainnet: 1598306400,
  /**
   * Calibration testnet genesis: November 1, 2022 18:13:00 UTC
   */
  calibration: 1667326380,
} as const

/**
 * Data size constants
 */
export const SIZE_CONSTANTS = {
  /**
   * Bytes in 1 KiB
   */
  KiB: 1024n,

  /**
   * Bytes in 1 MiB
   */
  MiB: 1n << 20n,

  /**
   * Bytes in 1 GiB
   */
  GiB: 1n << 30n,

  /**
   * Bytes in 1 TiB
   */
  TiB: 1n << 40n,

  /**
   * Bytes in 1 PiB
   */
  PiB: 1n << 50n,

  /**
   * Maximum upload size (200 MiB)
   * Current limitation for PDP uploads
   */
  MAX_UPLOAD_SIZE: 200 * 1024 * 1024,

  /**
   * Minimum upload size (127 bytes)
   * PieceCIDv2 calculation requires at least 127 bytes payload
   */
  MIN_UPLOAD_SIZE: 127,

  /**
   * Default number of uploads to batch together in a single addPieces transaction
   * This balances gas efficiency with reasonable transaction sizes
   */
  DEFAULT_UPLOAD_BATCH_SIZE: 32,
} as const

/**
 * Common metadata keys
 */
export const METADATA_KEYS = {
  /**
   * Key used to request that CDN services should be enabled for a data set. The presence of this
   * key does not strictly guarantee that CDN services will be provided, but the Warm Storage
   * contract will attempt to enable payment for CDN services if this key is present.
   *
   * The value for this key is always an empty string.
   *
   * Only valid for *data set* metadata.
   */
  WITH_CDN: 'withCDN',

  /**
   * Key used to request that a PDP server perform IPFS indexing and announcing to IPNI should be
   * enabled for all pieces in a data set. The contents of the associated data sets are assumed to
   * be indexable (i.e. a CAR or a PoDSI container) and the PDP server will be requested to perform
   * best-effort indexing. The presence of this key does not guarantee that indexing will be
   * performed or succeed.
   *
   * The value for this key is always an empty string.
   *
   * Only valid for *data set* metadata.
   */
  WITH_IPFS_INDEXING: 'withIPFSIndexing',

  /**
   * Key used to indicate a root CID of an IPLD DAG contained within the associated piece.
   * Advisory only: do not treat as proof that the CID is valid, that IPLD blocks are present, or
   * that the referenced DAG is fully present or retrievable. Intended as a secondary identifier
   * provided by the data producer; not interpreted by contracts.
   *
   * The value for this key should be a valid CID string.
   *
   * Only valid for *piece* metadata.
   */
  IPFS_ROOT_CID: 'ipfsRootCID',
} as const

/**
 * Timing constants for blockchain operations
 */
export const TIMING_CONSTANTS = {
  /**
   * How long to wait for a transaction to appear on the network
   * This is used when we have a transaction hash but need to fetch the transaction object
   * Filecoin has 30-second epochs, so this gives one full epoch for propagation
   */
  TRANSACTION_PROPAGATION_TIMEOUT_MS: 30000, // 30 seconds (1 epoch)

  /**
   * How often to poll when waiting for a transaction to appear
   */
  TRANSACTION_PROPAGATION_POLL_INTERVAL_MS: 2000, // 2 seconds

  /**
   * Maximum time to wait for a data set creation to complete
   * This includes transaction mining and the data set becoming live on-chain
   */
  DATA_SET_CREATION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for data set creation status
   */
  DATA_SET_CREATION_POLL_INTERVAL_MS: 2000, // 2 seconds

  /**
   * Maximum time to wait for a piece to be parked (uploaded) to storage
   * This is typically slower than blockchain operations as it involves data transfer
   */
  PIECE_PARKING_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for piece parking status
   * Less frequent than blockchain polling as uploads take longer
   */
  PIECE_PARKING_POLL_INTERVAL_MS: 5000, // 5 seconds

  /**
   * Number of confirmations to wait for when calling transaction.wait()
   * Set to 1 by default to ensure the transaction is mined, could be increased
   * in the future, or aligned to F3 expectations
   */
  TRANSACTION_CONFIRMATIONS: 1,

  /**
   * Default expiry time for EIP-2612 permit signatures (in seconds)
   * Permits are time-limited approvals that expire after this duration
   */
  PERMIT_DEADLINE_DURATION: 3600, // 1 hour

  /**
   * Maximum time to wait for a piece addition to be confirmed and acknowledged
   * This includes transaction confirmation and server verification
   */
  PIECE_ADDITION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for piece addition status
   */
  PIECE_ADDITION_POLL_INTERVAL_MS: 1000, // 1 second
} as const

/**
 * Settlement fee required for rail settlement operations
 * This is the NETWORK_FEE constant in the Payments contract that gets burned to the Filecoin network
 * Value: 0.0013 FIL (1300000000000000 attoFIL)
 *
 * IMPORTANT: This value must be kept in sync with the Payments contract's NETWORK_FEE constant.
 * If the contract is upgraded with a different fee, this constant must be updated accordingly.
 */
export const SETTLEMENT_FEE = 1300000000000000n // 0.0013 FIL in attoFIL

/**
 * Recommended RPC endpoints for Filecoin networks
 */
export const RPC_URLS: Record<FilecoinNetworkType, { http: string; websocket: string }> = {
  mainnet: {
    http: 'https://api.node.glif.io/rpc/v1',
    websocket: 'wss://wss.node.glif.io/apigw/lotus/rpc/v1',
  },
  calibration: {
    http: 'https://api.calibration.node.glif.io/rpc/v1',
    websocket: 'wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1',
  },
} as const

/**
 * Contract addresses
 */
export const CONTRACT_ADDRESSES = {
  /**
   * Warm Storage service contract addresses - the only address needed for SDK initialization
   * All other contract addresses are discovered from this contract
   */
  WARM_STORAGE: {
    mainnet: '0x81DFD9813aDd354f03704F31419b0c6268d46232',
    calibration: '0xD3De778C05f89e1240ef70100Fb0d9e5b2eFD258',
  } as const satisfies Record<FilecoinNetworkType, string>,

  /**
   * Multicall3 contract addresses - used for batching multiple contract calls
   * Same address across most EVM chains including Filecoin
   */
  MULTICALL3: {
    mainnet: '0xcA11bde05977b3631167028862bE2a173976CA11',
    calibration: '0xcA11bde05977b3631167028862bE2a173976CA11',
  } as const satisfies Record<FilecoinNetworkType, string>,

  USDFC: {
    mainnet: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
    calibration: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0',
  } as const satisfies Record<FilecoinNetworkType, string>,
} as const
