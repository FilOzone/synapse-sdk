/**
 * Constants for the Synapse SDK
 */

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
export const CHAIN_IDS = {
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
    'function getAllApprovedProviders() external view returns (tuple(address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt)[])'
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
  TiB: 1024n * 1024n * 1024n * 1024n
} as const

/**
 * Recommended RPC endpoints for Filecoin networks
 */
export const RPC_URLS = {
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
  } as const,

  /**
   * Payments contract addresses
   */
  PAYMENTS: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0x0E690D3e60B0576D01352AB03b258115eb84A047'
  } as const,

  /**
   * Pandora service contract addresses
   */
  PANDORA_SERVICE: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0xBfDC4454c2B573079C6c5eA1DDeF6B8defC03dd5'
  } as const
} as const
