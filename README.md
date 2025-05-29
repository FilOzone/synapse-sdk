# Synapse SDK

A JavaScript/TypeScript SDK for interacting with Filecoin Synapse - a smart-contract based marketplace for storage and other services in the Filecoin ecosystem.

## Overview

The Synapse SDK provides a simple interface for storing and retrieving binary data on Filecoin using PDP (Proof of Data Possession) for verifiability. It supports optional CDN services for improved retrieval performance and works with both private keys and browser wallets like MetaMask. In the future it will support additional services offered through the Filecoin Synapse marketplace.

## Installation

```bash
npm install synapse-sdk ethers
```

Note: `ethers` v6 is a peer dependency and must be installed separately.

## Quick Start

### With Private Key

```javascript
import { Synapse, RPC_URLS } from 'synapse-sdk'

// Using recommended RPC endpoints
const synapse = await Synapse.create({
  privateKey: '0x...',  // Your private key
  rpcURL: RPC_URLS.mainnet.http  // or RPC_URLS.mainnet.websocket for real-time updates
})

// Check balances
const filBalance = await synapse.walletBalance()
const usdcBalance = await synapse.walletBalance(Synapse.USDFC)
const paymentsBalance = await synapse.balance(Synapse.USDFC)

// Deposit if needed (amounts in smallest token size - bigint)
if (paymentsBalance < 10n * 10n**18n) {
  const txHash = await synapse.deposit(10n * 10n**18n, Synapse.USDFC)
  console.log(`Deposited USDFC: ${txHash}`)
}

// Upload data
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
import { Synapse } from 'synapse-sdk'
import { ethers } from 'ethers'

// Connect to MetaMask
const provider = new ethers.BrowserProvider(window.ethereum)

const synapse = await Synapse.create({
  provider: provider    // Use MetaMask provider
})

// Same API as above
const balance = await synapse.walletBalance()
```

## API Reference

### Constructor Options

```typescript
interface SynapseOptions {
  // Wallet Configuration (exactly one required)
  privateKey?: string           // Private key for signing transactions
  provider?: ethers.Provider    // Browser provider (MetaMask, WalletConnect, etc.)
  signer?: ethers.Signer        // External signer (legacy interface)
  
  // Network Configuration (required when using privateKey)
  rpcURL?: string              // RPC endpoint URL (supports http://, https://, ws://, wss://)
  
  // Advanced Configuration
  disableNonceManager?: boolean // Disable automatic nonce management (default: false)
}
```

### Synapse Class

#### Real Blockchain Methods (Not Mocked)

##### `walletBalance(): Promise<bigint>`
Returns the native FIL balance of the connected wallet in attoFIL (1 FIL = 10^18 attoFIL).

```javascript
const filBalance = await synapse.walletBalance()
console.log(`Balance: ${filBalance.toString()} attoFIL`)
```

##### `walletBalance(token: string): Promise<bigint>`
Returns the balance of a specific ERC20 token in smallest units.

```javascript
// Check USDFC balance
const usdcBalance = await synapse.walletBalance(Synapse.USDFC)
const divisor = 10n ** BigInt(synapse.decimals(Synapse.USDFC))
console.log(`USDFC Balance: ${(usdcBalance / divisor).toString()} USDFC`)

// Also accepts string literal
const balance = await synapse.walletBalance('USDFC')
```

##### `balance(token?: string): Promise<bigint>`
Returns the USDFC balance available in the payments contract for storage operations.

```javascript
// Check payments contract balance (defaults to USDFC)
const balance = await synapse.balance()
// Explicit token specification
const balance = await synapse.balance(Synapse.USDFC)
```

##### `deposit(amount: number | bigint, token?: string): Promise<string>`
Deposits USDFC to the payments contract for storage operations. Returns transaction hash.

```javascript
// Deposit 100 USDFC (amounts in smallest units)
const txHash = await synapse.deposit(100n * 10n**18n)
// Explicit token specification
const txHash = await synapse.deposit(100n * 10n**18n, Synapse.USDFC)
```

##### `withdraw(amount: number | bigint, token?: string): Promise<string>`
Withdraws USDFC from the payments contract back to wallet. Returns transaction hash.

```javascript
// Withdraw 50 USDFC (amounts in smallest units)
const txHash = await synapse.withdraw(50n * 10n**18n)
// Explicit token specification  
const txHash = await synapse.withdraw(50n * 10n**18n, Synapse.USDFC)
```

##### `decimals(token?: string): number`
Returns the number of decimals for a token (always 18 for FIL and USDFC).

```javascript
const decimals = synapse.decimals() // 18
const filDecimals = synapse.decimals('FIL') // 18
const usdcDecimals = synapse.decimals(Synapse.USDFC) // 18
```

**Supported Tokens:**
- `Synapse.USDFC` or `'USDFC'` - USDFC stablecoin
  - Mainnet: `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`
  - Calibration: `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`

**Note:** Payment methods (`balance`, `deposit`, `withdraw`) require the payments contract addresses to be configured in `constants.ts`. These are currently empty pending contract deployment.

**NonceManager:** By default, the SDK uses ethers.js NonceManager to prevent nonce conflicts when sending multiple transactions. This can be disabled with `disableNonceManager: true` if you prefer manual nonce management.

#### Mock Methods (For Development)

##### `createStorage(options?: StorageOptions): Promise<StorageService>`
Creates a storage service instance (mock implementation).

### StorageService Class (Mock)

All StorageService methods are currently mock implementations for development purposes.

```typescript
interface StorageService {
  readonly proofSetId: string        // Unique proof set identifier
  readonly storageProvider: string   // Storage provider address
  
  // Upload binary data and track progress
  upload(data: Uint8Array | ArrayBuffer): UploadTask
  
  // Download data by CommP (supports both CID and string)
  download(commp: CommP | string, options?: DownloadOptions): Promise<Uint8Array>
  
  // Delete data from storage
  delete(commp: CommP | string): Promise<void>
  
  // Settle payments with storage provider
  settlePayments(): Promise<SettlementResult>
}
```

#### Example Usage

```javascript
const storage = await synapse.createStorage()

// Upload data
const data = new TextEncoder().encode('Hello, Synapse!')
const uploadTask = storage.upload(data)

const commp = await uploadTask.commp()
const provider = await uploadTask.store()
const txHash = await uploadTask.done()

// Download data
const downloadedData = await storage.download(commp)
const text = new TextDecoder().decode(downloadedData)

// Download with options
const directData = await storage.download(commp, {
  withCDN: false,    // Force direct SP retrieval
  noVerify: true     // Skip CommP verification
})

// Cleanup
await storage.delete(commp)
```

### UploadTask Class (Mock)

Tracks multi-stage upload progress.

```typescript
interface UploadTask {
  commp(): Promise<CommP>        // Get the piece commitment (CommP)
  store(): Promise<string>       // Get storage provider confirmation
  done(): Promise<string>        // Get transaction hash when complete
}
```

### Type Definitions

#### CommP (Piece Commitment)
CommP is a special type of CID (Content Identifier) used in Filecoin for piece commitments.

```typescript
// Constrained CID type with specific codec and hash
type CommP = CID & {
  readonly code: 0xf101           // fil-commitment-unsealed
  readonly multihash: { code: 0x1012 }  // sha2-256-trunc254-padded
}
```

#### Network Detection
The SDK automatically detects the network based on chain ID:
- **314** - Filecoin Mainnet
- **314159** - Filecoin Calibration Testnet

## Network Configuration

### RPC Endpoints
The SDK supports both HTTP/HTTPS and WebSocket connections:

```javascript
import { Synapse, RPC_URLS } from 'synapse-sdk'

// HTTP/HTTPS endpoints
const httpSynapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.mainnet.http  // 'https://api.node.glif.io/rpc/v1'
})

// WebSocket endpoints (for real-time updates)
const wsSynapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.mainnet.websocket  // 'wss://wss.node.glif.io/apigw/lotus/rpc/v1'
})

// Calibration testnet
const calibrationSynapse = await Synapse.create({
  privateKey: '0x...',
  rpcURL: RPC_URLS.calibration.websocket
})
```

### Filecoin Mainnet
- Chain ID: 314
- HTTP RPC: https://api.node.glif.io/rpc/v1
- WebSocket RPC: wss://wss.node.glif.io/apigw/lotus/rpc/v1
- USDFC Contract: `0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`

### Filecoin Calibration Testnet
- Chain ID: 314159
- HTTP RPC: https://api.calibration.node.glif.io/rpc/v1
- WebSocket RPC: wss://wss.calibration.node.glif.io/apigw/lotus/rpc/v1
- USDFC Contract: `0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`

## Browser Integration

The SDK works seamlessly with browser wallets. See `examples/EXAMPLES.md` for complete browser integration examples.

### MetaMask Setup

Add Filecoin networks to MetaMask:

```javascript
// Calibration Testnet
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x4CB2F',  // 314159 in hex
    chainName: 'Filecoin Calibration',
    rpcUrls: ['https://api.calibration.node.glif.io/rpc/v1'],
    nativeCurrency: { name: 'FIL', symbol: 'tFIL', decimals: 18 }
  }]
})

// Mainnet
await window.ethereum.request({
  method: 'wallet_addEthereumChain',
  params: [{
    chainId: '0x13A',    // 314 in hex
    chainName: 'Filecoin',
    rpcUrls: ['https://api.node.glif.io/rpc/v1'],
    nativeCurrency: { name: 'FIL', symbol: 'FIL', decimals: 18 }
  }]
})
```

## Error Handling

```javascript
try {
  const synapse = await Synapse.create({
    privateKey: '0x...',
    rpcURL: 'https://api.node.glif.io/rpc/v1'
  })
  
  const balance = await synapse.walletBalance()
} catch (error) {
  if (error.message.includes('Unsupported network')) {
    // Handle unsupported network (only mainnet/calibration supported)
  } else if (error.message.includes('network detection failed')) {
    // Handle RPC connection issues
  } else if (error.cause) {
    // Access original error via Error.cause property
    console.log('Original error:', error.cause)
  }
}
```

## Common Patterns

### Checking Multiple Balances

```javascript
const [filBalance, usdcBalance, synapseBalance] = await Promise.all([
  synapse.walletBalance(),
  synapse.walletBalance(Synapse.USDFC),
  synapse.balance()
])
```

### Upload with Progress Tracking

```javascript
const uploadTask = storage.upload(data)

// Track each stage
uploadTask.commp().then(commp => console.log('CommP:', commp))
uploadTask.store().then(sp => console.log('Stored with:', sp))
uploadTask.done().then(tx => console.log('Transaction:', tx))

// Or wait for completion
const txHash = await uploadTask.done()
```

### Bulk Operations

```javascript
// Upload multiple files
const uploads = files.map(data => storage.upload(data))
const commps = await Promise.all(uploads.map(task => task.commp()))

// Download multiple files
const downloads = commps.map(commp => storage.download(commp))
const dataArray = await Promise.all(downloads)
```

## Development Status

**Production Ready:**
- ✅ Wallet integration (private key + browser providers + external signers)
- ✅ Network detection and strict validation (mainnet/calibration only)
- ✅ FIL and USDFC balance checking (bigint amounts)
- ✅ Type-safe CommP handling with proper validation
- ✅ Automatic nonce management with NonceManager
- ✅ TypeScript Standard Style code formatting
- ✅ WebSocket RPC support for real-time updates
- ✅ Error handling with Error.cause chaining
- ✅ Factory method pattern for async initialization

**Mock Implementation (Development Only):**
- 🚧 Storage operations (upload/download/delete)
- 🚧 Payment operations (deposit/withdraw) 
- 🚧 Storage service management

## Development

### Code Style
This project uses [ts-standard](https://github.com/standard/ts-standard) for consistent TypeScript formatting:

```bash
# Check formatting
npm run lint

# Auto-fix formatting issues
npm run lint:fix
```

### Build
```bash
# Build TypeScript to dist/
npm run build

# Watch mode for development
npm run watch
```

### Testing
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

## License

Apache-2.0