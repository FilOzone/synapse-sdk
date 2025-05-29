/**
 * Constants for the Synapse SDK
 */

/**
 * USDFC token contract addresses
 */
export const USDFC_ADDRESSES = {
  mainnet: '0x80B98d3aa09ffff255c3ba4A241111Ff1262F045',
  calibration: '0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0'
} as const

/**
 * Network chain IDs
 */
export const CHAIN_IDS = {
  mainnet: 314,
  calibration: 314159
} as const

/**
 * ERC20 ABI - minimal interface needed for balance and approval operations
 */
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)'
] as const

/**
 * Payments contract addresses
 */
export const PAYMENTS_ADDRESSES = {
  mainnet: '', // TODO: Get actual mainnet address from deployment
  calibration: '0x0E690D3e60B0576D01352AB03b258115eb84A047'
} as const

/**
 * Payments contract ABI - based on fws-payments contract
 */
export const PAYMENTS_ABI = [
  'function deposit(address token, address to, uint256 amount)',
  'function withdraw(address token, uint256 amount)',
  'function accounts(address token, address owner) view returns (uint256 funds, uint256 lockedFunds, bool frozen)',
  'function setOperatorApproval(address token, address operator, uint256 allowance)',
  'function operatorApprovals(address token, address client, address operator) view returns (uint256)'
] as const

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
