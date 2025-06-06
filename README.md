# Synapse SDK

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

## Overview

The Synapse SDK is designed with flexibility in mind:

- **🚀 Simple Golden Path**: Use the high-level `Synapse` class for a streamlined experience with sensible defaults
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
* [Using the Golden Path API](#using-the-golden-path-api)
  * [Quick Start](#quick-start)
  * [With MetaMask](#with-metamask)
  * [API Reference](#api-reference)
* [Using Individual Components](#using-individual-components)
  * [CommP Utilities](#commp-utilities)
  * [PDP Auth Helper](#pdp-auth-helper)
  * [PDP Tool](#pdp-tool)
  * [PDP Service](#pdp-service)
  * [PDP Upload Service](#pdp-upload-service)
  * [PDP Download Service](#pdp-download-service)
  * [Storage Service (Mock)](#storage-service-mock)
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

## Using the Golden Path API

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
const filBalance = await synapse.payments.walletBalance()                    // FIL in wallet
const usdcBalance = await synapse.payments.walletBalance(TOKENS.USDFC)      // USDFC in wallet
const paymentsBalance = await synapse.payments.balance(TOKENS.USDFC)        // USDFC in payments contract

// Deposit funds for storage operations
await synapse.payments.deposit(10n * 10n**18n, TOKENS.USDFC)

// Check storage costs before uploading
const sizeInGB = 10
const sizeInBytes = sizeInGB * 1024 * 1024 * 1024
const costs = await synapse.payments.calculateStorageCost(sizeInBytes)
console.log(`Storage cost: ${costs.perMonth} per month`)

// Prepare for storage (checks balance and allowances)
const prep = await synapse.payments.prepareStorageUpload({
  dataSize: sizeInBytes,
  withCDN: false
})

// Execute any required actions
for (const action of prep.actions) {
  console.log(`Required: ${action.description}`)
  await action.execute()
}

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
- `getPDPAuthHelper()` - Get auth helper for signing PDP operations

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

**Storage Cost Analysis:**
- `calculateStorageCost(sizeInBytes)` - Calculate storage costs (with CDN and non-CDN pricing)
- `checkAllowanceForStorage(sizeInBytes, withCDN?)` - Check if allowances are sufficient for storage
- `prepareStorageUpload(options)` - Pre-flight check that returns required actions before storage upload

---

## Using Individual Components

All components can be imported and used independently for advanced use cases.

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

### PDP Auth Helper

Sign EIP-712 typed data for PDP operations. Compatible with MetaMask and other browser wallets.

```javascript
import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

// Create auth helper directly
const authHelper = new PDPAuthHelper(contractAddress, signer, chainId)

// Or get from Synapse instance (uses network's default contract)
const synapse = await Synapse.create({ privateKey, rpcURL })
const authHelper = synapse.getPDPAuthHelper()

// Sign operations
const createProofSetSig = await authHelper.signCreateProofSet(
  clientDataSetId,    // number
  payeeAddress,       // string
  withCDN            // boolean
)

const addRootsSig = await authHelper.signAddRoots(
  clientDataSetId,    // number
  firstRootId,        // number
  rootDataArray       // Array of { cid: string | CommP, rawSize: number }
)

const scheduleRemovalsSig = await authHelper.signScheduleRemovals(
  clientDataSetId,    // number
  rootIds             // Array of numbers
)

const deleteProofSetSig = await authHelper.signDeleteProofSet(
  clientDataSetId     // number
)

// All signatures return { signature, v, r, s, signedData }
```

### PDP Tool

High-level interface for interacting with PDP servers for proof set operations.

```javascript
import { PDPTool } from '@filoz/synapse-sdk/pdp'

// Create PDPTool instance
const pdpTool = new PDPTool('https://pdp.example.com', authHelper)

// Create a new proof set
const { txHash, statusUrl } = await pdpTool.createProofSet(
  clientDataSetId,      // number
  payeeAddress,         // string
  withCDN,             // boolean
  recordKeeperAddress  // string (Pandora contract)
)

// Check proof set creation status
const status = await pdpTool.getProofSetCreationStatus(txHash)
console.log('Proof set created:', status.proofsetCreated)
console.log('Proof set ID:', status.proofSetId)

// Add roots to proof set
const rootData = [
  {
    cid: 'baga6ea4seaq...',  // CommP CID (string or CommP object)
    rawSize: 1024 * 1024    // Raw size in bytes
  }
]
const result = await pdpTool.addRoots(
  proofSetId,          // number
  clientDataSetId,     // number
  nextRootId,          // number - ID for the first root being added
  rootData             // Array of RootData
)
console.log(result.message) // Server response message
```

#### PDPTool API

- **Constructor**: `new PDPTool(apiEndpoint, pdpAuthHelper)`
  - `apiEndpoint`: Base URL of the PDP API
  - `pdpAuthHelper`: PDPAuthHelper instance for signing operations
- **Methods**:
  - `createProofSet(clientDataSetId, payee, withCDN, recordKeeper)`: Create a new proof set
  - `getProofSetCreationStatus(txHash)`: Check creation status by transaction hash
  - `getComprehensiveProofSetStatus(txHash, pandoraAddress, provider)`: Get comprehensive status combining PDP server and chain verification
  - `waitForProofSetCreationWithStatus(txHash, pandoraAddress, provider, onStatusUpdate?, timeoutMs?, pollIntervalMs?)`: Wait for proof set creation with status updates
  - `addRoots(proofSetId, clientDataSetId, nextRootId, rootData[])`: Add roots to proof set
  - `findPiece(commP, size)`: Check if a piece exists on the PDP server
  - `getApiEndpoint()`: Get the API endpoint
  - `getPDPAuthHelper()`: Get the PDPAuthHelper instance

### PDP Service

Query and manage proof sets without payment operations. Useful for discovering proof sets, checking their status, and getting information needed for adding roots.

```javascript
import { PDPService } from '@filoz/synapse-sdk/pdp'
import { ethers } from 'ethers'

// Create PDP Service instance
const provider = new ethers.JsonRpcProvider(RPC_URLS.calibration.http)
const pdpService = new PDPService(provider, pandoraAddress)

// Get all proof sets for a client
const proofSets = await pdpService.getClientProofSets(clientAddress)
console.log(`Client has ${proofSets.length} proof sets`)

// Get enhanced proof set details with management status
const detailedProofSets = await pdpService.getClientProofSetsWithDetails(clientAddress)
for (const ps of detailedProofSets) {
  console.log(`Proof Set ID: ${ps.pdpVerifierProofSetId}`)
  console.log(`  Rail ID: ${ps.railId}`)
  console.log(`  Is Managed by this Pandora: ${ps.isManaged}`)
  console.log(`  Is Live: ${ps.isLive}`)
  console.log(`  Current Roots: ${ps.currentRootCount}`)
  console.log(`  Next Root ID: ${ps.nextRootId}`)
}

// Get only proof sets managed by the current Pandora contract
const managedProofSets = await pdpService.getManagedProofSets(clientAddress)
console.log(`Found ${managedProofSets.length} managed proof sets`)

// Get information needed to add roots to a proof set
const addRootsInfo = await pdpService.getAddRootsInfo(railId)
console.log(`Next Root ID: ${addRootsInfo.nextRootId}`)
console.log(`Client Dataset ID: ${addRootsInfo.clientDataSetId}`)

// Get next client dataset ID for creating new proof sets
const nextDatasetId = await pdpService.getNextClientDataSetId(clientAddress)
console.log(`Next dataset ID will be: ${nextDatasetId}`)

// Find recent proof set creations
const recentCreations = await pdpService.findRecentProofSetCreations(clientAddress)
for (const creation of recentCreations) {
  console.log(`Proof Set ${creation.proofSetId} created in tx ${creation.txHash}`)
}

// Verify and wait for proof set creation
const verification = await pdpService.verifyProofSetCreation(txHash)
if (verification.proofSetLive) {
  console.log(`Proof set ${verification.proofSetId} is live!`)
}

// Wait for proof set to be created and live on-chain
const result = await pdpService.waitForProofSetCreation(txHash)
console.log(`Proof set ${result.proofSetId} is now live`)
```

#### PDPService API

- **Constructor**: `new PDPService(provider, pandoraAddress)`
  - `provider`: Ethers provider instance
  - `pandoraAddress`: Address of the Pandora service contract
- **Methods**:
  - `getClientProofSets(clientAddress)`: Get all proof sets for a client
  - `getClientProofSetsWithDetails(clientAddress, onlyManaged?)`: Get proof sets with enhanced details and management status
  - `getManagedProofSets(clientAddress)`: Get only proof sets managed by this Pandora contract
  - `getAddRootsInfo(railId)`: Get information needed to add roots (next root ID, client dataset ID)
  - `getNextClientDataSetId(clientAddress)`: Get the next dataset ID that will be assigned
  - `findRecentProofSetCreations(clientAddress, fromBlock?)`: Find recent proof set creation events
  - `verifyProofSetCreation(txHash)`: Verify a proof set creation transaction
  - `waitForProofSetCreation(txHash, timeoutMs?, pollIntervalMs?)`: Wait for proof set to be created and live
  - `getPandoraAddress()`: Get the Pandora contract address

### PDP Upload Service

Upload data directly to a PDP (Proof of Data Possession) server.

```javascript
import { PDPUploadService } from '@filoz/synapse-sdk/pdp'
import { calculate } from '@filoz/synapse-sdk/commp'

// Create upload service
const uploadService = new PDPUploadService('https://pdp.example.com')

// Upload data
const data = new Uint8Array([1, 2, 3, 4, 5])
const commp = calculate(data)
await uploadService.upload(data, commp)
```

#### PDPUploadService API

- **Constructor**: `new PDPUploadService(apiEndpoint, serviceName?)`
  - `apiEndpoint`: Base URL of the PDP API
  - `serviceName`: Optional service name (defaults to 'public')
- **Methods**:
  - `upload(data, commp)`: Upload data with its CommP
  - `getApiEndpoint()`: Get the API endpoint
  - `getServiceName()`: Get the service name

### PDP Download Service

Download and verify data from storage providers.

```javascript
import { PDPDownloadService } from '@filoz/synapse-sdk/pdp'

// Create download service
const downloadService = new PDPDownloadService('https://sp.example.com/retrieve')

// Download and verify data
const commp = 'baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq'
const data = await downloadService.downloadPiece(commp)
// Data is automatically verified against CommP
```

#### PDPDownloadService API

- **Constructor**: `new PDPDownloadService(retrievalUrl)`
  - `retrievalUrl`: Base URL for the storage provider's retrieval endpoint
- **Methods**:
  - `downloadPiece(commp)`: Download and verify a piece by CommP
  - `getRetrievalUrl()`: Get the retrieval URL

### Storage Service (Mock)

The storage service interface for future implementations.

```javascript
import { MockStorageService } from '@filoz/synapse-sdk'

// Create storage service directly (usually created via Synapse.createStorage())
const storage = new MockStorageService('proofSetId', 'f01234')

// Upload data
const uploadTask = storage.upload(data)
const commp = await uploadTask.commp()
await uploadTask.done()

// Download data
const retrieved = await storage.download(commp)

// Other operations
await storage.delete(commp)
await storage.settlePayments()
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
