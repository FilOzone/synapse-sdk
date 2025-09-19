# Synapse SDK

[![NPM](https://nodei.co/npm/@filoz/synapse-sdk.svg?style=flat&data=n,v&color=blue)](https://nodei.co/npm/@filoz/synapse-sdk/)

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

> ⚠️ **BREAKING CHANGES in v0.24.0**: Major updates have been introduced:
> - **Terminology**: **Pandora** is now **Warm Storage**, **Proof Sets** are now **Data Sets**, **Roots** are now **Pieces** and **Storage Providers** are now **Service Providers**
> - **Storage API**: Improved with a new context-based architecture
> - **PaymentsService**: Method signatures updated for consistency - `token` parameter is now always last and defaults to USDFC
>
> See the [Migration Guide](#migration-guide) for detailed migration instructions.

## Overview

The Synapse SDK provides an interface to Filecoin's decentralized services ecosystem:

- **🚀 Recommended Usage**: Use the high-level `Synapse` class for a streamlined experience with sensible defaults
- **🔧 Composable Components**: Import and use individual components for fine-grained control over specific functionality

The SDK handles all the complexity of blockchain interactions, provider selection, and data management, so you can focus on building your application.

### Key Concepts

- **Service Contracts**: Smart contracts that manage specific services (like storage). Currently, **Warm Storage** is the primary service contract that handles storage operations and payment validation.
- **Payment Rails**: Automated payment streams between clients and service providers, managed by the Payments contract. When you create a data set in Warm Storage, it automatically creates corresponding payment rails.
- **Data Sets**: Collections of stored data managed by Warm Storage. Each data set has an associated payment rail that handles the ongoing storage payments.
- **Pieces**: Individual units of data identified by PieceCID (content-addressed identifiers). Multiple pieces can be added to a data set for storage.
- **PDP (Proof of Data Possession)**: The cryptographic protocol that verifies storage providers are actually storing the data they claim to store. Providers must periodically prove they possess the data.
- **Validators**: Service contracts (like Warm Storage) act as validators for payment settlements, ensuring services are delivered before payments are released.

## Installation

```bash
npm install @filoz/synapse-sdk ethers
```

Note: `ethers` v6 is a peer dependency and must be installed separately.

## Table of Contents

* [Recommended Usage](#recommended-usage)
  * [Quick Start](#quick-start)
  * [With MetaMask](#with-metamask)
  * [Advanced Payment Control](#advanced-payment-control)
  * [API Reference](#api-reference)
  * [Storage Context Creation](#storage-context-creation)
  * [Storage Information](#storage-information)
  * [Download Options](#download-options)
* [PieceCID](#piececid)
* [Using Individual Components](#using-individual-components)
  * [Payments Service](#payments-service)
  * [Service Provider Registry](#service-provider-registry)
  * [Warm Storage Service](#warm-storage-service)
  * [Subgraph Service](#subgraph-service)
  * [PDP Components](#pdp-components)
  * [PieceCID Utilities](#piececid-utilities)
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
  * [Git hooks](#git-hooks)
  * [Testing](#testing)
  * [Generating ABIs](#generating-abis)
* [Migration Guide](#migration-guide)
  * [Terminology Update (v0.24.0+)](#terminology-update-v0240)
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

// Upload data, this auto-selects provider and creates a data set if needed
// (your first upload will take longer than subsequent uploads due to set up)
const uploadResult = await synapse.storage.upload(
  new TextEncoder().encode('🚀 Welcome to decentralized storage on Filecoin! Your data is safe here. 🌍')
)
console.log(`Upload complete! PieceCID: ${uploadResult.pieceCid}`)

// Download data
const data = await synapse.storage.download(uploadResult.pieceCid)
console.log('Retrieved:', new TextDecoder().decode(data))
```

#### Connection Management

When using WebSocket connections (recommended for better performance), it's important to properly clean up when your application is done:

```javascript
// When you're done with the SDK, close the connection
const provider = synapse.getProvider()
if (provider && typeof provider.destroy === 'function') {
  await provider.destroy()
}
```

#### Payment Setup

Before uploading data, you'll need to deposit funds and approve the storage service:

```javascript
import { TOKENS, CONTRACT_ADDRESSES } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'

// 1. Deposit USDFC tokens (one-time setup)
const amount = ethers.parseUnits('100', 18)  // 100 USDFC
await synapse.payments.deposit(amount)

// 2. Approve the Warm Storage service contract for automated payments
// Warm Storage acts as both the storage coordinator and payment validator
// The SDK automatically uses the correct service address for your network
const warmStorageAddress = await synapse.getWarmStorageAddress()
await synapse.payments.approveService(
  warmStorageAddress,
  ethers.parseUnits('10', 18),   // Rate allowance: 10 USDFC per epoch
  ethers.parseUnits('1000', 18), // Lockup allowance: 1000 USDFC total
  86400n                         // Max lockup period: 30 days (in epochs)
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

// Start uploading immediately
const data = new TextEncoder().encode('🚀🚀 Hello Filecoin! This is decentralized storage in action.')
const result = await synapse.storage.upload(data)
console.log(`Stored with PieceCID: ${result.pieceCid}`)
```

### Advanced Payment Control

For users who need fine-grained control over token approvals:

```javascript
import { Synapse, TOKENS } from '@filoz/synapse-sdk'

const synapse = await Synapse.create({ provider })

// Check current allowance
const paymentsAddress = await synapse.getPaymentsAddress()
const currentAllowance = await synapse.payments.allowance(paymentsAddress)

// Approve only if needed
if (currentAllowance < requiredAmount) {
  const approveTx = await synapse.payments.approve(paymentsAddress, requiredAmount)
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

// Service operator approvals (required before creating data sets)
const warmStorageAddress = await synapse.getWarmStorageAddress()

// Approve service to create payment rails on your behalf
const serviceApproveTx = await synapse.payments.approveService(
  warmStorageAddress,
  // 10 USDFC per epoch rate allowance
  ethers.parseUnits('10', synapse.payments.decimals(TOKENS.USDFC)),
  // 1000 USDFC lockup allowance
  ethers.parseUnits('1000', synapse.payments.decimals(TOKENS.USDFC)),
  // 30 days max lockup period (in epochs)
  86400n
)
console.log(`Service approval transaction: ${serviceApproveTx.hash}`)
await serviceApproveTx.wait()

// Check service approval status
const serviceStatus = await synapse.payments.serviceApproval(warmStorageAddress)
console.log('Service approved:', serviceStatus.isApproved)
console.log('Rate allowance:', serviceStatus.rateAllowance)
console.log('Rate used:', serviceStatus.rateUsed)
console.log('Max lockup period:', serviceStatus.maxLockupPeriod)

// Revoke service if needed
const revokeTx = await synapse.payments.revokeService(warmStorageAddress)
console.log(`Revoke transaction: ${revokeTx.hash}`)
await revokeTx.wait()
```

### API Reference

#### Constructor Options

```typescript
interface SynapseOptions {
  // Wallet Configuration (exactly one required)
  privateKey?: string             // Private key for signing
  provider?: ethers.Provider      // Browser provider (MetaMask, etc.)
  signer?: ethers.Signer          // External signer

  // Network Configuration
  rpcURL?: string                 // RPC endpoint URL
  authorization?: string          // Authorization header (e.g., 'Bearer TOKEN')

  // Advanced Configuration
  withCDN?: boolean                 // Enable CDN for retrievals (set a default for all new storage operations)
  metadata?: Record<string, string> // Optional metadata for data sets (key-value pairs)
  pieceRetriever?: PieceRetriever   // Optional override for a custom retrieval stack
  disableNonceManager?: boolean     // Disable automatic nonce management
  warmStorageAddress?: string       // Override Warm Storage service contract address (all other addresses are discovered from this contract)

  // Subgraph Integration (optional, provide only one of these options)
  subgraphService?: SubgraphRetrievalService // Custom implementation for provider discovery
  subgraphConfig?: SubgraphConfig            // Configuration for the default SubgraphService
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

**Instance Properties:**
- `payments` - PaymentsService instance for token operations (see [Payment Methods](#synapepayments-methods) below)
- `storage` - StorageManager instance for all storage operations (see [Storage Operations](#synapsestorage-methods) below)

**Core Operations:**
- `preflightUpload(dataSize options?)` - Check if an upload is possible before attempting it, returns preflight info with cost estimates and allowance check (with or without CDN)
- `getProviderInfo(providerAddress)` - Get detailed information about a service provider
- `getNetwork()` - Get the network this instance is connected to ('mainnet' or 'calibration')
- `getChainId()` - Get the numeric chain ID (314 for mainnet, 314159 for calibration)

#### Synapse.storage Methods

**Context Management:**
- `createContext(options?)` - Create a storage context for a specific provider + data set (returns `StorageContext`)
- `upload(data, options?)` - Upload data using auto-managed context or route to specific context
- `download(pieceCid, options?)` - Download from any available provider (SP-agnostic)

**Upload Options:**
```typescript
// Simple upload (auto-creates/reuses context)
await synapse.storage.upload(data)

// Upload with specific provider
await synapse.storage.upload(data, { providerAddress: '0x...' })

// Upload with specific context (current or future multi-context)
await synapse.storage.upload(data, { context: storageContext })
```

**Download Options:**
```typescript
// Download from any available provider
await synapse.storage.download(pieceCid)

// Prefer specific provider (still falls back if unavailable)
await synapse.storage.download(pieceCid, { providerAddress: '0x...' })

// Download through specific context
await synapse.storage.download(pieceCid, { context: storageContext })
```

#### Synapse.payments Methods

**Balance Operations:**
- `walletBalance(token?)` - Get wallet balance (FIL or USDFC)
- `balance()` - Get available USDFC balance in payments contract (accounting for lockups)
- `accountInfo()` - Get detailed USDFC account info including funds, lockup details, and available balance
- `decimals()` - Get token decimals (always returns 18)

*Note: Currently only USDFC token is supported for payments contract operations. FIL is also supported for `walletBalance()`.*

**Token Operations:**
- `deposit(amount, token?, callbacks?)` - Deposit funds to payments contract (handles approval automatically), returns `TransactionResponse`
- `withdraw(amount, token?)` - Withdraw funds from payments contract, returns `TransactionResponse`
- `approve(spender, amount, token?)` - Approve token spending (for manual control), returns `TransactionResponse`
- `allowance(spender, token?)` - Check current token allowance

**Service Approvals:**
- `approveService(service, rateAllowance, lockupAllowance, maxLockupPeriod, token?)` - Approve a service contract as operator, returns `TransactionResponse`
- `revokeService(service, token?)` - Revoke service operator approval, returns `TransactionResponse`
- `serviceApproval(service, token?)` - Check service approval status and allowances

**Rail Settlement:**
- `getRailsAsPayer(token?)` - Get all payment rails where wallet is the payer, returns `RailInfo[]` with `{railId, isTerminated, endEpoch}` (endEpoch is 0 for active rails)
- `getRailsAsPayee(token?)` - Get all payment rails where wallet is the payee (recipient), returns `RailInfo[]`
- `getRail(railId)` - Get detailed rail information, returns `{token, from, to, operator, validator, paymentRate, lockupPeriod, lockupFixed, settledUpTo, endEpoch, commissionRateBps, serviceFeeRecipient}`. Throws if rail doesn't exist.
- `settle(railId, untilEpoch?)` - Settle a payment rail up to specified epoch (must be <= current epoch; defaults to current if not specified), automatically includes settlement fee (0.0013 FIL), returns `TransactionResponse`
- `settleTerminatedRail(railId)` - Emergency settlement for terminated rails only - bypasses Warm Storage (or other validator) validation to ensure payment even if the validator contract is buggy (pays in full), returns `TransactionResponse`
- `getSettlementAmounts(railId, untilEpoch?)` - Preview settlement amounts without executing (untilEpoch must be <= current epoch; defaults to current), returns `SettlementResult` with `{totalSettledAmount, totalNetPayeeAmount, totalOperatorCommission, finalSettledEpoch, note}`
- `settleAuto(railId, untilEpoch?)` - Automatically detect rail status and settle appropriately (untilEpoch must be <= current epoch for active rails)

#### Storage Context Methods

A `StorageContext` (previously `StorageService`) represents a connection to a specific service provider and data set. Create one with `synapse.storage.createContext()`.

By using `StorageContext` directly you have efficiently deal with a specific service provider and data set for both upload and download options.

**Instance Properties:**
- `dataSetId` - The data set ID being used (string)
- `serviceProvider` - The service provider address (string)

**Core Storage Operations:**
- `upload(data, callbacks?)` - Upload data to this context's service provider, returns `UploadResult` with `pieceCid`, `size`, and `pieceId`
- `download(pieceCid, options?)` - Download data from this context's specific provider, returns `Uint8Array`
- `preflightUpload(dataSize)` - Check if an upload is possible before attempting it, returns preflight info with cost estimates and allowance check

**Information & Status:**
- `getProviderInfo()` - Get detailed information about the selected service provider
- `getDataSetPieces()` - Get the list of piece CIDs in the data set by querying the provider
- `hasPiece(pieceCid)` - Check if a piece exists on this service provider (returns boolean)
- `pieceStatus(pieceCid)` - Get the status of a piece including data set timing information

### Storage Context Creation

The SDK automatically handles all the complexity of storage setup for you - selecting providers, managing data sets, and coordinating with the blockchain. You have two options:

1. **Simple mode**: Just use `synapse.storage.upload()` directly - the SDK auto-manages contexts for you.
2. **Explicit mode**: Create a context with `synapse.storage.createContext()` for more control. Contexts can be used directly or passed in the options to `synapse.storage.upload()` and `synapse.storage.download()`.

Behind the scenes, the process may be:
- **Fast (<1 second)**: When reusing existing data sets that match your requirements (including all metadata)
- **Slower (2-5 minutes)**: When setting up new blockchain infrastructure (i.e. creating a brand new data set)

#### Basic Usage

```javascript
// Option 1: Auto-managed context (simplest)
await synapse.storage.upload(data)  // Context created/reused automatically

// Option 2: Explicit context creation
const context = await synapse.storage.createContext()
await context.upload(data)  // Upload to this specific context

// Option 3: Context with metadata requirements
const context = await synapse.storage.createContext({
  metadata: {
    withIPFSIndexing: '',
    category: 'videos'
  }
})
// This will reuse any existing data set that has both of these metadata entries,
// or create a new one if none match
```

#### Advanced Usage with Callbacks

Monitor the creation process with detailed callbacks:

```javascript
const context = await synapse.storage.createContext({
  providerAddress: '0x...', // Optional: use specific provider address
  withCDN: true,            // Optional: enable CDN for faster downloads
  callbacks: {
    // Called when a provider is selected
    onProviderSelected: (provider) => {
      console.log(`Selected provider: ${provider.owner}`)
      console.log(`  PDP URL: ${provider.pdpUrl}`)
    },

    // Called when data set is found or created
    onDataSetResolved: (info) => {
      if (info.isExisting) {
        console.log(`Using existing data set: ${info.dataSetId}`)
      } else {
        console.log(`Created new data set: ${info.dataSetId}`)
      }
    },

    // Only called when creating a new data set
    onDataSetCreationStarted: (transaction, statusUrl) => {
      console.log(`Creation transaction: ${transaction.hash}`)
      if (statusUrl) {
        console.log(`Monitor status at: ${statusUrl}`)
      }
    },

    // Progress updates during data set creation
    onDataSetCreationProgress: (status) => {
      const elapsed = Math.round(status.elapsedMs / 1000)
      console.log(`[${elapsed}s] Mining: ${status.transactionMined}, Live: ${status.dataSetLive}`)
    }
  }
})
```

#### Creation Options

```typescript
interface StorageServiceOptions {
  providerId?: number                      // Specific provider ID to use
  providerAddress?: string                 // Specific provider address to use
  dataSetId?: number                       // Specific data set ID to use
  withCDN?: boolean                        // Enable CDN services (alias for metadata: { withCDN: '' })
  metadata?: Record<string, string>        // Metadata requirements for data set selection/creation
  callbacks?: StorageCreationCallbacks     // Progress callbacks
  uploadBatchSize?: number                 // Max uploads per batch (default: 32, min: 1)
}
```

#### Data Set Selection and Matching

The SDK intelligently manages data sets to minimize on-chain transactions. The selection behavior depends on the parameters you provide:

**Selection Scenarios**:
1. **Explicit data set ID**: If you specify `dataSetId`, that exact data set is used (must exist and be accessible)
2. **Specific provider**: If you specify `providerId` or `providerAddress`, the SDK searches for matching data sets only within that provider's existing data sets
3. **Automatic selection**: Without specific parameters, the SDK searches across all your data sets with any approved provider

**Exact Metadata Matching**: In scenarios 2 and 3, the SDK will reuse an existing data set only if it has **exactly** the same metadata keys and values as requested. This ensures data sets remain organized according to your specific requirements.

**Selection Priority**: When multiple data sets match your criteria:
- Data sets with existing pieces are preferred over empty ones
- Within each group (with pieces vs. empty), the oldest data set (lowest ID) is selected

**Provider Selection** (when no matching data sets exist):
- If you specify a provider (via `providerId` or `providerAddress`), that provider is used
- Otherwise, the SDK currently uses random selection from all approved providers
- Before finalizing selection, the SDK verifies the provider is reachable via a ping test
- If a provider fails the ping test, the SDK tries the next candidate

```javascript
// Scenario 1: Explicit data set (no matching required)
const context1 = await synapse.storage.createContext({
  dataSetId: 42  // Uses data set 42 directly
})

// Scenario 2: Provider-specific search
const context2 = await synapse.storage.createContext({
  providerId: 3,
  metadata: { app: 'myapp', env: 'prod' }
})
// Searches ONLY within provider 3's data sets for exact metadata match

// Scenario 3: Automatic selection across all providers
const context3 = await synapse.storage.createContext({
  metadata: { app: 'myapp', env: 'prod' }
})
// Searches ALL your data sets across any approved provider

// Metadata matching examples (exact match required):
// These will use the SAME data set (if it exists)
const contextA = await synapse.storage.createContext({
  metadata: { app: 'myapp', env: 'prod' }
})
const contextB = await synapse.storage.createContext({
  metadata: { env: 'prod', app: 'myapp' }  // Order doesn't matter
})

// These will use DIFFERENT data sets
const contextC = await synapse.storage.createContext({
  metadata: { app: 'myapp' }  // Missing 'env' key
})
const contextD = await synapse.storage.createContext({
  metadata: { app: 'myapp', env: 'prod', extra: 'data' }  // Has extra key
})

// Provider selection when no data sets match:
const newContext = await synapse.storage.createContext({
  metadata: { app: 'newapp', version: 'v1' }
})
// If no existing data sets have this exact metadata:
// 1. SDK randomly selects from approved providers
// 2. Pings the selected provider to verify availability
// 3. Creates a new data set with that provider
```

**The `withCDN` Option**: This is a convenience alias for adding `{ withCDN: '' }` to metadata:

```javascript
// These are equivalent:
const context1 = await synapse.storage.createContext({ withCDN: true })
const context2 = await synapse.storage.createContext({
  metadata: { withCDN: '' }
})
```

#### Storage Context Properties

Once created, the storage context provides access to:

```javascript
// The data set ID being used
console.log(`Data set ID: ${context.dataSetId}`)

// The service provider address
console.log(`Service provider: ${context.serviceProvider}`)
```

#### Storage Context Methods

##### Preflight Upload

Check if an upload is possible before attempting it:

```javascript
const preflight = await context.preflightUpload(dataSize)
console.log('Estimated costs:', preflight.estimatedCost)
console.log('Allowance sufficient:', preflight.allowanceCheck.sufficient)
```

##### Upload and Download

Upload and download data with the storage context:

```javascript
// Upload with optional progress callbacks
const result = await context.upload(data, {
  onUploadComplete: (pieceCid) => {
    console.log(`Upload complete! PieceCID: ${pieceCid}`)
  },
  onPieceAdded: (transaction) => {
    // Called when the service provider has added the piece and submitted the
    // transaction to the chain
    console.log(`Transaction submitted: ${transaction.hash}`)
  },
  onPieceConfirmed: (pieceIds) => {
    // Called when the service provider agrees that the piece addition is
    // confirmed on-chain
    console.log(`Piece IDs assigned: ${pieceIds.join(', ')}`)
  }
})

// Download data from this context's specific provider
const downloaded = await context.download(result.pieceCid)

// Get the list of piece CIDs in the current data set by querying the provider
const pieceCids = await context.getDataSetPieces()
console.log(`Piece CIDs: ${pieceCids.map(cid => cid.toString()).join(', ')}`)

// Check the status of a piece on the service provider
const status = await context.pieceStatus(result.pieceCid)
console.log(`Piece exists: ${status.exists}`)
console.log(`Data set last proven: ${status.dataSetLastProven}`)
console.log(`Data set next proof due: ${status.dataSetNextProofDue}`)
```

##### Size Constraints

The storage service enforces the following size limits for uploads:
- **Minimum**: 127 bytes
- **Maximum**: 200 MiB (209,715,200 bytes)

Attempting to upload data outside these limits will result in an error.

***Note: these limits are temporary during this current pre-v1 period and will eventually be extended. You can read more in [this issue thread](https://github.com/FilOzone/synapse-sdk/issues/110)***

##### Efficient Batch Uploads

When uploading multiple files, the SDK automatically batches operations for efficiency. Due to blockchain transaction ordering requirements, uploads are processed sequentially. To maximize efficiency:

```javascript
// Efficient: Start all uploads without await - they'll be batched automatically
const uploads = []
for (const data of dataArray) {
  uploads.push(context.upload(data))  // No await here
}
const results = await Promise.all(uploads)

// Less efficient: Awaiting each upload forces sequential processing
for (const data of dataArray) {
  await context.upload(data)  // Each waits for the previous to complete
}
```

The SDK batches up to 32 uploads by default (configurable via `uploadBatchSize`). If you have more than 32 files, they'll be processed in multiple batches automatically.

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

The SDK provides flexible download options with clear semantics:

#### SP-Agnostic Download (from anywhere)

Download pieces from any available provider using the StorageManager:

```javascript
// Download from any provider that has the piece
const data = await synapse.storage.download(pieceCid)

// Download with CDN optimization (if available)
const dataWithCDN = await synapse.storage.download(pieceCid, { withCDN: true })

// Prefer a specific provider (falls back to others if unavailable)
const dataFromProvider = await synapse.storage.download(pieceCid, {
  providerAddress: '0x...'
})
```

#### Context-Specific Download (from this provider)

When using a StorageContext, downloads are automatically restricted to that specific provider:

```javascript
// Downloads from the provider associated with this context
const context = await synapse.storage.createContext({ providerAddress: '0x...' })
const data = await context.download(pieceCid)

// The context passes its withCDN setting to the download
const contextWithCDN = await synapse.storage.createContext({ withCDN: true })
const dataWithCDN = await contextWithCDN.download(pieceCid) // Uses CDN if available
```

#### CDN Option Inheritance

The `withCDN` option (which is an alias for `metadata: { withCDN: '' }`) follows a clear inheritance hierarchy:

1. **Synapse level**: Default setting for all operations
2. **StorageContext level**: Can override Synapse's default
3. **Method level**: Can override instance settings

```javascript
// Example of inheritance
const synapse = await Synapse.create({ withCDN: true })                  // Global default: CDN enabled
const context = await synapse.storage.createContext({ withCDN: false })  // Context override: CDN disabled
await synapse.storage.download(pieceCid)                                 // Uses Synapse's withCDN: true
await context.download(pieceCid)                                         // Uses context's withCDN: false
await synapse.storage.download(pieceCid, { withCDN: false })             // Method override: CDN disabled
```

Note: When `withCDN: true` is set, it adds `{ withCDN: '' }` to the data set's metadata, ensuring CDN-enabled and non-CDN data sets remain separate.

---

## PieceCID

PieceCID is Filecoin's native content address identifier, a variant of [CID](https://docs.ipfs.tech/concepts/content-addressing/). When you upload data, the SDK calculates a PieceCID—an identifier that:
- Uniquely identifies your bytes, regardless of size, in a short string form
- Enables retrieval from any provider storing those bytes
- Contains embedded size information

**Format Recognition:**

- **PieceCID**: Starts with `bafkzcib`, 64-65 characters - this is what Synapse SDK uses
- **LegacyPieceCID**: Starts with `baga6ea4seaq`, 64 characters - for compatibility with other Filecoin services

PieceCID is also known as "CommP" or "Piece Commitment" in Filecoin documentation. The SDK exclusively uses PieceCID (v2 format) for all operations—you receive a PieceCID when uploading and use it for downloads.

LegacyPieceCID (v1 format) conversion utilities are provided for interoperability with other Filecoin services that may still use the older format. See [PieceCID Utilities](#piececid-utilities) for conversion functions.

**Technical Reference:** See [FRC-0069](https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md) for the complete specification of PieceCID ("v2 Piece CID") and its relationship to LegacyPieceCID ("v1 Piece CID"). Most Filecoin tooling currently uses v1, but the ecosystem is transitioning to v2.

---

## Using Individual Components

All components can be imported and used independently for advanced use cases. The SDK is organized to match the external service structure:

### Payments Service

Direct interface to the Payments contract for token operations and operator approvals.

#### Understanding Payment Rails

Payment rails are continuous payment streams between clients and service providers that are created automatically when data sets are established. Each data set has associated payment rails (one for PDP storage, optionally additional ones for CDN services).

**How Rails Work:**

Rails ensure reliable payments through a simple lockup mechanism:

1. **The Lockup Requirement**: When you create a data set (storage), the system calculates how much balance you need to maintain:
   - Formula: `lockup = paymentRate × lockupPeriod` (e.g., 10 days worth of payments)
   - Example: Storing 1 GiB costs ~0.0000565 USDFC/epoch, requiring ~1.63 USDFC minimum balance
   - This protects the service provider by ensuring you always have enough for the next payment period

2. **How Your Balance Works**:
   - You deposit funds into the payments contract (e.g., 100 USDFC)
   - The lockup requirement reserves part of this balance (e.g., 1.63 USDFC for 1 GiB storage)
   - You can withdraw anything above the lockup requirement
   - When you settle, your total balance decreases by the payment amount (lockup requirement stays the same)

3. **Normal vs Abnormal Operations**:
   - **Normal Operation**: You keep settling regularly, lockup stays reserved but unused
   - **If you stop settling**: Service continues but unpaid amounts accumulate
   - **If balance gets too low**: Rail terminates when you can't cover future payments
   - **After termination**: The lockup NOW becomes available to pay the service provider for the period already provided

**Understanding Your Balance:**
- **Total Funds**: All tokens you've deposited into the payments contract
- **Lockup Requirement**: The minimum balance reserved to guarantee future payments
- **Available Balance**: `totalFunds - lockupRequirement` (this is what you can withdraw)

**When Lockup Gets Used (The Safety Net):**

The lockup finally gets "used" when things go wrong:
- **Rail terminates** (due to insufficient funds or manual termination)
- **After termination**, the service provider can settle and claim payment from the lockup
- **This ensures** the provider gets paid for services already delivered, even if the client disappears
- **Example**: If you had 10 days of lockup and the rail terminates, the provider can claim up to 10 days of service payments from that locked amount

For more details on the payment mechanics, see [Filecoin Pay documentation](https://github.com/FilOzone/filecoin-pay)

**When to Settle:**
- **Service Providers**: Periodically settle to receive accumulated earnings
- **Clients**: Settle before withdrawing to update available balance
- **Terminated Rails**: Must be settled to finalize and close the payment stream

**Settlement Fee:**
- Settlement operations require sending a small amount of FIL as a settlement fee (0.0013 FIL)
- The SDK automatically includes this fee when calling `settle()`
- The fee is defined as `SETTLEMENT_FEE` constant (corresponds to NETWORK_FEE in the contract)
- Make sure your wallet has sufficient FIL balance for the settlement fee

```javascript
import { PaymentsService } from '@filoz/synapse-sdk/payments'
import { ethers } from 'ethers'

const provider = new ethers.JsonRpcProvider(rpcUrl)
const signer = await provider.getSigner()
const paymentsService = new PaymentsService(provider, signer, paymentsAddress, usdfcAddress, false)

// Deposit USDFC to payments contract
const depositTx = await paymentsService.deposit(amount) // amount in base units
console.log(`Deposit transaction: ${depositTx.hash}`)
await depositTx.wait() // Wait for confirmation

// Check account info
const info = await paymentsService.accountInfo() // Uses USDFC by default
console.log('Available funds:', info.availableFunds)

// Approve service as operator
const approveTx = await paymentsService.approveService(
  serviceAddress,         // e.g., Warm Storage contract address
  rateAllowance,         // per-epoch rate allowance in base units
  lockupAllowance,        // total lockup allowance in base units
  maxLockupPeriod        // max lockup period in epochs (e.g., 86400n for 30 days)
)
console.log(`Service approval transaction: ${approveTx.hash}`)
await approveTx.wait() // Wait for confirmation

// Rail Settlement - manage continuous payment streams for storage services

// As a CLIENT: Find and settle your payment obligations
const payerRails = await paymentsService.getRailsAsPayer()
console.log(`You have ${payerRails.length} payment rails as a payer`)

// Check settlement fee requirement (automatically included in settle())
import { SETTLEMENT_FEE } from '@filoz/synapse-sdk'
console.log(`Settlement fee per settlement: ${ethers.formatEther(SETTLEMENT_FEE)} FIL`)

for (const rail of payerRails) {
  console.log(`Rail ${rail.railId}: ${rail.isTerminated ? 'terminated' : 'active'}`)

  // Preview what would be settled (useful before withdrawing funds)
  const preview = await paymentsService.getSettlementAmounts(rail.railId)
  console.log(`  Accumulated payment: ${preview.totalSettledAmount}`)

  // Settle to clear obligations and update available balance
  // Note: SDK automatically includes the network fee in the transaction
  if (!rail.isTerminated && preview.totalSettledAmount > 0n) {
    const settleTx = await paymentsService.settle(rail.railId)
    console.log(`  Settling rail ${rail.railId}: ${settleTx.hash}`)
    await settleTx.wait()
  }
}

// As a SERVICE PROVIDER: Find and collect earnings
const payeeRails = await paymentsService.getRailsAsPayee()
console.log(`You have ${payeeRails.length} payment rails as a payee`)

for (const rail of payeeRails) {
  // Check accumulated earnings
  const preview = await paymentsService.getSettlementAmounts(rail.railId)
  console.log(`Rail ${rail.railId} earnings: ${preview.totalNetPayeeAmount}`)

  // Settle to receive payments
  if (preview.totalNetPayeeAmount > 0n) {
    const settleTx = rail.isTerminated
      ? await paymentsService.settleTerminatedRail(rail.railId)  // For ended storage
      : await paymentsService.settle(rail.railId)                // For ongoing storage
    console.log(`  Collecting payment: ${settleTx.hash}`)
    await settleTx.wait()
  }
}
```

### Service Provider Registry

Query and manage service providers registered in the on-chain registry.

```javascript
import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'

// Create service instance
const spRegistry = new SPRegistryService(provider, registryAddress)

// Query providers
const allProviders = await spRegistry.getAllActiveProviders()
const provider = await spRegistry.getProvider(providerId)
const providerByAddr = await spRegistry.getProviderByAddress(address)

// Check registration status
const isRegistered = await spRegistry.isRegisteredProvider(address)
const providerId = await spRegistry.getProviderIdByAddress(address)
const isActive = await spRegistry.isProviderActive(providerId)

// Provider management (requires signer)
const registrationInfo = {
  name: 'My Storage Provider',
  description: 'Reliable storage service',
  pdpOffering: {
    serviceURL: 'https://provider.example.com',
    minPieceSizeInBytes: 65n,
    maxPieceSizeInBytes: 34091302912n,
    storagePricePerTibPerMonth: 5000000000000000000n,
    location: '/C=US/ST=CA/L=SF',
    // ... other PDP fields
  },
  capabilities: { hyperCompute: '100x' }
}
await spRegistry.registerProvider(signer, registrationInfo)
await spRegistry.updateProviderInfo(signer, name, description)
await spRegistry.removeProvider(signer)

// Product management for PDP services
await spRegistry.addPDPProduct(signer, pdpOffering, capabilities)
await spRegistry.updatePDPProduct(signer, pdpOffering, capabilities)
await spRegistry.deactivateProduct(signer, 0) // 0 = ProductType.PDP

// Query PDP service details
const pdpService = await spRegistry.getPDPService(providerId)
console.log('Service URL:', pdpService.offering.serviceURL)
console.log('Storage Price:', pdpService.offering.storagePricePerTibPerMonth)
```

### Warm Storage Service

Interact with the Warm Storage contract for data set management, service provider operations, and storage cost calculations.

```javascript
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'

// Create WarmStorageService using factory method
const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)

// Storage cost calculations
const costs = await warmStorageService.calculateStorageCost(sizeInBytes)
console.log(`Storage cost: ${costs.perMonth} per month`)

// Check allowances for storage (returns allowance details and costs)
const check = await warmStorageService.checkAllowanceForStorage(
  sizeInBytes,
  withCDN,
  paymentsService  // Pass PaymentsService instance
)
// check.sufficient - boolean indicating if allowances are sufficient
// check.costs - storage costs per epoch/day/month

// Prepare storage upload
const prep = await warmStorageService.prepareStorageUpload({
  dataSize: sizeInBytes,
  withCDN: false
}, paymentsService)

// Get client data sets with enhanced details
const dataSets = await warmStorageService.getClientDataSetsWithDetails(clientAddress)
for (const ds of dataSets) {
  console.log(`Rail ID: ${ds.railId}, PDP Verifier ID: ${ds.pdpVerifierDataSetId}`)
  console.log(`Is Live: ${ds.isLive}, Is Managed: ${ds.isManaged}`)
  console.log(`Next Piece ID: ${ds.nextPieceId}`)
}

// Get only data sets managed by this Warm Storage instance
const managedSets = await warmStorageService.getManagedDataSets(clientAddress)

// Verify data set creation
const verification = await warmStorageService.verifyDataSetCreation(txHash)
if (verification.dataSetLive) {
  console.log(`Data set ${verification.dataSetId} is live!`)
}

// Service provider operations
const isApproved = await warmStorageService.isProviderApproved(providerAddress)
const providers = await warmStorageService.getAllApprovedProviders()
```

### Subgraph Service

The SubgraphService provides access to Synapse-compatible subgraphs for provider discovery, data set tracking, and more.

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
  orderBy: 'totalDataSets',
  orderDirection: 'desc',
  first: 5
})

// Example: Find providers for a specific PieceCID
const providers = await subgraphService.getApprovedProvidersForPieceCID(pieceCid)
```

#### Custom Subgraph Service Implementations

The SDK supports custom implementations of the `SubgraphRetrievalService` interface, allowing you to provide alternative data sources for provider discovery. This is useful for testing, custom integrations, or cases where you need specialized provider selection logic.

```javascript
// Example: Implementing a custom SubgraphRetrievalService
class CustomProviderService implements SubgraphRetrievalService {
  async getApprovedProvidersForPieceCID(pieceCid) {
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

// Create PDPVerifier instance
const pdpVerifier = new PDPVerifier(provider, pdpVerifierAddress)

// Check if data set is live
const isLive = await pdpVerifier.dataSetLive(dataSetId)

// Get data set details
const nextPieceId = await pdpVerifier.getNextPieceId(dataSetId)
const listener = await pdpVerifier.getDataSetListener(dataSetId)
const leafCount = await pdpVerifier.getDataSetLeafCount(dataSetId)

// Extract data set ID from transaction receipt
const dataSetId = await pdpVerifier.extractDataSetIdFromReceipt(receipt)
```

#### PDP Server

Consolidated interface for all PDP server (Curio) HTTP operations including data sets, uploads, and downloads.

```javascript
import { PDPServer, PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

// Create server instance with auth helper
const authHelper = new PDPAuthHelper(warmStorageAddress, signer, chainId)
const pdpServer = new PDPServer(authHelper, 'https://pdp.provider.com', 'https://pdp.provider.com')

// Create a data set
const { txHash, statusUrl } = await pdpServer.createDataSet(
  clientDataSetId,     // number
  payee,               // string (service provider address)
  metadata,            // MetadataEntry[] (optional metadata, use [] for none)
  recordKeeper         // string (Warm Storage contract address)
)

// Check creation status
const status = await pdpServer.getDataSetCreationStatus(txHash)
console.log(`Status: ${status.txStatus}, Data Set ID: ${status.dataSetId}`)

// Add pieces to data set (returns transaction tracking info)
const addResult = await pdpServer.addPieces(
  dataSetId,          // number (PDPVerifier data set ID)
  clientDataSetId,    // number
  nextPieceId,        // number (must match chain state)
  pieceDataArray      // Array of { cid: string | PieceCID, rawSize: number }
)
// addResult: { message: string, txHash?: string, statusUrl?: string }

// Check piece addition status (for new servers with transaction tracking)
if (addResult.txHash) {
  const status = await pdpServer.getPieceAdditionStatus(dataSetId, addResult.txHash)
  console.log(`Status: ${status.txStatus}, Piece IDs: ${status.confirmedPieceIds}`)
}

// Upload a piece
const { pieceCid, size } = await pdpServer.uploadPiece(data, 'my-file.dat')

// Find existing piece
const piece = await pdpServer.findPiece(pieceCid, size)
console.log(`Piece found: ${piece.uuid}`)

// Download a piece
const data = await pdpServer.downloadPiece(pieceCid)

// Get data set details
const dataSet = await pdpServer.getDataSet(dataSetId)
console.log(`Data set ${dataSet.id} has ${dataSet.pieces.length} pieces`)
```

#### PDP Auth Helper

Sign EIP-712 typed data for PDP operations. Compatible with MetaMask and other browser wallets.

```javascript
import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

// Create auth helper
const authHelper = new PDPAuthHelper(warmStorageAddress, signer, chainId)

// Sign operations
const createDataSetSig = await authHelper.signCreateDataSet(
  clientDataSetId,    // number
  payeeAddress,       // string
  metadata            // MetadataEntry[] (optional metadata)
)

const addPiecesSig = await authHelper.signAddPieces(
  clientDataSetId,    // number
  firstPieceId,       // number
  pieceDataArray,     // Array of { cid: string | PieceCID, rawSize: number }
  metadata            // MetadataEntry[][] (optional per-piece metadata)
)

// All signatures return { signature, v, r, s, signedData }
```

### PieceCID Utilities

Utilities for calculating PieceCIDs and converting between formats.

```javascript
import { calculate, asPieceCID, asLegacyPieceCID, createPieceCIDStream } from '@filoz/synapse-sdk/piece'

// Calculate PieceCID from data
const data = new Uint8Array([1, 2, 3, 4])
const pieceCid = calculate(data)
console.log(pieceCid.toString()) // bafkzcib...

// Validate and convert PieceCID strings and CIDs
const convertedPieceCid = asPieceCID('bafkzcibcd4bdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy')
if (convertedPieceCid !== null) {
  console.log('Valid PieceCID:', convertedPieceCid.toString())
}

// Stream-based PieceCID calculation; compatible with Web Streams API
const { stream, getPieceCID } = createPieceCIDStream()
// Pipe data through stream, then call getPieceCID() for result

// Convert to LegacyPieceCID for compatibility with external Filecoin services
const legacyPieceCid = asLegacyPieceCID(convertedPieceCid)
if (legacyPieceCid !== null) {
  console.log('Valid LegacyPieceCID:', legacyPieceCid.toString())
  // Valid LegacyPieceCID: baga6ea4seaqdomn3tgwgrh3g532zopskstnbrd2n3sxfqbze7rxt7vqn7veigmy
}
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

- `PieceCID` - Filecoin Piece Commitment CID (v2)
- `LegacyPieceCID` - Filecoin Piece Commitment CID (v1)
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

The `(optional scope)` is used to provide additional clarity about the target of the changes if isolated to a specific subsystem. e.g. `payments`, `storage`, `warm-storage`, `ci`, etc.

#### Examples

```bash
# Patch releases (0.x.Y)
git commit -m "fix(payments): resolve approval race condition"
git commit -m "docs: update storage service examples"
git commit -m "test: add unit tests for PieceCID calculation"
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

### Git hooks

This repo uses [simple-git-hooks](https://github.com/toplenboren/simple-git-hooks) to manage git hooks, usage is optional and can be enable by running:

```bash
npx simple-git-hooks
```

Current configuration run [biome](https://biomejs.dev/guides/getting-started/) on staged files.

### Testing

Run the test suite:

```bash
npm test              # Run all tests and linting
npm run test:node     # Node.js tests only
npm run test:browser  # Browser tests only
```

### Generating ABIs

```bash
npm run generate-abi
```

## Migration Guide

### Terminology Update (v0.24.0+)

Starting with version 0.24.0, the SDK introduces comprehensive terminology changes to better align with Filecoin ecosystem conventions:

- **Pandora** → **Warm Storage**
- **Proof Sets** → **Data Sets**
- **Roots** → **Pieces**
- **Storage Providers** → **Service Providers**
  - _Note: most service providers are, in fact, storage providers, however this language reflects the emergence of new service types on Filecoin beyond storage._

This is a breaking change that affects imports, type names, method names, and configuration options throughout the SDK.

#### Import Path Changes

**Before (v0.23.x and earlier):**
```typescript
import { PandoraService } from '@filoz/synapse-sdk/pandora'
```

**After (v0.24.0+):**
```typescript
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
```

#### Type Name Changes

| Old Type (< v0.24.0) | New Type (v0.24.0+) |
|----------------------|---------------------|
| `ProofSetId` | `DataSetId` |
| `RootData` | `PieceData` |
| `ProofSetInfo` | `DataSetInfo` |
| `EnhancedProofSetInfo` | `EnhancedDataSetInfo` |
| `ProofSetCreationStatusResponse` | `DataSetCreationStatusResponse` |
| `RootAdditionStatusResponse` | `PieceAdditionStatusResponse` |
| `StorageProvider` | `ServiceProvider` |

#### Method Name Changes

**Synapse Class:**
```typescript
// Before (< v0.24.0)
synapse.getPandoraAddress()

// After (v0.24.0+)
synapse.getWarmStorageAddress()
```

**WarmStorageService (formerly PandoraService):**
```typescript
// Before (< v0.24.0)
pandoraService.getClientProofSets(client)
pandoraService.getAddRootsInfo(proofSetId)

// After (v0.24.0+)
warmStorageService.getClientDataSets(client)
warmStorageService.getAddPiecesInfo(dataSetId)
```

**PDPAuthHelper:**
```typescript
// Before (< v0.24.0)
authHelper.signCreateProofSet(serviceProvider, clientDataSetId)
authHelper.signAddRoots(proofSetId, rootData)

// After (v0.24.0+)
authHelper.signCreateDataSet(serviceProvider, clientDataSetId)
authHelper.signAddPieces(dataSetId, pieceData)
```

**PDPServer:**
```typescript
// Before (< v0.24.0)
pdpServer.createProofSet(serviceProvider, clientDataSetId)
pdpServer.addRoots(proofSetId, clientDataSetId, nextRootId, rootData)

// After (v0.24.0+)
pdpServer.createDataSet(clientDataSetId, serviceProvider, metadata, recordKeeper)
pdpServer.addPieces(dataSetId, clientDataSetId, nextPieceId, pieceData, metadata)
```

#### Service Provider Registry

v0.24.0 introduces the `SPRegistryService` for on-chain provider management:

```typescript
import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'

// Query and manage providers through the registry
const spRegistry = new SPRegistryService(provider, registryAddress)
const providers = await spRegistry.getAllActiveProviders()
```

This replaces previous provider discovery methods and provides a standardized way to register and manage service providers on-chain.

#### Interface Property Changes

**StorageService Properties:**
```typescript
// Before (< v0.24.0)
storage.storageProvider  // Provider address property

// After (v0.24.0+)
storage.serviceProvider  // Renamed property
```

**Callback Interfaces:**
```typescript
// Before (< v0.24.0)
onProofSetResolved?: (info: { proofSetId: number }) => void

// After (v0.24.0+)
onDataSetResolved?: (info: { dataSetId: number }) => void
```

#### Configuration Changes

**Before (< v0.24.0):**
```typescript
const synapse = await Synapse.create({
  pandoraAddress: '0x...',
  // ...
})
```

**After (v0.24.0+):**
```typescript
const synapse = await Synapse.create({
  warmStorageAddress: '0x...',
  // ...
})
```

#### Complete Migration Example

**Before (< v0.24.0):**
```typescript
import { PandoraService } from '@filoz/synapse-sdk/pandora'
import type { StorageProvider } from '@filoz/synapse-sdk'

const pandoraService = new PandoraService(provider, pandoraAddress)
const proofSets = await pandoraService.getClientProofSets(client)

for (const proofSet of proofSets) {
  console.log(`Proof set ${proofSet.railId} has ${proofSet.rootMetadata.length} roots`)
}

// Using storage service
const storage = await synapse.createStorage({
  callbacks: {
    onProofSetResolved: (info) => {
      console.log(`Using proof set ${info.proofSetId}`)
    }
  }
})
console.log(`Storage provider: ${storage.storageProvider}`)
```

**After (v0.24.0+):**
```typescript
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
import type { ServiceProvider } from '@filoz/synapse-sdk'

const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)
const dataSets = await warmStorageService.getClientDataSets(client)

for (const dataSet of dataSets) {
  console.log(`Data set ${dataSet.railId} has ${dataSet.pieceMetadata.length} pieces`)
}

// Using new storage context API
const context = await synapse.storage.createContext({
  callbacks: {
    onDataSetResolved: (info) => {
      console.log(`Using data set ${info.dataSetId}`)
    }
  }
})
console.log(`Service provider: ${context.serviceProvider}`)

// Downloads now use clearer method names
const data = await context.download(pieceCid)  // Download from this context's provider
const anyData = await synapse.storage.download(pieceCid)  // Download from any provider
```

#### Storage Architecture Changes (v0.24.0+)

The storage API has been redesigned for simplicity and clarity:

**Simplified Storage API:**
```typescript
// Before (< v0.24.0)
const storage = await synapse.createStorage()
await storage.upload(data)
await storage.providerDownload(pieceCid)  // Confusing method name
await synapse.download(pieceCid)  // Duplicate functionality

// After (v0.24.0+) - Recommended approach
await synapse.storage.upload(data)  // Simple: auto-managed contexts
await synapse.storage.download(pieceCid)  // Simple: download from anywhere

// Advanced usage (when you need explicit control)
const context = await synapse.storage.createContext({ providerAddress: '0x...' })
await context.upload(data)  // Upload to specific provider
await context.download(pieceCid)  // Download from specific provider
```

**Key improvements:**
- Access all storage operations via `synapse.storage`
- Automatic context management - no need to explicitly create contexts for basic usage
- Clear separation between SP-agnostic downloads (`synapse.storage.download()`) and context-specific downloads (`context.download()`)

#### Migration Checklist

When upgrading from versions prior to v0.24.0:

1. **Update imports** - Replace `@filoz/synapse-sdk/pandora` with `@filoz/synapse-sdk/warm-storage`
2. **Update type references**:
   - Replace all `ProofSet`/`proofSet` with `DataSet`/`dataSet`
   - Replace all `Root`/`root` with `Piece`/`piece`
   - Replace `StorageProvider` type with `ServiceProvider`
3. **Update interface properties**:
   - `ApprovedProviderInfo.owner` → `ApprovedProviderInfo.serviceProvider`
   - `ApprovedProviderInfo.pdpUrl` → `ApprovedProviderInfo.serviceURL`
   - `storage.storageProvider` → `storage.serviceProvider`
4. **Update callback names**:
   - `onProofSetResolved` → `onDataSetResolved`
   - Callback parameter `proofSetId` → `dataSetId`
5. **Simplify storage API calls**:
   - `synapse.createStorage()` → `synapse.storage.upload()` (for simple usage)
   - `synapse.createStorage()` → `synapse.storage.createContext()` (for advanced usage)
   - `storage.providerDownload()` → `context.download()`
   - `synapse.download()` → `synapse.storage.download()`
6. **Update method calls** - Use the new method names as shown above
7. **Update configuration** - Replace `pandoraAddress` with `warmStorageAddress`
8. **Update environment variables** - `PANDORA_ADDRESS` → `WARM_STORAGE_ADDRESS`
9. **Update GraphQL queries** (if using subgraph) - `proofSets` → `dataSets`, `roots` → `pieces`

#### PaymentsService Parameter Order Changes

All PaymentsService methods now consistently place the `token` parameter last with USDFC as the default:

**Before (< v0.24.0):**
```typescript
await payments.allowance(TOKENS.USDFC, spender)
await payments.approve(TOKENS.USDFC, spender, amount)
await payments.deposit(amount, TOKENS.USDFC, callbacks)
```

**After (v0.24.0+):**
```typescript
await payments.allowance(spender)  // USDFC is default
await payments.approve(spender, amount)  // USDFC is default
await payments.deposit(amount, TOKENS.USDFC, callbacks)  // callbacks last for deposit
```

#### Contract Address Configuration

The SDK now automatically discovers all necessary contract addresses. The `warmStorageAddress` option in `Synapse.create()` has been removed as addresses are managed internally by the SDK for each network.

Note: There is no backward compatibility layer. All applications must update to the new terminology and API signatures when upgrading to v0.24.0 or later.

## License

Dual-licensed under [MIT](https://opensource.org/licenses/MIT) + [Apache 2.0](https://www.apache.org/licenses/LICENSE-2.0)
