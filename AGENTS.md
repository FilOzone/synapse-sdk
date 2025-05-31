# Synapse SDK Context File

This document serves as context for LLM agent sessions working with the Synapse SDK. It will be updated as development progresses.

## Overview

The Synapse SDK provides a JavaScript/TypeScript interface to Filecoin Synapse. Synapse is a smart-contract based marketplace for services in the Filecoin ecosystem, with a primary focus on storage services.

Synapse.js allows users to interact with Filecoin services using HTTP or WebSocket connections.

## Current Status

- **Project Type**: TypeScript ES Module project
- **Target**: ES2022 with NodeNext module resolution
- **Build Output**: `dist/` directory
- **Development Stage**: Production-ready blockchain integration with mock storage
- **Code Quality**: Clean, refactored architecture with proper error handling

## Key Components

1. **Synapse**: The main entry point for the SDK, handling blockchain interactions, wallet management, payment operations, and service creation. Features strict network validation (mainnet/calibration only).

2. **StorageService**: 
   - Built on PDP (Proof of Data Possession) for cryptographic storage verification
   - Handles binary blob uploads and downloads
   - Manages payment settlements with storage providers
   - Supports optional CDN service for improved retrieval performance

3. **UploadTask**:
   - Tracks multi-stage upload process
   - Provides progress milestones: CommP generation, storage provider confirmation, chain commitment

4. **Protocols & Contracts**:
   - **PDP Verifier**: The main contract that holds proof sets and verifies proofs
   - **SimplePDPService**: Manages proving periods and fault reporting
   - **Verifier Contracts**: Verify that services are being properly offered
   - **Payment Rails**: Handle incremental payments between clients and storage providers

## TypeScript Structure

### Type System
- **Interfaces**: All main components (`Synapse`, `StorageService`, `UploadTask`) are defined as interfaces in `src/types.ts`
- **CommP Type**: Constrained CID type with fil-commitment-unsealed codec (0xf101) and sha2-256-trunc254-padded hasher (0x1012)
- **TokenAmount**: Supports `number | bigint` for precise token amounts (no strings to avoid floating point issues)
- **ES Modules**: Project uses native ES modules with `.js` extensions

### Implementation Strategy
- **Synapse Class**: Production blockchain integration with real wallet/token operations
- **MockStorageService**: Mock storage operations for development (real implementation pending)
- **MockUploadTask**: Mock upload tracking for development
- **Error Handling**: Uses Error.cause property for proper error chaining
- **Contract Caching**: Efficient contract instance caching to reduce object creation

### Development Tools
- **ts-standard**: TypeScript Standard Style linter for consistent formatting
- **TypeScript**: Strict mode enabled, source maps, declaration files
- **Build Scripts**: `npm run build`, `npm run watch`, `npm run lint`, `npm run example`

## PDP Workflow

1. Clients and providers establish a proof set for data storage verification
2. Providers add data roots to the proof set and submit periodic proofs
3. The system verifies these proofs using randomized challenges based on chain randomness
4. Faults are reported when proofs fail or are not submitted

## Architecture

The SDK follows a simple, focused design:
- A core `Synapse` class for wallet management and payment operations
- Factory method `createStorage()` for creating storage service instances
- `StorageService` class that handles binary blob storage operations
- `UploadTask` for tracking multi-stage upload progress
- Simple binary data interface (Uint8Array/ArrayBuffer)

## Usage Pattern

```typescript
// Initialize Synapse instance (factory method for async initialization)
const synapse = await Synapse.create({
  rpcURL: "wss://wss.node.glif.io/apigw/lotus/rpc/v1", // WebSocket for real-time
  privateKey: "0x...", // For signing transactions
})

// Check balances (all return bigint in smallest unit)
const filBalance = await synapse.walletBalance() // FIL balance
const usdcBalance = await synapse.walletBalance(Synapse.USDFC) // USDFC token balance
const paymentsBalance = await synapse.balance() // USDFC in payments contract

// Create a storage service instance
const storage = await synapse.createStorage({
  proofSetId: 'optional-existing-id',
  storageProvider: 'f01234'
})

// Upload binary data
const bytes = new Uint8Array([1, 2, 3])
const uploadTask = storage.upload(bytes)
const commp = await uploadTask.commp()
const txHash = await uploadTask.done()

// Download content
const content = await storage.download(commp)

// Payments (amounts in smallest unit as bigint)
await synapse.deposit(100n * 10n**18n) // 100 USDFC
await synapse.withdraw(50n * 10n**18n)  // 50 USDFC

// Using CommP utilities without Synapse instance
import { calculate, asCommP } from '@filoz/synapse-sdk/commp'

// Calculate CommP for data
const data = new Uint8Array([1, 2, 3, 4])
const commP = calculate(data)

// Validate and parse CommP strings
const validCommP = asCommP('baga6ea4seaqao7s73y24kcutaosvacpdjgfe5pw76ooefnyqw4ynr3d2y6x2mpq')
```

## Design Decisions

1. **Core API Design**:
   - Factory method pattern (`Synapse.create()`) for proper async initialization
   - Factory methods for creating service instances (`synapse.createStorage()`)
   - Payment methods directly on the Synapse instance (`deposit`, `withdraw`, `balance`)
   - Strict network validation - only supports Filecoin mainnet and calibration

2. **Environment Agnosticism**:
   - Core SDK has no dependencies on environment-specific APIs (Node.js/Browser)
   - Content and directory abstractions provide a unified interface
   - Adapter pattern for connecting to environment-specific file handling

3. **CommP Utilities**:
   - Available as a separate import path: `@filoz/synapse-sdk/commp`
   - `calculate()` function computes CommP (Piece Commitment) for binary data
   - `asCommP()` validates and parses CommP strings or CIDs
   - No need to instantiate Synapse class for these utilities
   - Uses @web3-storage/data-segment for efficient CommP calculation

4. **UnixFS Support**:
   - Content abstractions designed to preserve metadata needed for UnixFS
   - Directory structures maintained for proper IPFS packing
   - Support for both single files and directory trees

5. **Storage Service Design**:
   - Asynchronous upload tracking via UploadTask
   - Simple binary upload/download methods
   - Payment settlement per storage provider
   - Delete capability for data management

6. **TypeScript Styling**:
   - No semicolons (following modern JavaScript style)
   - Compact type definitions
   - Comprehensive exports for all public interfaces

## Implementation Notes

The SDK is designed to work in both Node.js and browser environments, with adapters handling environment-specific functionality. The core SDK itself remains environment-agnostic through the content abstractions.

Adapter implementations (not part of core) provide:
- Node.js: Filesystem interactions, stream support
- Browser: File/Blob API, download triggers, File System Access API
- Universal: Web streams, network requests, memory operations

### Current Implementation Status
- ✅ TypeScript project structure with ES modules
- ✅ Type definitions for all interfaces
- ✅ Production-ready Synapse class with real blockchain integration
- ✅ Working example code with factory method pattern
- ✅ CommP utilities with proper validation (`asCommP`, `isCommP`)
- ✅ ts-standard linting for consistent code style
- ✅ Ethers v6 integration for blockchain interactions
- ✅ NonceManager integration for automatic nonce management
- ✅ Native FIL balance checking via `walletBalance()`
- ✅ ERC20 token balance checking via `walletBalance(Synapse.USDFC)`
- ✅ Support for private keys, browser providers, and external signers
- ✅ WebSocket and HTTP RPC support with recommended endpoints
- ✅ Strict network validation (mainnet/calibration only)
- ✅ Error handling with Error.cause chaining
- ✅ Contract instance caching for efficiency
- ✅ Browser examples with HTML demos
- ✅ Comprehensive API documentation in README
- ✅ Test suite with 29 passing tests
- 🚧 Mock storage service (real implementation pending)
- ⏳ Documentation website pending

### File Structure
```
src/
├── index.ts          # Main entry point, re-exports all public APIs
├── types.ts          # TypeScript interfaces and type definitions
├── synapse.ts        # MockSynapse implementation with ethers integration
├── storage-service.ts # MockStorageService implementation
├── upload-task.ts    # MockUploadTask implementation
├── commp.ts          # CommP utilities and validation
└── constants.ts      # Network addresses, ABIs, and constants

examples/
├── example-usage.js        # Basic usage example with private key
├── example-metamask.js     # Browser wallet integration examples
├── example-metamask.html   # Standalone HTML demo
├── example-metamask-sdk.html # Full SDK HTML demo
└── EXAMPLES.md             # Documentation for running browser examples
```

### Key Features

#### Code Quality
- **ts-standard**: Enforces TypeScript Standard Style for consistent formatting
- **Explicit Null Checks**: All conditional checks use explicit `== null` / `!= null` comparisons
- **Nullish Coalescing**: Uses `??` operator instead of `||` for safer default value assignment
- **Modern TypeScript**: Takes advantage of TypeScript strict mode and modern language features

#### Wallet Integration
- **Private Key Support**: Simple initialization with `privateKey` + `rpcUrl` options
- **Provider Support**: Compatible with browser providers via `provider` option
- **External Signer Support**: Compatible with MetaMask, WalletConnect, hardware wallets via `signer` option
- **Ethers v6 Signer Abstraction**: Works with any ethers-compatible signer
- **Validation**: Ensures exactly one of `privateKey`, `provider`, or `signer` is provided

#### Token Integration
- **USDFC Addresses**: Hardcoded for mainnet (`0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`) and calibration testnet (`0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`)
- **Balance Checking**: `walletBalance()` for native FIL, `walletBalance(Synapse.USDFC)` for USDFC tokens (both return bigint)
- **Network Detection**: Automatically detects mainnet vs calibration based on chain ID (314 for mainnet, 314159 for calibration)
- **Strict Validation**: Throws error for unsupported networks
- **BigInt Support**: All token amounts use bigint to avoid floating point precision issues

#### NonceManager Integration
- **Automatic Nonce Management**: NonceManager is enabled by default to prevent nonce conflicts
- **Sequential Transaction Processing**: Ensures transactions are sent with correct, sequential nonces
- **Disable Option**: Can be disabled with `disableNonceManager: true` option if manual nonce management is preferred
- **MetaMask Compatibility**: Works seamlessly with MetaMask and other browser wallets

This document will be updated as the SDK implementation progresses.