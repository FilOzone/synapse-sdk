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

/**
 * PDP service contract addresses (proxy addresses for upgradeable contracts)
 */
export const PDP_SERVICE_CONTRACT_ADDRESSES = {
  mainnet: '', // TODO: Get actual mainnet address from deployment
  calibration: '0x2B76E983d30553E7717547230670D4F4F4d813aC'
} as const

/**
 * PDP Verifier contract addresses
 */
export const PDP_VERIFIER_ADDRESSES = {
  mainnet: '', // TODO: Get actual mainnet address from deployment
  calibration: '0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC'
} as const

/**
 * SimplePDPServiceWithPayments ABI
 * This contract manages storage deals between clients and storage providers,
 * handling payment flows and integrating with PDP for storage verification.
 */
export const PDP_SERVICE_ABI = [
  // Constructor
  'constructor(address verifier, address payments)',

  // Client functions
  'function acceptOffer(uint256 offerId, bytes32[] calldata roots, uint256 contentSize)',
  'function endProvingPeriod(uint256 proofSetId)',
  'function refund(address token, uint256 amount)',

  // Storage Provider functions
  'function submitOffer(address client, address token, uint256 pricePerPeriodPerMiB, uint32 minDealDuration)',
  'function cancelOffer(uint256 offerId)',
  'function claimEarnings(address token)',

  // View functions
  'function getOffer(uint256 offerId) view returns (tuple(address serviceProvider, address client, address token, uint256 pricePerPeriodPerMiB, uint32 minDealDuration, uint256 expiresAt, uint8 status) offer)',
  'function getProvingPeriod(uint256 proofSetId) view returns (tuple(address serviceProvider, address client, uint256 offerId, address token, uint256 dealEndTimestamp, uint256 amountPerPeriod, uint256 lastClaimedPeriod, bool isCanceled) provingPeriod)',
  'function earnedAmounts(address serviceProvider, address token) view returns (uint256)',
  'function offers(uint256 offerId) view returns (address serviceProvider, address client, address token, uint256 pricePerPeriodPerMiB, uint32 minDealDuration, uint256 expiresAt, uint8 status)',
  'function provingPeriods(uint256 proofSetId) view returns (address serviceProvider, address client, uint256 offerId, address token, uint256 dealEndTimestamp, uint256 amountPerPeriod, uint256 lastClaimedPeriod, bool isCanceled)',

  // Public state variables
  'function verifier() view returns (address)',
  'function payments() view returns (address)',
  'function PERIOD_DURATION() view returns (uint256)',
  'function OFFER_EXPIRY_DURATION() view returns (uint256)',

  // Storage Provider Registry functions
  'function registerServiceProvider(string calldata pdpUrl, string calldata pieceRetrievalUrl)',
  'function approveServiceProvider(address provider) returns (uint256)',
  'function rejectServiceProvider(address provider)',
  'function removeServiceProvider(uint256 providerId)',
  'function approvedProviders(uint256 providerId) view returns (address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt)',
  'function approvedProvidersMap(address provider) view returns (bool)',
  'function pendingProviders(address provider) view returns (string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt)',
  'function providerToId(address provider) view returns (uint256)',
  'function getApprovedProvider(uint256 providerId) view returns (tuple(address owner, string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt, uint256 approvedAt) provider)',
  'function isProviderApproved(address provider) view returns (bool)',
  'function getPendingProvider(address provider) view returns (tuple(string pdpUrl, string pieceRetrievalUrl, uint256 registeredAt) provider)',
  'function getProviderIdByAddress(address provider) view returns (uint256)',

  // Events
  'event OfferSubmitted(uint256 indexed offerId, address indexed serviceProvider, address indexed client, address token, uint256 pricePerPeriodPerMiB, uint32 minDealDuration)',
  'event OfferAccepted(uint256 indexed offerId, uint256 indexed proofSetId)',
  'event OfferCanceled(uint256 indexed offerId)',
  'event ProvingPeriodEnded(uint256 indexed proofSetId)',
  'event EarningsClaimed(address indexed serviceProvider, address indexed token, uint256 amount)',
  'event ProviderRegistered(address indexed provider, string pdpUrl, string pieceRetrievalUrl)',
  'event ProviderApproved(address indexed provider, uint256 indexed providerId)',
  'event ProviderRejected(address indexed provider)',
  'event ProviderRemoved(address indexed provider, uint256 indexed providerId)'

  // Enums (for TypeScript reference)
  // enum OfferStatus { None, Active, Accepted, Canceled }
] as const
