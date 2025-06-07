# Synapse SDK

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

## Overview

The Synapse SDK is designed with flexibility in mind:

- **🚀 Recommended Usage**: Use the high-level `Synapse` class for a streamlined experience with sensible defaults
- **🔧 Composable Components**: Import and use individual components for fine-grained control over specific functionality

Whether you're building a quick prototype or a complex application with specific requirements, the SDK adapts to your needs.

## Installation

```bash
npm install @filoz/synapse-sdk ethers
```

Note: `ethers` v6 is a peer dependency and must be installed separately.

## Table of Contents

* [Overview](#overview)
* [Installation](#installation)
* [Recommended Usage](#recommended-usage)
  * [Quick Start](#quick-start)
  * [With MetaMask](#with-metamask)
  * [Advanced Payment Control](#advanced-payment-control)
  * [API Reference](#api-reference)
* [Using Individual Components](#using-individual-components)
  * [Payments Service](#payments-service)
  * [Pandora Service](#pandora-service)
  * [PDP Components](#pdp-components)
  * [CommP Utilities](#commp-utilities)
* [Network Configuration](#network-configuration)
  * [RPC Endpoints](#rpc-endpoints)
  * [GLIF Authorization](#glif-authorization)
  * [Network Details](#network-details)
* [Browser Integration](#browser-integration)
  * [MetaMask Setup](#metamask-setup)
* [Additional Information](#additional-information)
  * [Type Definitions](#type-definitions)
  * [Error Handling](#error-handling)
* [Contributing](#contributing)
  * [Testing](#testing)
* [License](#license)

---

## Recommended Usage

The `Synapse` class provides a complete, easy-to-use interface for interacting with Filecoin storage services.

### Quick Start

```javascript
import { Synapse, RPC_URLS, TOKENS } from '@filoz/synapse-sdk'

// Initialize with private key
const synapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.mainnet.websocket
})

// Check balances
const filBalance = await synapse.payments.walletBalance()                   // FIL in wallet
const usdcBalance = await synapse.payments.walletBalance(TOKENS.USDFC)      // USDFC in wallet
const paymentsBalance = await synapse.payments.balance(TOKENS.USDFC)        // USDFC in payments contract

// Deposit funds for storage operations
await synapse.payments.deposit(10n * 10n**18n, TOKENS.USDFC)

// Or manually approve service for creating payment rails
await synapse.payments.approveService(
  serviceAddress,
  ethers.parseUnits('10', 18),    // 10 USDFC per epoch rate allowance
  ethers.parseUnits('1000', 18)   // 1000 USDFC lockup allowance
)

// Create storage service and upload data
const storage = await synapse.createStorage()
const uploadTask = storage.upload(new TextEncoder().encode('Hello World'))
const commp = await uploadTask.commp()
await uploadTask.done()

// Download data
const data = await storage.download(commp)
console.log(new TextDecoder().decode(data)) // "Hello World"
```

### With MetaMask

```javascript
import { Synapse } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'

// Connect to MetaMask
const provider = new ethers.BrowserProvider(window.ethereum)
const synapse = await Synapse.create({ provider })

// Same API as above
const balance = await synapse.payments.walletBalance()
```

### Advanced Payment Control

For users who need fine-grained control over token approvals:

```javascript
import { Synapse, TOKENS, CONTRACT_ADDRESSES } from '@filoz/synapse-sdk'

const synapse = await Synapse.create({ provider })

// Check current allowance
const paymentsContract = CONTRACT_ADDRESSES.PAYMENTS[network]
const currentAllowance = await synapse.payments.allowance(TOKENS.USDFC, paymentsContract)

// Approve only if needed
if (currentAllowance < requiredAmount) {
  await synapse.payments.approve(TOKENS.USDFC, paymentsContract, requiredAmount)
}

// Now deposit (won't trigger approval since we already approved)
await synapse.payments.deposit(requiredAmount, TOKENS.USDFC)

// Service operator approvals (required before creating proof sets)
const serviceAddress = '0x394feCa6bCB84502d93c0c5C03c620ba8897e8f4' // Pandora

// Approve service to create payment rails on your behalf
await synapse.payments.approveService(
  serviceAddress,
  '10',   // 10 USDFC per epoch rate allowance
  '1000'  // 1000 USDFC lockup allowance
)

// Check service approval status
const serviceStatus = await synapse.payments.serviceApproval(serviceAddress)
console.log('Service approved:', serviceStatus.isApproved)
console.log('Rate allowance:', serviceStatus.rateAllowance)
console.log('Rate used:', serviceStatus.rateUsed)

// Revoke service if needed
await synapse.payments.revokeService(serviceAddress)
```

### API Reference

#### Constructor Options

```typescript
interface SynapseOptions {
  // Wallet Configuration (exactly one required)
  privateKey?: string           // Private key for signing
  provider?: ethers.Provider    // Browser provider (MetaMask, etc.)
  signer?: ethers.Signer        // External signer

  // Network Configuration
  rpcURL?: string              // RPC endpoint URL
  authorization?: string        // Authorization header (e.g., 'Bearer TOKEN')

  // Advanced Configuration
  disableNonceManager?: boolean // Disable automatic nonce management
  withCDN?: boolean             // Enable CDN for retrievals
  pandoraAddress?: string       // Override Pandora service contract address
}
```

#### Synapse Methods

- `payments` - Access payment-related functionality (see below)
- `createStorage(options?)` - Create a storage service instance

#### Synapse.payments Methods

**Balance Operations:**
- `walletBalance(token?)` - Get wallet balance (FIL or USDFC)
- `balance(token?)` - Get available balance in payments contract (accounting for lockups)
- `accountInfo(token?)` - Get detailed account info including funds, lockup details, and available balance
- `getCurrentEpoch()` - Get the current Filecoin epoch number
- `decimals(token?)` - Get token decimals (always 18)

**Token Operations:**
- `deposit(amount, token?)` - Deposit funds to payments contract (handles approval automatically)
- `withdraw(amount, token?)` - Withdraw funds from payments contract
- `approve(token, spender, amount)` - Approve token spending (for manual control)
- `allowance(token, spender)` - Check current token allowance

**Service Approvals:**
- `approveService(service, rateAllowance, lockupAllowance, token?)` - Approve a service contract as operator
- `revokeService(service, token?)` - Revoke service operator approval
- `serviceApproval(service, token?)` - Check service approval status and allowances

---

## Using Individual Components

All components can be imported and used independently for advanced use cases. The SDK is organized to match the external service structure:

### Payments Service

Direct interface to the Payments contract for token operations and operator approvals.

```javascript
import { PaymentsService } from '@filoz/synapse-sdk/payments'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider(rpcUrl)
const signer = await provider.getSigner()
const paymentsService = new PaymentsService(provider, paymentsAddress, signer)

// Deposit USDFC to payments contract
await paymentsService.deposit(tokenAddress, recipientAddress, amount)

// Check account info
const info = await paymentsService.accountInfo(tokenAddress, accountAddress)
console.log('Available funds:', info.availableFunds)

// Approve service as operator
await paymentsService.setOperatorApproval(
  tokenAddress,
  operatorAddress,
  true,                    // approved
  rateAllowance,          // per-epoch rate allowance
  lockupAllowance         // total lockup allowance
)
```

### Pandora Service

Interact with the Pandora contract for proof set management, storage provider operations, and storage cost calculations.

```javascript
import { PandoraService } from '@filoz/synapse-sdk/pandora'

const pandoraService = new PandoraService(provider, pandoraAddress)

// Storage cost calculations
const costs = await pandoraService.calculateStorageCost(sizeInBytes)
console.log(`Storage cost: ${costs.perMonth} per month`)

// Check allowances for storage
const check = await pandoraService.checkAllowanceForStorage(
  sizeInBytes,
  withCDN,
  paymentsService  // Pass PaymentsService instance
)

// Prepare storage upload
const prep = await pandoraService.prepareStorageUpload({
  dataSize: sizeInBytes,
  withCDN: false
}, paymentsService)

// Get client proof sets with enhanced details
const proofSets = await pandoraService.getClientProofSetsWithDetails(clientAddress)
for (const ps of proofSets) {
  console.log(`Rail ID: ${ps.railId}, PDP Verifier ID: ${ps.pdpVerifierProofSetId}`)
  console.log(`Is Live: ${ps.isLive}, Is Managed: ${ps.isManaged}`)
  console.log(`Next Root ID: ${ps.nextRootId}`)
}

// Get only proof sets managed by this Pandora instance
const managedSets = await pandoraService.getManagedProofSets(clientAddress)

// Verify proof set creation
const verification = await pandoraService.verifyProofSetCreation(txHash)
if (verification.proofSetLive) {
  console.log(`Proof set ${verification.proofSetId} is live!`)
}

// Storage provider operations
const isApproved = await pandoraService.isProviderApproved(providerAddress)
const providers = await pandoraService.getAllApprovedProviders()
```

### PDP Components

The PDP (Proof of Data Possession) system has three main components:

#### PDP Verifier

Low-level interface to the PDPVerifier contract for protocol operations.

```javascript
import { PDPVerifier } from '@filoz/synapse-sdk/pdp'

const pdpVerifier = new PDPVerifier(provider)

// Check if proof set is live
const isLive = await pdpVerifier.proofSetLive(proofSetId)

// Get proof set details
const nextRootId = await pdpVerifier.getNextRootId(proofSetId)
const listener = await pdpVerifier.getProofSetListener(proofSetId)
const leafCount = await pdpVerifier.getProofSetLeafCount(proofSetId)

// Extract proof set ID from transaction receipt
const proofSetId = await pdpVerifier.extractProofSetIdFromReceipt(receipt)
```

#### PDP Server

Consolidated interface for all PDP server (Curio) HTTP operations including proof sets, uploads, and downloads.

```javascript
import { PDPServer, PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

// Create server instance with auth helper
const authHelper = new PDPAuthHelper(pandoraAddress, signer)
const pdpServer = new PDPServer(authHelper, 'https://pdp.provider.com', 'https://pdp.provider.com')

// Create a proof set
const { txHash, statusUrl } = await pdpServer.createProofSet(
  storageProvider,     // string (address)
  clientDataSetId,     // number
  withCDN              // boolean (optional)
)

// Check creation status
const status = await pdpServer.getProofSetCreationStatus(txHash)
console.log(`Status: ${status.txStatus}, Proof Set ID: ${status.proofSetId}`)

// Add roots to proof set
await pdpServer.addRoots(
  proofSetId,         // number
  roots,              // Array of { cid: string | CommP, rawSize: number }
  currentRootId,      // number (starting root ID)
  clientDataSetId     // number
)

// Upload a piece
const { commP, size } = await pdpServer.uploadPiece(data, 'my-file.dat')

// Find existing piece
const piece = await pdpServer.findPiece(commP, size)
console.log(`Piece found: ${piece.uuid}`)

// Download a piece
const data = await pdpServer.downloadPiece(commP, size, retrievalUrl)

// Get comprehensive status (combines server and chain info)
const fullStatus = await pdpServer.getComprehensiveProofSetStatus(
  txHash,
  provider,
  pandoraAddress
)
```

#### PDP Auth Helper

Sign EIP-712 typed data for PDP operations. Compatible with MetaMask and other browser wallets.

```javascript
import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

// Create auth helper directly
const authHelper = new PDPAuthHelper(pandoraAddress, signer, chainId)

// Sign operations
const createProofSetSig = await authHelper.signCreateProofSet(
  clientDataSetId,    // number
  payeeAddress,       // string
  withCDN             // boolean
)

const addRootsSig = await authHelper.signAddRoots(
  clientDataSetId,    // number
  firstRootId,        // number
  rootDataArray       // Array of { cid: string | CommP, rawSize: number }
)

// All signatures return { signature, v, r, s, signedData }
```

### CommP Utilities

Calculate and validate Filecoin Piece Commitments without instantiating the full SDK.

```javascript
import { calculate, asCommP, createCommPStream } from '@filoz/synapse-sdk/commp'

// Calculate CommP from data
const data = new Uint8Array([1, 2, 3, 4])
const commp = calculate(data)
console.log(commp.toString()) // baga6ea4seaq...

// Validate and convert CommP strings and CIDs
const commp = asCommP('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq')
if (commp !== null) {
  console.log('Valid CommP:', commp.toString())
}

// Stream-based CommP calculation; compatible with Web Streams API
const { stream, getCommP } = createCommPStream()
// Pipe data through stream, then call getCommP() for result
```
---

## Network Configuration

### RPC Endpoints

```javascript
import { RPC_URLS } from '@filoz/synapse-sdk'

// Mainnet
RPC_URLS.mainnet.websocket  // wss://wss.node.glif.io/apigw/lotus/rpc/v1
RPC_URLS.mainnet.http       // https://api.node.glif.io/rpc/v1

// Calibration Testnet
RPC_URLS.calibration.websocket  // wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1
RPC_URLS.calibration.http       // https://api.calibration.node.glif.io/rpc/v1
```

### GLIF Authorization

For higher rate limits with GLIF endpoints:

```javascript
import { Synapse } from '@filoz/synapse-sdk'

// Using GLIF authorization with private key
const synapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: 'https://api.node.glif.io/rpc/v1',
  authorization: 'Bearer YOUR_GLIF_TOKEN'
})
```

### Network Details

**Filecoin Mainnet**
- Chain ID: 314
- USDFC Contract: `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`

**Filecoin Calibration Testnet**
- Chain ID: 314159
- USDFC Contract: `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`

---

## Browser Integration

The SDK works seamlessly in browsers.

### MetaMask Setup

Official documentation for configuring MetaMask with Filecoin (both Mainnet and the Calibration Test network) can be found at: https://docs.filecoin.io/basics/assets/metamask-setup

If you want to add the Filecoin network programmatically, you can use the following code snippet, for Mainnet (change accordingly for Calibration Testnet):

```javascript
// Add Filecoin network to MetaMask
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x13A',  // 314 for mainnet
    chainName: 'Filecoin',
    nativeCurrency: { name: 'FIL', symbol: 'FIL', decimals: 18 },
    rpcUrls: ['https://api.node.glif.io/rpc/v1'],
    blockExplorerUrls: ['https://filfox.info/en']
  }]
})
```

---

## Additional Information

### Type Definitions

The SDK is fully typed with TypeScript. Key types include:

- `CommP` - Filecoin Piece Commitment CID
- `TokenAmount` - `number | bigint` for token amounts
- `StorageOptions` - Options for storage service creation
- `AuthSignature` - Signature data for authenticated operations

### Error Handling

All SDK methods use descriptive error messages with proper error chaining:

```javascript
try {
  await synapse.payments.deposit(amount)
} catch (error) {
  console.error(error.message)  // Clear error description
  console.error(error.cause)     // Underlying error if any
}
```

## Contributing

Contributions are welcome! If using an AI tool, you are welcome to load AGENTS.md into your context to teach it about the structure and conventions of this SDK.

### Testing

Run the test suite:

```bash
npm test              # Run all tests and linting
npm run test:node     # Node.js tests only
npm run test:browser  # Browser tests only
```

## License

Apache-2.0
