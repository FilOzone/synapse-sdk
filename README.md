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
import { Synapse, RPC_URLS } from '@filoz/synapse-sdk'

// Initialize with private key
const synapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.mainnet.websocket
})

// Check balances
const filBalance = await synapse.walletBalance()                    // FIL in wallet
const usdcBalance = await synapse.walletBalance(Synapse.USDFC)      // USDFC in wallet
const paymentsBalance = await synapse.balance(Synapse.USDFC)        // USDFC in payments contract

// Deposit funds for storage operations
await synapse.deposit(10n * 10n**18n, Synapse.USDFC)

// Create storage service and upload data
const storage = await synapse.createStorage()
const uploadTask = storage.upload(new TextEncoder().encode('Hello World'))
const commp = await uploadTask.commp()
await uploadTask.done()

// Download data
const data = await storage.download(commp)
console.log(new TextDecoder().decode(data)) // "Hello World"

// Query storage provider registry
const providers = await synapse.listStorageProviders()
for (const provider of providers) {
  console.log(`Provider ${provider.id}: ${provider.pdpUrl}`)
}
```

### With MetaMask

```javascript
import { Synapse } from '@filoz/synapse-sdk'
import { ethers } from 'ethers'

// Connect to MetaMask
const provider = new ethers.BrowserProvider(window.ethereum)
const synapse = await Synapse.create({ provider })

// Same API as above
const balance = await synapse.walletBalance()
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
}
```

#### Synapse Methods

**Wallet & Token Operations**
- `walletBalance(token?)` - Get wallet balance (FIL or USDFC)
- `balance(token?)` - Get balance in payments contract
- `decimals(token?)` - Get token decimals (always 18)
- `deposit(amount, token?)` - Deposit funds to payments contract
- `withdraw(amount, token?)` - Withdraw funds from payments contract

**Storage Operations**
- `createStorage(options?)` - Create a storage service instance
- `signOperation(operation, data)` - Sign data for on-chain authentication

**Storage Provider Registry**
- `listStorageProviders()` - Get all approved storage providers
- `getStorageProvider(providerId)` - Get provider by ID
- `getStorageProviderByAddress(address)` - Get provider by address
- `isProviderApproved(address)` - Check if provider is approved
- `getPendingProvider(address)` - Get pending provider registration

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
  await synapse.deposit(amount)
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
