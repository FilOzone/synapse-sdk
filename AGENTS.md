# Synapse SDK AI Context File

This document serves as context for LLM agent sessions working with the Synapse SDK. It will be updated as development progresses.

## Overview
- Synapse SDK: JavaScript/TypeScript interface to Filecoin Synapse, a smart-contract marketplace for Filecoin services (focus: storage).
- Supports HTTP and WebSocket connections for interacting with Filecoin services.

### Design Philosophy
- Simple Golden Path: Main `Synapse` class offers high-level API, sensible defaults, abstracts complexity.
- Composable Components: All components exported for advanced/independent use.

## Source Structure

### Key Components
- `Synapse`: Main SDK entry; minimal interface with `payments` property and `storage` manager; strict network validation (mainnet/calibration).
- `PaymentsService`: Payment operations - deposits, withdrawals, balances, service approvals.
- `SPRegistryService`: Service provider registry - registration, updates, product management, provider discovery.
- `WarmStorageService`: Storage coordination - costs, allowances, data sets. Factory method `WarmStorageService.create(provider, address)`. Source of all contract addresses via discovery.
- `StorageManager/StorageContext`: Storage operations with auto-managed or explicit contexts.
- `PDPVerifier/PDPServer/PDPAuthHelper`: Direct PDP protocol interactions.

### Development Tools
- **TypeScript**: Strict mode enabled, source maps, declaration files, ES2022 target with NodeNext module resolution, build output to `dist/` directory; package.json is `"module"`, source is compiled with .js extensions.
- **ts-standard**: TypeScript Standard Style linter for consistent formatting, no semicolons, prefer to run `npm run lint:fix` for lint+fix,
  - **BEWARE** of common TS code, these rules will cause problems so you should either `lint:fix` regularly or avoid code that produces these: strict-boolean-expressions, no-trailing-spaces, return-await, no-unused-vars, indent
- **Build Scripts**: `npm run build` but prefer `npm run build:browser` to to build browser bundles to `dist/browser/{synapse-sdk.esm.js,synapse-sdk.min.js}`
- **Testing**: Mocha with `/* globals describe it */`, Chai for `{ assert }` in `src/test/`
- **Conventional Commits**: Auto-publishing enabled with semantic versioning based on commit messages. Use `feat:` for minor, `fix:`/`chore:`/`docs:`/`test:` for patch. AVOID breaking change signifiers (`!` or `BREAKING CHANGE`) even if there are actual breaking changes. See <README.md#commit-message-guidelines> for full details. IMPORTANT: only create commits if asked to by the user, prefer to provide commit messages.

## Design Decisions

1. **VERY IMPORTANT: Environment Agnosticism**:
   - Core SDK has no dependencies on environment-specific APIs (Node.js/Browser)
   - AVOID `Buffer` and other Node.js-specific types unless writing Node.js-specific code
     - `toHex` is available from the 'multiformats/bytes' import for browser compatibility (no Buffer)
   - PREFER web standard APIs like `fetch` and WebStreams

2. **Core API Design**:
   - Factory method pattern (`Synapse.create()`) for proper async initialization
   - Minimal Synapse class: only `payments` property and `createStorage()` method
   - Payment methods via `synapse.payments.*` (PaymentsService)
   - Storage costs/allowances via WarmStorageService (separate instantiation)
   - **Network Detection**: Uses chainId-based validation with `getFilecoinNetworkType(provider)` utility - network is auto-detected from provider, eliminating need for manual network parameters
   - Strict network validation - only supports Filecoin mainnet and calibration

### Contract Addresses
- SDK automatically discovers all addresses from network (using Multicall3)
- Only WarmStorage address varies by deployment (handled internally)
- Address discovery pattern: WarmStorage → All other contracts

### File Structure
```
src/
├── browser-entry.ts            # Browser bundle entry point
├── piece/                      # PieceCID utilities (Piece Commitment calculations)
├── payments/                   # Payment contract interactions
│   └── service.ts              # PaymentsService - consistent token-last API
├── warm-storage/               # Warm Storage contract interactions
│   └── service.ts              # WarmStorageService - costs, allowances, address discovery
├── sp-registry/                # Service Provider Registry
│   ├── service.ts              # SPRegistryService - provider management
│   └── types.ts                # Registry types and interfaces
├── pdp/                        # PDP protocol implementations
│   ├── auth.ts                 # PDPAuthHelper - EIP-712 signatures
│   ├── server.ts               # PDPServer - Curio HTTP API client
│   ├── verifier.ts             # PDPVerifier - contract interactions
├── storage/                    # Storage implementation
│   ├── manager.ts              # StorageManager - auto-managed contexts, SP-agnostic downloads
│   └── context.ts              # StorageContext - specific SP + DataSet operations
├── utils/                      # Shared utilities
│   ├── constants.ts            # CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS, SIZE_CONSTANTS
│   ├── errors.ts               # Error creation utilities
│   └── provider-resolver.ts   # Provider discovery and selection logic
├── synapse.ts                  # Main Synapse class (minimal interface)
└── types.ts                    # TypeScript interfaces
```

### Key Features

#### Wallet Integration
- **Private Key Support**: Simple initialization with `privateKey` + `rpcUrl` options
- **Provider Support**: Compatible with browser providers via `provider` option
- **External Signer Support**: Compatible with MetaMask, WalletConnect, hardware wallets via `signer` option
- **Ethers v6 Signer Abstraction**: Works with any ethers-compatible signer
- **Validation**: Ensures exactly one of `privateKey`, `provider`, or `signer` is provided
- **Nonce Management**: Uses NonceManager by default to handle transaction nonces automatically
- **PaymentsService Design**: Takes both provider and signer for NonceManager compatibility. Provider for balance/nonce, signer for transactions.

#### Token Integration
- **USDFC Address**: Discovered automatically
- **Balance Checking**: `walletBalance()` for FIL, `walletBalance(TOKENS.USDFC)` for USDFC (bigint)
- **BigInt**: All amounts use bigint
- **Constants**: `CONTRACT_ADDRESSES`, `CONTRACT_ABIS`, `TOKENS`

#### Browser Distribution
- **UMD Bundle**: `dist/browser/synapse-sdk.js` - Works with script tags
- **Minified Bundle**: `dist/browser/synapse-sdk.min.js` - Production-optimized
- **Entry Point**: `dist/browser-entry.js` - Flattens all exports for browser use
- **External Dependencies**: ethers.js must be loaded separately (https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js can be used)
- **Global Variable**: `window.SynapseSDK` when loaded via script tag

## PieceCID Format and 32-Byte Digests

**CRITICAL KNOWLEDGE**: PieceCID (also known as CommP or Piece Commitment) is Filecoin's content-addressed identifier for data pieces. Reference: [FRC-0069](https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md)

### PieceCID Structure (v2 format)
```
uvarint padding | uint8 height | 32 byte piece data
```
- **32-Byte Piece Data**: The last 32 bytes = root of binary merkle tree
- **Contract Compatibility**: Solidity contracts expect only the 32-byte digest, not full CID
- **SDK Extraction**: `digest.bytes.subarray(digest.bytes.length - 32)` gets the digest

### PieceCID Utilities
- Import path: `@filoz/synapse-sdk/piece` / `src/piece`
- `calculate()` - Compute PieceCID from data
- `asPieceCID()` - Validate/convert to PieceCID type
- `asLegacyPieceCID()` - Convert to v1 format for compatibility
- `createPieceCIDStream()` - Streaming calculation without buffering

## Contract Architecture and Integration

### System Architecture Overview

The PDP (Proof of Data Possession) system follows a layered architecture with clear separation of concerns:

```
Client SDK → Curio Storage Provider → PDPVerifier Contract → Service Contract
     ↓              ↓                       ↓                    ↓
 Auth Signatures  HTTP API              Core Protocol       Business Logic

SDK Component Hierarchy:
Synapse (minimal interface)
   └── PaymentsService (pure payments)

WarmStorageService (storage coordination)
   ├── Depends on PaymentsService
   └── Depends on PDPVerifier
```

### Core Contracts and Their Roles

```
┌─────────────────────────────────────────────────────────────────┐
│                     Warm Storage                                      │
│  • Client auth (EIP-712 signatures)                              │
│  • Provider management (whitelist)                               │
│  • Integrates Payments contract                                  │
│  • Implements PDPListener callbacks                              │
└────────────────────────┬────────────────────────────────────────┘
                         │ Inherits & Integrates
┌────────────────────────┴────────────┬───────────────────────────┐
│          PDPVerifier                │       Payments             │
│  • Core protocol logic              │  • Token deposits/withdraws│
│  • Proof verification               │  • Balance management      │
│  • Neutral (no business logic)      │  • Rail settlements        │
│  • Calls recordKeeper callbacks     │  • Generic payment system  │
└─────────────────────────────────────┴───────────────────────────┘
```

#### 1. PDPVerifier Contract (`FilOzone-pdp/src/PDPVerifier.sol`)
- **Purpose**: The neutral, protocol-level contract that manages data sets and verification
- **Responsibilities**:
  - Creates and manages data sets on-chain
  - Handles adding/removing pieces from data sets
  - Performs cryptographic proof verification
  - Emits events and calls listener contracts
- **Key Functions**: `createDataSet()`, `addPieces()`, `provePieces()`
- **Address**: Discovered from WarmStorage
- **Client Interaction**: Indirect (through Curio API)


#### 3. Warm Storage (`FilOzone-filecoin-services/service_contracts/src/FilecoinWarmStorageService.sol`)
- **Purpose**: The business logic layer that handles payments, authentication, and service management (SimplePDPService with payments integration)
- **Architecture**: Split into two contracts:
  - Main contract: Write operations and service provider management
  - View contract (`FilecoinWarmStorageServiceStateView.sol`): Read-only view methods for contract size optimization
- **Responsibilities**:
  - Validates client authentication signatures (EIP-712)
  - Manages service whitelist via `registerServiceProvider()`
  - Creates payment rails on data set creation
  - Receives callbacks from PDPVerifier via `PDPListener` interface
  - Provides pricing information via `getServicePrice()` returning both CDN and non-CDN rates
- **Address**: Network-specific, handled internally
- **Client Interaction**: Direct (for signatures) and indirect (via Curio callbacks)
- **Inheritance**: Inherits SimplePDPService, integrates Payments contract

#### 4. Payments Contract (`FilOzone-fws-payments/src/Payments.sol`)
- Generic payment infrastructure for any service
- Handles USDFC token deposits/withdrawals
- Manages payment rails between parties
- Supports operator approvals for account management
- Address discovered from WarmStorage

#### 5. Curio Storage Provider (Service Node)
- HTTP API layer that orchestrates blockchain interactions and storage operations
- Exposes REST API for PDP operations at provider HTTP endpoints
- Manages Ethereum transactions, piece storage/retrieval, authentication

### Contract Interaction Flow

1. **Client Operations Flow**:
   - Client signs operation with Warm Storage address
   - Calls Curio API with signature
   - Curio calls PDPVerifier with signature as extraData
   - PDPVerifier calls Warm Storage callback
   - Service contract validates signature and executes business logic

2. **Critical Data Structures**:
   - SDK's `PieceData` interface: `{ cid: PieceCID | string, rawSize: number }`
   - Contract expects just the 32-byte digest from PieceCID for operations
   - Solidity uses `Cids.Cid` struct which wraps the bytes32 digest

3. **Authentication Schema**:
   - All client operations use EIP-712 typed signatures
   - Domain separator uses Warm Storage address
   - Operations: CreateDataSet, AddPieces, ScheduleRemovals, DeleteDataSet
   - Clients sign for Warm Storage, NOT PDPVerifier
   - Service contract must have operator approval in Payments contract before creating rails

### Data Flow Patterns

#### Piece Storage Flow
1. **Client** calculates PieceCID and uploads to **Curio**
2. **Curio** stores piece and creates `pdp_piecerefs` record
3. **Client** references stored pieces when adding pieces to data sets
4. **Curio** validates piece ownership and calls **PDPVerifier**

#### Authentication Flow
1. **Client** signs operation data with private key targeting **Warm Storage**
2. **Curio** includes signature in `extraData` when calling **PDPVerifier**
3. **PDPVerifier** passes `extraData` to **Warm Storage** callback
4. **Warm Storage** validates signature and processes business logic

#### Payment Flow
1. **Warm Storage** creates payment rails during data set creation
2. Payments flow from client to service provider based on storage size and time
3. **Warm Storage** acts as arbiter for fault-based payment adjustments

### PDP Overview

1. Clients and providers establish data sets for storage verification
2. Providers add pieces (PieceCID) to data sets and submit periodic proofs
3. System verifies proofs using randomized challenges
4. All client operations use EIP-712 signatures via PDPAuthHelper

### Curio PDP API Endpoints
- `POST /pdp/data-sets` - Create new data set
- `GET /pdp/data-sets/created/{txHash}` - Check data set creation status
- `GET /pdp/data-sets/{dataSetId}` - Get data set details
- `POST /pdp/data-sets/{dataSetId}/pieces` - Add pieces to data set
- `DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}` - Schedule piece removal
- `POST /pdp/piece` - Create piece upload session
- `PUT /pdp/piece/upload/{uploadUUID}` - Upload piece data
- `GET /pdp/piece/` - Find existing pieces

This architecture enables a clean separation where PDPVerifier handles the cryptographic protocol, Warm Storage manages business logic and payments, and Curio provides the operational HTTP interface for clients.

### Storage Operations

```javascript
// Simple: auto-managed contexts
await synapse.storage.upload(data)
await synapse.storage.download(pieceCid)  // SP-agnostic

// Advanced: explicit context
const context = await synapse.storage.createContext({ providerId: 1 })
await context.upload(data)
await context.download(pieceCid)  // SP-specific
```

**Download Optimization**: StorageManager checks default context first when downloading without CDN - if piece exists there, uses fast path to avoid discovery.

## Development Environment

**Local Repository Convention**: Clone related repos as `{org-name}-{repo-name}` (e.g., `filecoin-project-curio`, `FilOzone-pdp`) in same directory as SDK for testing. Do not check in.

### Blockchain Interaction Tools

#### Using `cast` with Filecoin
- `cast` (Foundry tool) may be available for blockchain queries if needed
- **Critical**: Filecoin's `eth_call` only accepts 2 parameters: `[{to, data}, blockTag]`
- **DO NOT** use cast's default behavior which sends 3 parameters (includes state override)
- Workaround: Use `cast calldata` to generate hex, then make direct RPC calls:
  ```bash
  # Generate calldata
  cast calldata "functionName(address,uint256)" 0xaddr 123

  # Make RPC call with curl (2 params only)
  curl -X POST $RPC_URL -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"eth_call","params":[{"to":"0x...","data":"0x..."},"latest"],"id":1}'
  ```
- Decode results: `cast --to-dec 0xhexvalue` for individual values
- Common RPC endpoints:
  - Calibration: `https://api.calibration.node.glif.io/rpc/v1`
  - Mainnet: `https://api.node.glif.io/rpc/v1`

