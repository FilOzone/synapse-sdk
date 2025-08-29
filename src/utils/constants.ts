/**
 * Constants for the Synapse SDK
 */

import type { FilecoinNetworkType } from '../types.js'

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
  ERC20: [
    'function balanceOf(address owner) view returns (uint256)',
    'function decimals() view returns (uint8)',
    'function symbol() view returns (string)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
  ] as const,

  /**
   * Payments contract ABI - based on fws-payments contract
   */
  PAYMENTS: [
    'function deposit(address token, address to, uint256 amount) payable',
    'function withdraw(address token, uint256 amount)',
    'function accounts(address token, address owner) view returns (uint256 funds, uint256 lockupCurrent, uint256 lockupRate, uint256 lockupLastSettledAt)',
    'function setOperatorApproval(address token, address operator, bool approved, uint256 rateAllowance, uint256 lockupAllowance, uint256 maxLockupPeriod)',
    'function operatorApprovals(address token, address client, address operator) view returns (bool isApproved, uint256 rateAllowance, uint256 rateUsed, uint256 lockupAllowance, uint256 lockupUsed, uint256 maxLockupPeriod)',
  ] as const,

  /**
   * PDPVerifier contract ABI - core PDP verification functions
   */
  PDP_VERIFIER: [
    'function getNextPieceId(uint256 setId) public view returns (uint256)',
    'function dataSetLive(uint256 setId) public view returns (bool)',
    'function getDataSetLeafCount(uint256 setId) public view returns (uint256)',
    'function getDataSetStorageProvider(uint256 setId) public view returns (address, address)',
    'function getDataSetListener(uint256 setId) public view returns (address)',
    'event DataSetCreated(uint256 indexed setId, address indexed owner)',
  ] as const,

  /**
   * Warm Storage ABI - write functions and service provider management
   * View methods are in the WARM_STORAGE_VIEW contract
   */
  WARM_STORAGE: [
    // Write functions
    'function registerServiceProvider(string serviceURL, bytes peerId) external payable',
    'function approveServiceProvider(address provider) external',
    'function rejectServiceProvider(address provider) external',
    'function removeServiceProvider(uint256 providerId) external',

    // Service provider read functions (temporarily in main contract)
    'function getProviderIdByAddress(address provider) external view returns (uint256)',
    'function getApprovedProvider(uint256 providerId) external view returns (tuple(address serviceProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt))',
    'function pendingProviders(address provider) external view returns (string serviceURL, bytes peerId, uint256 registeredAt)',
    'function approvedProviders(uint256 providerId) external view returns (address serviceProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt)',
    'function getAllApprovedProviders() external view returns (tuple(address serviceProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt)[])',

    // Other read functions
    'function owner() external view returns (address)',
    'function getServicePrice() external view returns (tuple(uint256 pricePerTiBPerMonthNoCDN, uint256 pricePerTiBPerMonthWithCDN, address tokenAddress, uint256 epochsPerMonth))',
    'function providerToId(address) external view returns (uint256)',
    'function viewContractAddress() external view returns (address)',

    // Address getter functions for contract discovery
    'function pdpVerifierAddress() external view returns (address)',
    'function paymentsContractAddress() external view returns (address)',
    'function usdfcTokenAddress() external view returns (address)',
    'function filCDNAddress() external view returns (address)',
  ] as const,

  /**
   * Warm Storage View contract ABI - read-only view methods separated from main contract
   * These methods were moved from the main Warm Storage contract to reduce contract size
   */
  WARM_STORAGE_VIEW: [
    // Data set view functions
    'function getClientDataSets(address client) external view returns (tuple(uint256 pdpRailId, uint256 cacheMissRailId, uint256 cdnRailId, address payer, address payee, uint256 commissionBps, string metadata, string[] pieceMetadata, uint256 clientDataSetId, bool withCDN, uint256 paymentEndEpoch)[])',
    'function getDataSet(uint256 dataSetId) external view returns (tuple(uint256 pdpRailId, uint256 cacheMissRailId, uint256 cdnRailId, address payer, address payee, uint256 commissionBps, string metadata, string[] pieceMetadata, uint256 clientDataSetId, bool withCDN, uint256 paymentEndEpoch))',

    // Client dataset ID counter
    'function clientDataSetIDs(address client) external view returns (uint256)',

    // Mapping from rail ID to PDPVerifier data set ID
    'function railToDataSet(uint256 railId) external view returns (uint256 dataSetId)',

    // Proving period and timing functions
    'function getMaxProvingPeriod() external view returns (uint64)',
    'function challengeWindow() external view returns (uint256)',
  ] as const,

  /**
   * Multicall3 ABI - for batching multiple contract calls into a single RPC request
   */
  MULTICALL3: [
    'function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) public payable returns (tuple(bool success, bytes returnData)[])',
  ] as const,
} as const

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
  DEFAULT_LOCKUP_DAYS: 10n,
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
  MiB: 1024n * 1024n,

  /**
   * Bytes in 1 GiB
   */
  GiB: 1024n * 1024n * 1024n,

  /**
   * Bytes in 1 TiB
   */
  TiB: 1024n * 1024n * 1024n * 1024n,

  /**
   * Maximum upload size (200 MiB)
   * Current limitation for PDP uploads
   */
  MAX_UPLOAD_SIZE: 200 * 1024 * 1024,

  /**
   * Minimum upload size (65 bytes)
   * PieceCID calculation requires at least 65 bytes
   */
  MIN_UPLOAD_SIZE: 65,

  /**
   * Default number of uploads to batch together in a single addPieces transaction
   * This balances gas efficiency with reasonable transaction sizes
   */
  DEFAULT_UPLOAD_BATCH_SIZE: 32,
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
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0xA94C1139412da84d3bBb152dac22B0943332fD78',
  } as const satisfies Record<FilecoinNetworkType, string>,

  /**
   * Multicall3 contract addresses - used for batching multiple contract calls
   * Same address across most EVM chains including Filecoin
   */
  MULTICALL3: {
    mainnet: '0xcA11bde05977b3631167028862bE2a173976CA11',
    calibration: '0xcA11bde05977b3631167028862bE2a173976CA11',
  } as const satisfies Record<FilecoinNetworkType, string>,
} as const
