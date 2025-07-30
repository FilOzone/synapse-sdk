/**
 * Constants for the Synapse SDK
 */

import type { FilecoinNetworkType } from '../types.js'

/**
 * Token identifiers
 */
export const TOKENS = {
  USDFC: 'USDFC' as const,
  FIL: 'FIL' as const
} as const

/**
 * Network chain IDs
 */
export const CHAIN_IDS: Record<FilecoinNetworkType, number> = {
  mainnet: 314,
  calibration: 314159
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
    'function transfer(address to, uint256 amount) returns (bool)'
  ] as const,

  /**
   * Payments contract ABI - based on fws-payments contract
   */
  PAYMENTS: [
    'function deposit(address token, address to, uint256 amount)',
    'function withdraw(address token, uint256 amount)',
    'function accounts(address token, address owner) view returns (uint256 funds, uint256 lockupCurrent, uint256 lockupRate, uint256 lockupLastSettledAt)',
    'function setOperatorApproval(address token, address operator, bool approved, uint256 rateAllowance, uint256 lockupAllowance)',
    'function operatorApprovals(address token, address client, address operator) view returns (bool isApproved, uint256 rateAllowance, uint256 rateUsed, uint256 lockupAllowance, uint256 lockupUsed)'
  ] as const,

  /**
   * Warm Storage ABI - includes both PDP functions and service provider management
   */
  WARM_STORAGE: [
    // Write functions
    'function registerServiceProvider(string serviceURL, bytes peerId) external',
    'function approveServiceProvider(address provider) external',
    'function rejectServiceProvider(address provider) external',
    'function removeServiceProvider(uint256 providerId) external',

    // Read functions
    'function isProviderApproved(address provider) external view returns (bool)',
    'function getProviderIdByAddress(address provider) external view returns (uint256)',
    'function getApprovedProvider(uint256 providerId) external view returns (tuple(address storageProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt))',
    'function getPendingProvider(address provider) external view returns (tuple(string serviceURL, bytes peerId, uint256 registeredAt))',
    'function pendingProviders(address provider) external view returns (string serviceURL, bytes peerId, uint256 registeredAt)',
    'function approvedProviders(uint256 providerId) external view returns (address storageProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt)',
    'function nextServiceProviderId() external view returns (uint256)',
    'function owner() external view returns (address)',
    'function getServicePrice() external view returns (tuple(uint256 pricePerTiBPerMonthNoCDN, uint256 pricePerTiBPerMonthWithCDN, address tokenAddress, uint256 epochsPerMonth) pricing)',

    // Public mappings that are automatically exposed
    'function approvedProvidersMap(address) external view returns (bool)',
    'function providerToId(address) external view returns (uint256)',
    'function getAllApprovedProviders() external view returns (tuple(address storageProvider, string serviceURL, bytes peerId, uint256 registeredAt, uint256 approvedAt)[])',

    // Data set functions
    'function getClientDataSets(address client) external view returns (tuple(uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, string[] pieceMetadata, uint256 clientDataSetId, bool withCDN)[])',

    // Client dataset ID counter
    'function clientDataSetIDs(address client) external view returns (uint256)',

    // Mapping from rail ID to PDPVerifier data set ID
    'function railToDataSet(uint256 railId) external view returns (uint256 dataSetId)',

    // Get data set info by ID
    'function getDataSet(uint256 id) public view returns (tuple(uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, string[] pieceMetadata, uint256 clientDataSetId, bool withCDN) info)',

    // Proving period and timing functions
    'function getMaxProvingPeriod() external view returns (uint64)',
    'function challengeWindow() external view returns (uint256)',

    // PDPListener callbacks (called by PDPVerifier)
    'function dataSetCreated(uint256 dataSetId, address creator, bytes extraData) external',
    'function dataSetDeleted(uint256 dataSetId, uint256 deletedLeafCount, bytes extraData) external',
    'function piecesAdded(uint256 dataSetId, uint256 firstAdded, tuple(tuple(bytes data) piece, uint256 rawSize)[] pieceData, bytes extraData) external',
    'function piecesScheduledRemove(uint256 dataSetId, uint256[] pieceIds, bytes extraData) external',
    'function possessionProven(uint256 dataSetId, uint256 challengedLeafCount, uint256 seed, uint256 challengeCount) external',
    'function nextProvingPeriod(uint256 dataSetId, uint256 challengeEpoch, uint256 leafCount, bytes extraData) external',
    'function storageProviderChanged(uint256 dataSetId, address oldStorageProvider, address newStorageProvider, bytes extraData) external',

    // Commission management
    'function basicServiceCommissionBps() external view returns (uint256)',
    'function cdnServiceCommissionBps() external view returns (uint256)',
    'function updateServiceCommission(uint256 newBasicCommissionBps, uint256 newCdnCommissionBps) external',

    // Payment validation (IValidator interface)
    'function validatePayment(uint256 railId, uint256 proposedAmount, uint256 fromEpoch, uint256 toEpoch, uint256) external returns (tuple(uint256 modifiedAmount, uint256 settleUpto, string note))',

    // New data set functions
    'function getDataSetMetadata(uint256 dataSetId) external view returns (string)',
    'function getDataSetParties(uint256 dataSetId) external view returns (address payer, address payee)',
    'function getDataSetRailId(uint256 dataSetId) external view returns (uint256)',
    'function getDataSetWithCDN(uint256 dataSetId) external view returns (bool)',
    'function getPieceMetadata(uint256 dataSetId, uint256 pieceId) external view returns (string)',

    // Rate calculation functions
    'function calculateStorageRatePerEpoch(uint256 totalBytes, bool withCDN) external view returns (uint256)',
    'function getDataSetSizeInBytes(uint256 leafCount) external pure returns (uint256)',
    'function getEffectiveRates() external view returns (uint256 basicServiceFee, uint256 spPaymentBasic, uint256 cdnServiceFee, uint256 spPaymentWithCDN)',

    // Proving period functions
    'function getProvingPeriodForEpoch(uint256 dataSetId, uint256 epoch) external view returns (uint256)',
    'function isEpochProven(uint256 dataSetId, uint256 epoch) external view returns (bool)',
    'function thisChallengeWindowStart(uint256 setId) external view returns (uint256)',
    'function nextChallengeWindowStart(uint256 setId) external view returns (uint256)',

    // EIP-712 support
    'function eip712Domain() external view returns (bytes1 fields, string name, string version, uint256 chainId, address verifyingContract, bytes32 salt, uint256[] extensions)'
  ] as const,

  /**
   * PDPVerifier contract ABI - core PDP verification functions
   */
  PDP_VERIFIER: [
    // Core operations
    'function createDataSet(address listenerAddr, bytes extraData) payable returns (uint256)',
    'function deleteDataSet(uint256 setId, bytes extraData) external',
    'function addPieces(uint256 setId, tuple(tuple(bytes data) piece, uint256 rawSize)[] pieceData, bytes extraData) external returns (uint256)',
    'function schedulePieceDeletions(uint256 setId, uint256[] pieceIds, bytes extraData) external',

    // Proof operations
    'function provePossession(uint256 setId, tuple(bytes32 leaf, bytes32[] proof)[] proofs) payable external',
    'function nextProvingPeriod(uint256 setId, uint256 challengeEpoch, bytes extraData) external',

    // Storage provider management
    'function getDataSetStorageProvider(uint256 setId) external view returns (address current, address proposed)',
    'function proposeDataSetStorageProvider(uint256 setId, address newStorageProvider) external',
    'function claimDataSetStorageProvider(uint256 setId, bytes extraData) external',

    // Data set queries
    'function getNextPieceId(uint256 setId) public view returns (uint256)',
    'function dataSetLive(uint256 setId) public view returns (bool)',
    'function getDataSetLeafCount(uint256 setId) public view returns (uint256)',
    'function getDataSetListener(uint256 setId) public view returns (address)',
    'function getDataSetLastProvenEpoch(uint256 setId) external view returns (uint256)',

    // Piece information
    'function getPieceCid(uint256 setId, uint256 pieceId) external view returns (tuple(bytes data))',
    'function getPieceLeafCount(uint256 setId, uint256 pieceId) external view returns (uint256)',
    'function getActivePieceCount(uint256 setId) external view returns (uint256)',
    'function getActivePieces(uint256 setId, uint256 offset, uint256 limit) external view returns (tuple(bytes data)[] pieces, uint256[] pieceIds, uint256[] rawSizes, bool hasMore)',
    'function pieceLive(uint256 setId, uint256 pieceId) external view returns (bool)',
    'function pieceChallengable(uint256 setId, uint256 pieceId) external view returns (bool)',

    // Challenge functions
    'function getChallengeRange(uint256 setId) external view returns (uint256)',
    'function getNextChallengeEpoch(uint256 setId) external view returns (uint256)',
    'function getChallengeFinality() external view returns (uint256)',

    // Utility functions
    'function findPieceIds(uint256 setId, uint256[] leafIndexs) external view returns (tuple(uint256 pieceId, uint256 offset)[])',
    'function getScheduledRemovals(uint256 setId) external view returns (uint256[])',
    'function getRandomness(uint256 epoch) external view returns (uint256)',
    'function calculateProofFee(uint256 setId, uint256 estimatedGasFee) external returns (uint256)',
    'function getFILUSDPrice() external returns (uint64 price, int32 expo)',

    // Events
    'event DataSetCreated(uint256 indexed setId, address indexed storageProvider)',
    'event StorageProviderChanged(uint256 indexed setId, address indexed oldStorageProvider, address indexed newStorageProvider)',
    'event DataSetDeleted(uint256 indexed setId, uint256 deletedLeafCount)',
    'event DataSetEmpty(uint256 indexed setId)',
    'event PiecesAdded(uint256 indexed setId, uint256[] pieceIds)',
    'event PiecesRemoved(uint256 indexed setId, uint256[] pieceIds)',
    'event PossessionProven(uint256 indexed setId, tuple(uint256 pieceId, uint256 offset)[] challenges)',
    'event NextProvingPeriod(uint256 indexed setId, uint256 challengeEpoch, uint256 leafCount)'
  ] as const
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
  DEFAULT_LOCKUP_DAYS: 10n
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
  calibration: 1667326380
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
   * CommP calculation requires at least 65 bytes
   */
  MIN_UPLOAD_SIZE: 65
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
  PIECE_ADDITION_POLL_INTERVAL_MS: 1000 // 1 second
} as const

/**
 * Recommended RPC endpoints for Filecoin networks
 */
export const RPC_URLS: Record<FilecoinNetworkType, { http: string, websocket: string }> = {
  mainnet: {
    http: 'https://api.node.glif.io/rpc/v1',
    websocket: 'wss://wss.node.glif.io/apigw/lotus/rpc/v1'
  },
  calibration: {
    http: 'https://api.calibration.node.glif.io/rpc/v1',
    websocket: 'wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1'
  }
} as const

/**
 * Contract addresses
 */
export const CONTRACT_ADDRESSES = {
  /**
   * USDFC token contract addresses
   */
  USDFC: {
    mainnet: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
    calibration: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
  } as const satisfies Record<FilecoinNetworkType, string>,

  /**
   * Payments contract addresses
   */
  PAYMENTS: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0x0E690D3e60B0576D01352AB03b258115eb84A047'
  } as const satisfies Record<FilecoinNetworkType, string>,

  /**
   * Warm Storage service contract addresses
   */
  WARM_STORAGE: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0xf49ba5eaCdFD5EE3744efEdf413791935FE4D4c5'
  } as const satisfies Record<FilecoinNetworkType, string>,

  /**
   * PDPVerifier contract addresses
   */
  PDP_VERIFIER: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC'
  } as const satisfies Record<FilecoinNetworkType, string>
} as const

/**
 * Multihash constants
 */
export const MULTIHASH_CODES = {
  /**
   * SHA2-256 truncated to 254 bits with padding - used for Filecoin CommP
   */
  SHA2_256_TRUNC254_PADDED: 'sha2-256-trunc254-padded'
} as const
