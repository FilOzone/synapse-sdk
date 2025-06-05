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
    'function accounts(address token, address owner) view returns (uint256 funds, uint256 lockedFunds, bool frozen)',
    'function setOperatorApproval(address token, address operator, uint256 allowance)',
    'function operatorApprovals(address token, address client, address operator) view returns (uint256)'
  ] as const,

  /**
   * SimplePDPServiceWithPayments ABI - includes both PDP functions and service provider management
   */
  PDP_SERVICE: [
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
    'function owner() external view returns (address)'
  ] as const
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
   * PDP service contract addresses (SimplePDPServiceWithPayments)
   */
  PDP_SERVICE: {
    mainnet: '', // TODO: Get actual mainnet address from deployment
    calibration: '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4'
  } as const
} as const
