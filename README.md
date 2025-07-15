# Synapse SDK

[![NPM](https://nodei.co/npm/@filoz/synapse-sdk.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/synapse-sdk/)

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
  * [Storage Service Creation](#storage-service-creation)
* [Using Individual Components](#using-individual-components)
  * [Payments Service](#payments-service)
  * [Pandora Service](#pandora-service)
  * [Subgraph Service](#subgraph-service)
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
  * [Commit Message Guidelines](#commit-message-guidelines)
  * [Testing](#testing)
* [Migration Guide](#migration-guide)
  * [Transaction Return Types](#transaction-return-types-v070)
* [License](#license)

---

## Recommended Usage

The `Synapse` class provides a complete, easy-to-use interface for interacting with Filecoin storage services.

### Quick Start

Get started with storage in just a few lines of code:

```javascript
import { Synapse, RPC_URLS } from '@filoz/synapse-sdk'

// Initialize SDK
const synapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.calibration.websocket  // Use calibration testnet for testing
})

// Create storage service
const storage = await synapse.createStorage()

// Upload data
const uploadResult = await storage.upload(
  new TextEncoder().encode('🚀 Welcome to decentralized storage on Filecoin! Your data is safe here. 🌍')
)
console.log(`Upload complete! CommP: ${uploadResult.commp}`)

// Download data from this provider
const data = await storage.providerDownload(uploadResult.commp)
console.log('Retrieved:', new TextDecoder().decode(data))

// Or download from any provider that has the piece
const dataFromAny = await synapse.download(uploadResult.commp)
```

#### Payment Setup

Before uploading data, you'll need to deposit funds and approve the storage service:

```javascript
import { TOKENS, CONTRACT_ADDRESSES } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'

// 1. Deposit USDFC tokens (one-time setup)
const amount = ethers.parseUnits('100', 18)  // 100 USDFC
await synapse.payments.deposit(amount, TOKENS.USDFC)

// 2. Approve the Pandora service for automated payments
const pandoraAddress = CONTRACT_ADDRESSES.PANDORA_SERVICE[synapse.getNetwork()]
await synapse.payments.approveService(
  pandoraAddress,
  ethers.parseUnits('10', 18),   // Rate allowance: 10 USDFC per epoch
  ethers.parseUnits('1000', 18)  // Lockup allowance: 1000 USDFC total
)

// Now you're ready to use storage!
```

### With MetaMask

```javascript
import { Synapse } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'

// Connect to MetaMask
const provider = new ethers.BrowserProvider(window.ethereum)
const synapse = await Synapse.create({ provider })

// Create storage and start using it immediately
const storage = await synapse.createStorage()
const data = new TextEncoder().encode('🚀🚀 Hello Filecoin! This is decentralized storage in action.')
const result = await storage.upload(data)
console.log(`Stored with CommP: ${result.commp}`)
```

### Advanced Payment Control

For users who need fine-grained control over token approvals:

```javascript
import { Synapse, TOKENS, CONTRACT_ADDRESSES } from '@filoz/synapse-sdk'

const synapse = await Synapse.create({ provider })

// Check current allowance
const paymentsContract = CONTRACT_ADDRESSES.PAYMENTS[synapse.getNetwork()]
const currentAllowance = await synapse.payments.allowance(TOKENS.USDFC, paymentsContract)

// Approve only if needed
if (currentAllowance < requiredAmount) {
  const approveTx = await synapse.payments.approve(TOKENS.USDFC, paymentsContract, requiredAmount)
  console.log(`Approval transaction: ${approveTx.hash}`)
  await approveTx.wait() // Wait for approval before depositing
}

// Now deposit with optional callbacks for visibility
const depositTx = await synapse.payments.deposit(requiredAmount, TOKENS.USDFC, {
  onAllowanceCheck: (current, required) => {
    console.log(`Current allowance: ${current}, Required: ${required}`)
  },
  onApprovalTransaction: (tx) => {
    console.log(`Auto-approval sent: ${tx.hash}`)
  },
  onDepositStarting: () => {
    console.log('Starting deposit transaction...')
  }
})
console.log(`Deposit transaction: ${depositTx.hash}`)
await depositTx.wait()

// Service operator approvals (required before creating proof sets)
// Get the Pandora service address for the current network
const pandoraAddress = CONTRACT_ADDRESSES.PANDORA_SERVICE[synapse.getNetwork()]

// Approve service to create payment rails on your behalf
const serviceApproveTx = await synapse.payments.approveService(
  pandoraAddress,
  // 10 USDFC per epoch rate allowance
  ethers.parseUnits('10', synapse.payments.decimals(TOKENS.USDFC)),
  // 1000 USDFC lockup allowance
  ethers.parseUnits('1000', synapse.payments.decimals(TOKENS.USDFC))
)
console.log(`Service approval transaction: ${serviceApproveTx.hash}`)
await serviceApproveTx.wait()

// Check service approval status
const serviceStatus = await synapse.payments.serviceApproval(pandoraAddress)
console.log('Service approved:', serviceStatus.isApproved)
console.log('Rate allowance:', serviceStatus.rateAllowance)
console.log('Rate used:', serviceStatus.rateUsed)

// Revoke service if needed
const revokeTx = await synapse.payments.revokeService(pandoraAddress)
console.log(`Revoke transaction: ${revokeTx.hash}`)
await revokeTx.wait()
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
  
  // Subgraph Integration (provide ONE of these options)
  subgraphService?: SubgraphRetrievalService // Custom implementation for provider discovery
  subgraphConfig?: SubgraphConfig // Configuration for the default SubgraphService
}

interface SubgraphConfig {
  endpoint?: string // Subgraph endpoint
  goldsky?: {
    projectId: string
    subgraphName: string
    version: string
  } // Used if endpoint is not provided
  apiKey?: string // Optional API key for authenticated subgraph access
}
```

#### Synapse Methods

- `payments` - Access payment-related functionality (see below)
- `createStorage(options?)` - Create a storage service instance (see Storage Service Creation)
- `getNetwork()` - Get the network this instance is connected to ('mainnet' or 'calibration')
- `download(commp, options?)` - Download a piece directly from any provider (see Download Options)
- `getProviderInfo(providerAddress)` - Get detailed information about a storage provider
- `getStorageInfo()` - Get comprehensive storage service information (pricing, providers, parameters)

#### Synapse.payments Methods

**Balance Operations:**
- `walletBalance(token?)` - Get wallet balance (FIL or USDFC)
- `balance()` - Get available USDFC balance in payments contract (accounting for lockups)
- `accountInfo()` - Get detailed USDFC account info including funds, lockup details, and available balance
- `getCurrentEpoch()` - Get the current Filecoin epoch number
- `decimals()` - Get token decimals (always returns 18)

*Note: Currently only USDFC token is supported for payments contract operations. FIL is also supported for `walletBalance()`.*

**Token Operations:**
- `deposit(amount, token?, callbacks?)` - Deposit funds to payments contract (handles approval automatically), returns `TransactionResponse`
- `withdraw(amount, token?)` - Withdraw funds from payments contract, returns `TransactionResponse`
- `approve(token, spender, amount)` - Approve token spending (for manual control), returns `TransactionResponse`
- `allowance(token, spender)` - Check current token allowance

**Service Approvals:**
- `approveService(service, rateAllowance, lockupAllowance, token?)` - Approve a service contract as operator, returns `TransactionResponse`
- `revokeService(service, token?)` - Revoke service operator approval, returns `TransactionResponse`
- `serviceApproval(service, token?)` - Check service approval status and allowances

### Storage Service Creation

The SDK automatically handles all the complexity of storage setup for you - selecting providers, managing proof sets, and coordinating with the blockchain. You just call `createStorage()` and the SDK takes care of everything.

Behind the scenes, the process may be:
- **Fast (<1 second)**: When reusing existing infrastructure
- **Slower (2-5 minutes)**: When setting up new blockchain infrastructure

#### Basic Usage

```javascript
// Simple creation with default provider selection
const storage = await synapse.createStorage()
```

#### Advanced Usage with Callbacks

Monitor the creation process with detailed callbacks:

```javascript
const storage = await synapse.createStorage({
  providerId: 1,    // Optional: use specific provider ID
  withCDN: true,    // Optional: enable CDN for faster downloads
  callbacks: {
    // Called when a provider is selected
    onProviderSelected: (provider) => {
      console.log(`Selected provider: ${provider.owner}`)
      console.log(`  PDP URL: ${provider.pdpUrl}`)
    },

    // Called when proof set is found or created
    onProofSetResolved: (info) => {
      if (info.isExisting) {
        console.log(`Using existing proof set: ${info.proofSetId}`)
      } else {
        console.log(`Created new proof set: ${info.proofSetId}`)
      }
    },

    // Only called when creating a new proof set
    onProofSetCreationStarted: (transaction, statusUrl) => {
      console.log(`Creation transaction: ${transaction.hash}`)
      if (statusUrl) {
        console.log(`Monitor status at: ${statusUrl}`)
      }
    },

    // Progress updates during proof set creation
    onProofSetCreationProgress: (status) => {
      const elapsed = Math.round(status.elapsedMs / 1000)
      console.log(`[${elapsed}s] Mining: ${status.transactionMined}, Live: ${status.proofSetLive}`)
    }
  }
})
```

#### Creation Options

```typescript
interface StorageServiceOptions {
  providerId?: number                      // Specific provider ID to use
  providerAddress?: string                 // Specific provider address to use
  proofSetId?: number                      // Specific proof set ID to use
  withCDN?: boolean                        // Enable CDN services
  callbacks?: StorageCreationCallbacks     // Progress callbacks
}

// Note: The withCDN option follows an inheritance pattern:
// 1. Synapse instance default (set during creation)
// 2. StorageService override (set during createStorage)
// 3. Per-method override (set during download)
```

#### Storage Service Properties

Once created, the storage service provides access to:

```javascript
// The proof set ID being used
console.log(`Proof set ID: ${storage.proofSetId}`)

// The storage provider address
console.log(`Storage provider: ${storage.storageProvider}`)
```

#### Storage Service Methods

##### Preflight Upload

Check if an upload is possible before attempting it:

```javascript
const preflight = await storage.preflightUpload(dataSize)
console.log('Estimated costs:', preflight.estimatedCost)
console.log('Allowance sufficient:', preflight.allowanceCheck.sufficient)
```

##### Upload and Download

Upload and download data with the storage service:

```javascript
// Upload with optional progress callbacks
const result = await storage.upload(data, {
  onUploadComplete: (commp) => {
    console.log(`Upload complete! CommP: ${commp}`)
  },
  onRootAdded: (transaction) => {
    // For new servers: transaction object with details
    // For old servers: undefined (backward compatible)
    if (transaction) {
      console.log(`Transaction confirmed: ${transaction.hash}`)
    } else {
      console.log('Data added to proof set (legacy server)')
    }
  },
  onRootConfirmed: (rootIds) => {
    // Only called for new servers with transaction tracking
    console.log(`Root IDs assigned: ${rootIds.join(', ')}`)
  }
})

// Download data from this specific provider
const downloaded = await storage.providerDownload(result.commp)

// Get the list of root CIDs in the current proof set by querying the provider
const rootCids = await storage.getProofSetRoots()
console.log(`Root CIDs: ${rootCids.map(cid => cid.toString()).join(', ')}`)

// Check the status of a piece on the storage provider
const status = await storage.pieceStatus(result.commp)
console.log(`Piece exists: ${status.exists}`)
console.log(`Proof set last proven: ${status.proofSetLastProven}`)
console.log(`Proof set next proof due: ${status.proofSetNextProofDue}`)
```

**Storage Service Methods:**
- `upload(data, callbacks?)` - Upload data to the storage provider
- `providerDownload(commp, options?)` - Download data from this specific provider
- `preflightUpload(dataSize)` - Check if an upload is possible before attempting it
- `getProviderInfo()` - Get detailed information about the selected storage provider
- `getProofSetRoots()` - Get the list of root CIDs in the proof set by querying the provider
- `pieceStatus(commp)` - Get the status of a piece including proof set timing information

##### Size Constraints

The storage service enforces the following size limits for uploads:
- **Minimum**: 65 bytes
- **Maximum**: 200 MiB (209,715,200 bytes)

Attempting to upload data outside these limits will result in an error.

### Storage Information

Get comprehensive information about the storage service:

```javascript
// Get storage service info including pricing and providers
const info = await synapse.getStorageInfo()
console.log('Price per TiB/month:', info.pricing.noCDN.perTiBPerMonth)
console.log('Available providers:', info.providers.length)
console.log('Network:', info.serviceParameters.network)

// Get details about a specific provider
const providerInfo = await synapse.getProviderInfo('0x...')
console.log('Provider PDP URL:', providerInfo.pdpUrl)
```

### Download Options

The SDK provides flexible download options through both the main Synapse instance and StorageService:

#### Direct Download via Synapse

Download pieces from any available provider:

```javascript
// Download from any provider that has the piece
const data = await synapse.download(commp)

// Download with CDN optimization (if available)
const dataWithCDN = await synapse.download(commp, { withCDN: true })

// Download from a specific provider
const dataFromProvider = await synapse.download(commp, {
  providerAddress: '0x...'
})
```

#### Provider-Specific Download via StorageService

When using a StorageService instance, downloads are automatically restricted to that specific provider:

```javascript
// Downloads from the provider associated with this storage instance
const data = await storage.providerDownload(commp)

// The storage instance passes its withCDN setting to the download
const storage = await synapse.createStorage({ withCDN: true })
const dataWithCDN = await storage.providerDownload(commp) // Uses CDN if available
```

#### CDN Inheritance Pattern

The `withCDN` option follows a clear inheritance hierarchy:

1. **Synapse level**: Default setting for all operations
2. **StorageService level**: Can override Synapse's default
3. **Method level**: Can override instance settings

```javascript
// Example of inheritance
const synapse = await Synapse.create({ withCDN: true })          // Default: CDN enabled
const storage = await synapse.createStorage({ withCDN: false })  // Override: CDN disabled
await synapse.download(commp)                                    // Uses Synapse's withCDN: true
await storage.providerDownload(commp)                            // Uses StorageService's withCDN: false
await synapse.download(commp, { withCDN: false })                // Method override: CDN disabled
```

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
const paymentsService = new PaymentsService(provider, signer, 'calibration', false)

// Deposit USDFC to payments contract
const depositTx = await paymentsService.deposit(amount) // amount in base units
console.log(`Deposit transaction: ${depositTx.hash}`)
await depositTx.wait() // Wait for confirmation

// Check account info
const info = await paymentsService.accountInfo() // Uses USDFC by default
console.log('Available funds:', info.availableFunds)

// Approve service as operator
const approveTx = await paymentsService.approveService(
  serviceAddress,         // e.g., Pandora contract address
  rateAllowance,         // per-epoch rate allowance in base units
  lockupAllowance        // total lockup allowance in base units
)
console.log(`Service approval transaction: ${approveTx.hash}`)
await approveTx.wait() // Wait for confirmation
```

### Pandora Service

Interact with the Pandora contract for proof set management, storage provider operations, and storage cost calculations.

```javascript
import { PandoraService } from '@filoz/synapse-sdk/pandora'

const pandoraService = new PandoraService(provider, pandoraAddress)

// Storage cost calculations
const costs = await pandoraService.calculateStorageCost(sizeInBytes)
console.log(`Storage cost: ${costs.perMonth} per month`)

// Check allowances for storage (returns allowance details and costs)
const check = await pandoraService.checkAllowanceForStorage(
  sizeInBytes,
  withCDN,
  paymentsService  // Pass PaymentsService instance
)
// check.sufficient - boolean indicating if allowances are sufficient
// check.costs - storage costs per epoch/day/month

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

### Subgraph Service

The SubgraphService provides access to Synapse-compatible subgraphs for provider discovery, proof set tracking, and more.

```javascript
// Create subgraph service
const subgraphService = new SubgraphService({
  goldsky: {
    projectId: 'PROJECT_ID',
    subgraphName: 'SUBGRAPH_NAME',
    version: 'latest'
  }
})

// Direct endpoint configuration
const subgraphService2 = new SubgraphService({
  endpoint: 'https://api.goldsky.com/api/public/project_id/subgraph_name'
})

// Example: Query for active providers with custom filtering
const activeProviders = await subgraphService.queryProviders({
  where: {
    status: 'Approved'
  },
  orderBy: 'totalProofSets',
  orderDirection: 'desc',
  first: 5
})

// Example: Find providers for a specific CommP
const providers = await subgraphService.getApprovedProvidersForCommP(commp)
```

#### Custom Subgraph Service Implementations

The SDK supports custom implementations of the `SubgraphRetrievalService` interface, allowing you to provide alternative data sources for provider discovery. This is useful for testing, custom integrations, or cases where you need specialized provider selection logic.

```javascript
// Example: Implementing a custom SubgraphRetrievalService
class CustomProviderService implements SubgraphRetrievalService {
  async getApprovedProvidersForCommP(commp) {
    // Your custom implementation here
    // Could use a different data source, filtering logic, etc.
    return [{
      owner: '0x123...',
      pdpUrl: 'https://example.com/pdp',
      pieceRetrievalUrl: 'https://example.com/retrieval',
      registeredAt: Date.now(),
      approvedAt: Date.now()
    }]
  }
  
  async getProviderByAddress(address) {
    // Your custom implementation
    // ...
  }
}

// Using the custom service with Synapse
const synapse = await Synapse.create({
  provider,
  subgraphService: new CustomProviderService()
})
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
const authHelper = new PDPAuthHelper(pandoraAddress, signer, chainId)
const pdpServer = new PDPServer(authHelper, 'https://pdp.provider.com', 'https://pdp.provider.com')

// Create a proof set
const { txHash, statusUrl } = await pdpServer.createProofSet(
  clientDataSetId,     // number
  payee,               // string (storage provider address)
  withCDN,             // boolean
  recordKeeper         // string (Pandora contract address)
)

// Check creation status
const status = await pdpServer.getProofSetCreationStatus(txHash)
console.log(`Status: ${status.txStatus}, Proof Set ID: ${status.proofSetId}`)

// Add roots to proof set (returns transaction tracking info)
const addResult = await pdpServer.addRoots(
  proofSetId,         // number (PDPVerifier proof set ID)
  clientDataSetId,    // number
  nextRootId,         // number (must match chain state)
  rootDataArray       // Array of { cid: string | CommP, rawSize: number }
)
// addResult: { message: string, txHash?: string, statusUrl?: string }

// Check root addition status (for new servers with transaction tracking)
if (addResult.txHash) {
  const status = await pdpServer.getRootAdditionStatus(proofSetId, addResult.txHash)
  console.log(`Status: ${status.txStatus}, Root IDs: ${status.confirmedRootIds}`)
}

// Upload a piece
const { commP, size } = await pdpServer.uploadPiece(data, 'my-file.dat')

// Find existing piece
const piece = await pdpServer.findPiece(commP, size)
console.log(`Piece found: ${piece.uuid}`)

// Download a piece
const data = await pdpServer.downloadPiece(commP)

// Get proof set details
const proofSet = await pdpServer.getProofSet(proofSetId)
console.log(`Proof set ${proofSet.id} has ${proofSet.roots.length} roots`)
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

### Commit Message Guidelines

This repository uses **auto-publishing** with semantic versioning based on commit messages. All commits must follow the [Conventional Commits](https://www.conventionalcommits.org/) specification.

#### Commit Message Format

```
<type>(optional scope): <description>

[optional body]

[optional footer(s)]
```

#### Supported Types and Version Bumps

- **patch** (0.x.Y): `chore:`, `fix:`, `test:`, `docs:`
- **minor** (0.X.y): `feat:`
- **major** (X.y.z): Any type with `!` suffix or `BREAKING CHANGE` in footer

The `(optional scope)` is used to provide additional clarity about the target of the changes if isolated to a specific subsystem. e.g. `payments`, `storage`, `pandora`, `ci`, etc.

#### Examples

```bash
# Patch releases (0.x.Y)
git commit -m "fix(payments): resolve approval race condition"
git commit -m "docs: update storage service examples"
git commit -m "test: add unit tests for CommP calculation"
git commit -m "chore: update dependencies"

# Minor releases (0.X.y)
git commit -m "feat: add CDN support for downloads"
git commit -m "feat(storage): implement batch upload operations"

# Major releases (X.y.z) - AVOID UNTIL M1
git commit -m "feat!: remove deprecated payment methods"
git commit -m "fix: update API signature

BREAKING CHANGE: The createStorage method now requires explicit provider selection"
```

#### Important Notes

- **Stay in 0.x.x range**: Avoid breaking changes (`!` or `BREAKING CHANGE`) until M1 milestone
- **Auto-publishing**: Every merge to main triggers automatic npm publishing based on commit messages
- **Changelog generation**: Commit messages are used to generate release notes
- **Standard JS**: We follow [Standard JS](https://standardjs.com/) code style

### Testing

Run the test suite:

```bash
npm test              # Run all tests and linting
npm run test:node     # Node.js tests only
npm run test:browser  # Browser tests only
```

## Migration Guide

### Transaction Return Types (v0.7.0+)

Starting with version 0.7.0, payment methods now return `ethers.TransactionResponse` objects instead of transaction hashes. This provides more control and aligns with standard ethers.js patterns.

**Before (v0.6.x and earlier):**
```javascript
// Methods returned transaction hash strings
const txHash = await synapse.payments.approve(token, spender, amount)
console.log(`Transaction: ${txHash}`)
// Transaction was already confirmed
```

**After (v0.7.0+):**
```javascript
// Methods return TransactionResponse objects
const tx = await synapse.payments.approve(token, spender, amount)
console.log(`Transaction: ${tx.hash}`)
// Optional: wait for confirmation when you need it
const receipt = await tx.wait()
console.log(`Confirmed in block ${receipt.blockNumber}`)
```

**Affected methods:**
- `approve()` - Returns `TransactionResponse`
- `approveService()` - Returns `TransactionResponse`
- `revokeService()` - Returns `TransactionResponse`
- `withdraw()` - Returns `TransactionResponse`
- `deposit()` - Returns `TransactionResponse`, plus new callbacks for multi-step visibility

**Deposit callbacks (new):**
```javascript
const tx = await synapse.payments.deposit(amount, TOKENS.USDFC, {
  onAllowanceCheck: (current, required) => {
    console.log(`Checking allowance: ${current} vs ${required}`)
  },
  onApprovalTransaction: (approveTx) => {
    console.log(`Auto-approval sent: ${approveTx.hash}`)
  },
  onApprovalConfirmed: (receipt) => {
    console.log(`Approval confirmed in block ${receipt.blockNumber}`)
  },
  onDepositStarting: () => {
    console.log('Starting deposit transaction...')
  }
})
```

## License

Apache-2.0
