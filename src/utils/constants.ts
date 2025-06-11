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
   * Pandora ABI - includes both PDP functions and service provider management
   */
  PANDORA_SERVICE: [
    // Write functions
    'function registerServiceProvider(string pdpUrl, string pieceRetrievalUrl) external',
    'function approveServiceProvider(address provider) external',
    'function rejectServiceProvider(address provider) external',
    'function removeServiceProvider(uint256 providerId) external',

    // Read functions
    'function isProviderApproved(address provider) external view returns (bool)',
    'function getProviderIdByAddress(address provider) external view returns (uint256)',
    'function getApprovedProvider(uint256 providerId) external view returns (tuple(address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt))',
    'function pendingProviders(address provider) external view returns (string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt)',
    'function approvedProviders(uint256 providerId) external view returns (address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt)',
    'function nextServiceProviderId() external view returns (uint256)',
    'function owner() external view returns (address)',
    'function getServicePrice() external view returns (tuple(uint256 pricePerTiBPerMonthNoCDN, uint256 pricePerTiBPerMonthWithCDN, address tokenAddress, uint256 epochsPerMonth) pricing)',

    // Public mappings that are automatically exposed
    'function approvedProvidersMap(address) external view returns (bool)',
    'function providerToId(address) external view returns (uint256)',
    'function getAllApprovedProviders() external view returns (tuple(address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt)[])',

    // Proof set functions
    'function getClientProofSets(address client) external view returns (tuple(uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, string[] rootMetadata, uint256 clientDataSetId, bool withCDN)[])',

    // Client dataset ID counter
    'function clientDataSetIDs(address client) external view returns (uint256)',

    // Mapping from rail ID to PDPVerifier proof set ID
    'function railToProofSet(uint256 railId) external view returns (uint256 proofSetId)',

    // Get proof set info by ID
    // See https://github.com/FilOzone/filecoin-services/pull/42
    'function getProofSet(uint256 id) public view returns (tuple(uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, string[] rootMetadata, uint256 clientDataSetId, bool withCDN) info)'
    // Was, one of:
    // 'function proofSetInfo(uint256 proofSetId) external view returns (tuple(uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, string[] rootMetadata, uint256 clientDataSetId, bool withCDN) info)'
    // 'function proofSetInfo(uint256 proofSetId) external view returns (uint256 railId, address payer, address payee, uint256 commissionBps, string metadata, uint256 clientDataSetId, bool withCDN)'
  ] as const,

  /**
   * PDPVerifier contract ABI - core PDP verification functions
   */
  PDP_VERIFIER: [
    'function getNextRootId(uint256 setId) public view returns (uint256)',
    'function proofSetLive(uint256 setId) public view returns (bool)',
    'function getProofSetLeafCount(uint256 setId) public view returns (uint256)',
    'function getProofSetOwner(uint256 setId) public view returns (address, address)',
    'function getProofSetListener(uint256 setId) public view returns (address)',
    'event ProofSetCreated(uint256 indexed setId, address indexed owner)'
  ] as const
} as const

/**
 * Time and size constants
 */
export const TIME_CONSTANTS = {
  /**
   * Number of epochs in a day (24 hours * 60 minutes * 2 epochs per minute)
   */
  EPOCHS_PER_DAY: 2880n,

  /**
   * Number of epochs in a month (30 days)
   */
  EPOCHS_PER_MONTH: 86400n, // 30 * 2880

  /**
   * Default lockup period in epochs (10 days)
   */
  DEFAULT_LOCKUP_PERIOD: 28800n // 10 * 2880
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
   * Maximum time to wait for a proof set creation to complete
   * This includes transaction mining and the proof set becoming live on-chain
   */
  PROOF_SET_CREATION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for proof set creation status
   */
  PROOF_SET_CREATION_POLL_INTERVAL_MS: 2000, // 2 seconds

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
   * Set to 0 to just get the receipt once mined without waiting for confirmations
   * Can be increased later for better finality guarantees
   */
  TRANSACTION_CONFIRMATIONS: 0,

  /**
   * Maximum time to wait for a root addition to be confirmed and acknowledged
   * This includes transaction confirmation and server verification
   */
  ROOT_ADDITION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for root addition status
   */
  ROOT_ADDITION_POLL_INTERVAL_MS: 1000 // 1 second
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
   * Pandora service contract addresses
   */
  PANDORA_SERVICE: {
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
