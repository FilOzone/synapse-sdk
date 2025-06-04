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

// Check balances (all return bigint in base units)
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

// Payments (amounts in base units as bigint)
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

## Design Philosophy

The Synapse SDK follows a dual-track design philosophy:

1. **Simple Golden Path**: The main `Synapse` class provides a coherent, high-level API that makes sensible default choices and abstracts away complexity. This is ideal for most users who want to quickly integrate Filecoin storage capabilities.

2. **Composable Components**: All individual components are exported and can be used independently by advanced users or developers who need fine-grained control over specific parts of the process.

This approach ensures the SDK is both beginner-friendly and powerful enough for advanced use cases.

## Design Decisions

1. **Core API Design**:
   - Factory method pattern (`Synapse.create()`) for proper async initialization
   - Factory methods for creating service instances (`synapse.createStorage()`)
   - Payment methods directly on the Synapse instance (`deposit`, `withdraw`, `balance`)
   - Strict network validation - only supports Filecoin mainnet and calibration
   - All components can be imported and used independently

2. **Environment Agnosticism**:
   - Core SDK has no dependencies on environment-specific APIs (Node.js/Browser)
   - Content and directory abstractions provide a unified interface
   - Adapter pattern for connecting to environment-specific file handling

3. **CommP Utilities**:
   - Available as a separate import path: `@filoz/synapse-sdk/commp`
   - `calculate()` function computes CommP (Piece Commitment) for binary data
   - `asCommP()` validates and parses CommP strings or CIDs
   - `createCommPStream()` creates a WebStreams TransformStream for streaming CommP calculation
   - No need to instantiate Synapse class for these utilities
   - Uses @web3-storage/data-segment for efficient CommP calculation
   - Streaming support allows CommP calculation without buffering entire data in memory

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
- ✅ Test suite with cross-boundary signature compatibility testing
- ✅ Auth signature generation compatible with Solidity contracts
- ✅ Browser bundle generation via webpack (UMD and ESM format)
- 🚧 Mock storage service (real implementation pending)
- ⏳ Documentation website pending

### File Structure
```
src/
├── index.ts          # Main entry point, re-exports all public APIs
├── types.ts          # TypeScript interfaces and type definitions
├── synapse.ts        # Synapse implementation with ethers integration
├── storage-service.ts # MockStorageService implementation
├── upload-task.ts    # MockUploadTask implementation
├── constants.ts      # Network addresses, ABIs, and constants
├── auth.ts           # AuthHelper for signing PDP operations with contract compatibility
├── commp/            # CommP (Piece Commitment) utilities
│   ├── index.ts      # Re-exports CommP functions
│   └── commp.ts      # CommP calculation and validation
├── pdp/              # PDP (Proof of Data Possession) services
│   ├── index.ts      # Re-exports PDP services
│   ├── pdp-upload-service.ts   # PDPUploadService for uploading to PDP servers
│   └── pdp-download-service.ts # PDPDownloadService for retrieving from storage providers
└── test/             # Test suite
    ├── auth.test.ts  # Auth signature compatibility tests vs Solidity contracts
    ├── commp.test.ts # CommP utilities tests
    ├── synapse.test.ts # Synapse class tests
    └── pdp.test.ts   # PDP service tests
```

### Build Process

#### Browser Bundling
- **Webpack Configuration**: Builds UMD bundles for browser distribution
- **Entry Point**: `src/browser-entry.ts` re-exports all SDK components
- **Build Commands**:
  - `npm run build` - Builds TypeScript and browser bundles
  - `npm run build:browser` - Builds only browser bundles
  - `npm run watch` - Watches TypeScript files for changes
  - `npm run watch:browser` - Watches and rebuilds browser bundles
- **Output**: Browser bundles in `dist/browser/` directory
- **NPM Package**: Entire `dist/` directory is published including browser bundles

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

## CommPv2 Format and 32-Byte Digests

**CRITICAL KNOWLEDGE**: Understanding CommPv2 is essential for proper contract integration. Reference: [FRC-0069](https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md)

### CommPv2 Structure
The new Piece Multihash CID format (CommPv2) has the structure:
```
uvarint padding | uint8 height | 32 byte root data
```

### Key Points
1. **32-Byte Root Data**: The last 32 bytes represent the root of a binary merkle tree
2. **Height Field**: Encodes the tree height, supporting pieces up to 32 GiB (height 30)
3. **Size Information**: The format embeds size information directly in the CID
4. **Contract Compatibility**: Solidity contracts expect only the 32-byte root digest

### Implementation Details
- **CommPv1 (Legacy)**: Uses fil-commitment-unsealed codec (0xf101) and sha2-256-trunc254-padded (0x1012)
- **CommPv2 Extraction**: `digest.bytes.subarray(digest.bytes.length - 32)` extracts the 32-byte root
- **Contract Encoding**: Solidity `PDPVerifier.RootData` expects the 32-byte digest, not the full CID

### Why This Matters
- Smart contracts work with 32-byte digests for efficiency and gas costs
- The SDK must extract the correct 32-byte portion from CommPv2 for contract compatibility
- Misunderstanding this structure leads to signature verification failures

## Authentication Signature Compatibility

The SDK implements EIP-712 typed signatures for PDP operations, compatible with Solidity contract verification and MetaMask.

### Signature Operations
1. **CreateProofSet**: Creates a new proof set for a client dataset
2. **AddRoots**: Adds CommP roots to an existing proof set
3. **ScheduleRemovals**: Schedules removal of specific roots
4. **DeleteProofSet**: Deletes an entire proof set

### Implementation Details

All signatures use standard EIP-712 encoding via ethers.js `signTypedData`. The SDK automatically detects whether to use MetaMask-friendly signing (for browser wallets) or standard signing (for private keys).

**Key Structure**: `Cids.Cid` in Solidity is a `struct { bytes data; }` containing the 32-byte CommP digest extracted from the CID.

### PDPAuthHelper Usage
```typescript
import { PDPAuthHelper } from '@filoz/synapse-sdk/pdp'

const authHelper = new PDPAuthHelper(contractAddress, signer, chainId)

// All operations return { signature, v, r, s, signedData }
const createProofSetSig = await authHelper.signCreateProofSet(clientDataSetId, payee, withCDN)
const addRootsSig = await authHelper.signAddRoots(clientDataSetId, firstRootId, rootDataArray)
const scheduleRemovalsSig = await authHelper.signScheduleRemovals(clientDataSetId, rootIds)
const deleteProofSetSig = await authHelper.signDeleteProofSet(clientDataSetId)
```

The AuthHelper can be obtained from a Synapse instance via `synapse.getPDPAuthHelper()` for convenience.

### PDP Service Integration

The SDK includes PDP service classes for uploading data to PDP servers and downloading from storage providers:

#### PDPUploadService Features
- **Simple Two-Step Upload Process**:
  1. POST to `/pdp/piece` with CommP and size to create upload
  2. PUT to `/pdp/piece/upload/{UUID}` with binary data
- **No Authentication Required**: Uses null authentication (no JWT tokens needed)
- **Browser-Compatible**: Uses standard fetch API and multiformats utilities
- **CommP-Based**: All uploads require pre-calculated CommP for data verification

#### PDPDownloadService Features
- **Direct Piece Retrieval**: Downloads pieces directly from storage providers
- **CommP Verification**: Automatically verifies downloaded data matches requested CommP
- **Simple API**: Single method `downloadPiece(commp)` returns verified data
- **Error Handling**: Throws if download fails or CommP verification fails

#### Usage Patterns
```typescript
import { PDPUploadService, PDPDownloadService } from '@filoz/synapse-sdk/pdp'
import { calculate } from '@filoz/synapse-sdk/commp'

// Upload example
const data = new Uint8Array([1, 2, 3, 4])
const commp = calculate(data)
const uploadService = new PDPUploadService('https://pdp.example.com')
await uploadService.upload(data, commp)

// Download example
const downloadService = new PDPDownloadService('https://sp.example.com/retrieve')
const downloadedData = await downloadService.downloadPiece(commp)
// Data is automatically verified to match the CommP
```

#### Implementation Notes
- Upload: Location header parsing expects format: `/pdp/piece/upload/{UUID}` (not anchored to start)
- Upload: Service handles both new uploads (201) and existing pieces (200)
- Upload: CORS requirements: Server must include `Access-Control-Expose-Headers: Location`
- Download: Appends `/piece/{commp}` to retrieval URL
- Both services use `toHex` from multiformats/bytes for browser compatibility (no Buffer)
- Download: Uses streaming CommP verification via `createCommPStream()` TransformStream
- Download: Calculates CommP while downloading, avoiding double memory usage
- WebStreams API used throughout for browser/Node.js compatibility

### Browser Distribution

The SDK is distributed with browser-ready bundles:
- **UMD Bundle**: `dist/browser/synapse-sdk.js` - Works with script tags
- **Minified Bundle**: `dist/browser/synapse-sdk.min.js` - Production-optimized
- **Entry Point**: `dist/browser-entry.js` - Flattens all exports for browser use
- **External Dependencies**: ethers.js must be loaded separately
- **Global Variable**: `window.SynapseSDK` when loaded via script tag

## Development Environment and External Repositories

In development environments, the following related repositories may be available locally for reference and testing. **Local Repository Naming Convention**: Repositories should be cloned with the format `{org-name}-{repo-name}` (e.g., `filecoin-project-curio`, `FilOzone-pdp`) to avoid naming conflicts and clearly identify the source organization.

### Key Repositories
- **filecoin-project/curio**: [https://github.com/filecoin-project/curio](https://github.com/filecoin-project/curio)
  - **Local Path**: `filecoin-project-curio/`
  - Filecoin storage provider implementation
  - **Key Files**: 
    - `pdp/handlers.go` - Core PDP request handlers
    - `pdp/handlers_upload.go` - Upload-specific PDP handlers
    - `cmd/pdptool/main.go` - Example client interactions and usage patterns
  - Contains storage workflows and proving logic for the PDP directory

- **FilOzone/pdp**: [https://github.com/FilOzone/pdp](https://github.com/FilOzone/pdp)
  - **Local Path**: `FilOzone-pdp/`
  - **Key Contract**: `src/PDPVerifier.sol` - Core PDP verification contract
  - Contains the `RootData` struct and proof verification logic
  - Defines the `Cids.Cid` structure used in signature encoding

- **FilOzone/filecoin-services**: [https://github.com/FilOzone/filecoin-services](https://github.com/FilOzone/filecoin-services)
  - **Local Path**: `FilOzone-filecoin-services/`
  - **Key Contract**: `service_contracts/src/SimplePDPServiceWithPayments.sol`
  - Implements PDP service operations with payment integration
  - Contains signature verification functions for auth operations
  - Houses the Forge test fixtures for cross-boundary signature testing

- **FilOzone/fws-payments**: [https://github.com/FilOzone/fws-payments](https://github.com/FilOzone/fws-payments)
  - **Local Path**: `FilOzone-fws-payments/`
  - **Key Contract**: `src/Payments.sol` - Payment processing contract
  - Handles token deposits, withdrawals, and balance management
  - Integrates with USDFC token contract

### Usage Notes
- **Local Development**: If repositories are available locally with the `{org}-{repo}` naming convention, files can be accessed directly for debugging and testing
- **Remote Access**: Contract files can also be viewed via GitHub URLs when local copies aren't available
- **Cross-Repository Testing**: Signature compatibility tests reference contracts from these repositories
- **Contract Dependencies**: Understanding these contracts is essential for proper SDK integration
- **Path Expectations**: When using local development environment, expect repositories at paths like `./filecoin-project-curio/` and `./FilOzone-pdp/` cloned to the same directory as the SDK project. This allows for easy import and testing of contract interactions but they should not be checked in if they exist.

This document will be updated as the SDK implementation progresses.