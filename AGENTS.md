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
- `Synapse`: Main SDK entry; minimal interface with `payments` property and `createStorage()` method; strict network validation (mainnet/calibration).
- `PaymentsService`: Pure payment operations - deposits, withdrawals, balances, service approvals; no storage concerns.
- `PandoraService`: Coordinates storage operations - calculates costs, checks allowances, manages proof sets; depends on Payments and PDPVerifier.
- `StorageService`: Storage implementation with upload/download.
- `PDPVerifier/PDPServer/PDPAuthHelper`: Direct PDP protocol interactions for advanced users.

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
   - Storage costs/allowances via PandoraService (separate instantiation)
   - Strict network validation - only supports Filecoin mainnet and calibration

### File Structure
```
src/
├── browser-entry.ts            # Browser bundle entry point
├── commp/                      # CommP utilities (Piece Commitment calculations)
├── payments/                   # Payment contract interactions
│   └── service.ts              # PaymentsService (formerly SynapsePayments)
├── pandora/                    # Pandora contract interactions (storage coordination)
│   └── service.ts              # PandoraService - storage costs, allowances, proof sets
├── pdp/                        # PDP protocol implementations
│   ├── auth.ts                 # PDPAuthHelper - EIP-712 signatures
│   ├── server.ts               # PDPServer - Curio HTTP API client
│   ├── verifier.ts             # PDPVerifier - contract interactions
│   ├── download-service.ts     # PDPDownloadService - piece downloads
│   ├── upload-service.ts       # PDPUploadService - piece uploads
│   └── storage-provider.ts     # StorageProviderTool - SP operations
├── storage/                    # Storage service implementation
│   └── service.ts              # StorageService - real PDP storage implementation
├── utils/                      # Shared utilities
│   ├── constants.ts            # CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS, SIZE_CONSTANTS
│   └── errors.ts               # Error creation utilities
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

#### Token Integration
- **USDFC Addresses**: In `CONTRACT_ADDRESSES.USDFC` - mainnet (`0x80B98d3aa09ffff255c3ba4A241111Ff1262F045`) and calibration (`0xb3042734b608a1B16e9e86B374A3f3e389B4cDf0`)
- **Balance Checking**: `synapse.payments.walletBalance()` for FIL, `synapse.payments.walletBalance(TOKENS.USDFC)` for USDFC (both return bigint)
- **BigInt Support**: All token amounts use bigint to avoid floating point precision issues
- **Constants Organization**: All addresses in `CONTRACT_ADDRESSES`, all ABIs in `CONTRACT_ABIS`, tokens in `TOKENS`

#### Browser Distribution
- **UMD Bundle**: `dist/browser/synapse-sdk.js` - Works with script tags
- **Minified Bundle**: `dist/browser/synapse-sdk.min.js` - Production-optimized
- **Entry Point**: `dist/browser-entry.js` - Flattens all exports for browser use
- **External Dependencies**: ethers.js must be loaded separately (https://cdn.jsdelivr.net/npm/ethers@6/dist/ethers.umd.min.js can be used)
- **Global Variable**: `window.SynapseSDK` when loaded via script tag

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

### CommP Utilities
- Available as a separate import path: `@filoz/synapse-sdk/commp` / `src/commp`
- `calculate()`
- `asCommP()`
- `createCommPStream()` creates a WebStreams TransformStream for streaming CommP calculation without buffering

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

PandoraService (storage coordination)
   ├── Depends on PaymentsService
   └── Depends on PDPVerifier
```

### Core Contracts and Their Roles

```
┌─────────────────────────────────────────────────────────────────┐
│                     Pandora                                      │
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
- **Purpose**: The neutral, protocol-level contract that manages proof sets and verification
- **Responsibilities**:
  - Creates and manages proof sets on-chain
  - Handles adding/removing roots from proof sets
  - Performs cryptographic proof verification
  - Emits events and calls listener contracts
- **Key Functions**: `createProofSet()`, `addRoots()`, `proveRoots()`
- **Address**:
  - Calibration: `0x5A23b7df87f59A291C26A2A1d684AD03Ce9B68DC`
  - Hardcoded in Curio (`contract.ContractAddresses().PDPVerifier`)
- **Client Interaction**: Indirect (through Curio API)

#### 2. SimplePDPService (`FilOzone-pdp/src/SimplePDPService.sol`)
- Basic service implementation without payments
- Tracks proving periods and faults
- Reference implementation showing PDPListener interface

#### 3. Pandora (`FilOzone-filecoin-services/service_contracts/src/PandoraService.sol`)
- **Purpose**: The business logic layer that handles payments, authentication, and service management (SimplePDPService with payments integration)
- **Responsibilities**:
  - Validates client authentication signatures (EIP-712)
  - Manages storage provider whitelist via `registerServiceProvider()`
  - Creates payment rails on proof set creation
  - Receives callbacks from PDPVerifier via `PDPListener` interface
  - Provides pricing information via `getServicePrice()` returning both CDN and non-CDN rates
- **Address**:
  - Calibration: `0xf49ba5eaCdFD5EE3744efEdf413791935FE4D4c5`
- **Client Interaction**: Direct (for signatures) and indirect (via Curio callbacks)
- **Inheritance**: Inherits SimplePDPService, integrates Payments contract

#### 4. Payments Contract (`FilOzone-fws-payments/src/Payments.sol`)
- Generic payment infrastructure for any service
- Handles USDFC token deposits/withdrawals
- Manages payment rails between parties
- Supports operator approvals for account management
- Currently deployed version is at `0x0E690D3e60B0576D01352AB03b258115eb84A047` on calibration

#### 5. Curio Storage Provider (Service Node)
- **Purpose**: HTTP API layer that orchestrates blockchain interactions and storage operations
- **Responsibilities**:
  - Exposes REST API for PDP operations
  - Manages Ethereum transaction submission
  - Handles piece storage and retrieval
  - Provides authentication and authorization
- **Address**: HTTP endpoint (e.g., `https://curio.provider.com`)
- **Client Interaction**: Direct HTTP API calls
- **Code Location**: `pdp/handlers.go` and `pdp/handlers_upload.go` in Curio codebase (may be `./filecoin-project-curio/`)

#### 6. Client SDK (Application Layer)
- **Purpose**: Developer-friendly interface for interacting with the PDP system
- **Responsibilities**:
  - Generates cryptographic auth signatures
  - Provides high-level API abstractions
  - Handles CommP calculations and validation
  - Manages wallet and payment operations

### Contract Interaction Flow

1. **Client Operations Flow**:
   - Client signs operation with Pandora address
   - Calls Curio API with signature
   - Curio calls PDPVerifier with signature as extraData
   - PDPVerifier calls Pandora callback
   - Service contract validates signature and executes business logic

2. **Critical Data Structures**:
   ```solidity
   struct RootData {
     Cids.Cid cid;      // 32-byte CommP digest
     uint64 rawSize;    // Original data size
   }
   ```

3. **Authentication Schema**:
   - All client operations use EIP-712 typed signatures
   - Domain separator uses Pandora address
   - Operations: CreateProofSet, AddRoots, ScheduleRemovals, DeleteProofSet
   - Clients sign for Pandora, NOT PDPVerifier
   - Service contract must have operator approval in Payments contract before creating rails

### Data Flow Patterns

#### Piece Storage Flow
1. **Client** calculates CommP and uploads to **Curio**
2. **Curio** stores piece and creates `pdp_piecerefs` record
3. **Client** references stored pieces when adding roots to proof sets
4. **Curio** validates piece ownership and calls **PDPVerifier**

#### Authentication Flow
1. **Client** signs operation data with private key targeting **Pandora**
2. **Curio** includes signature in `extraData` when calling **PDPVerifier**
3. **PDPVerifier** passes `extraData` to **Pandora** callback
4. **Pandora** validates signature and processes business logic

#### Payment Flow
1. **Pandora** creates payment rails during proof set creation
2. Payments flow from client to storage provider based on storage size and time
3. **Pandora** acts as arbiter for fault-based payment adjustments

### PDP Overview

PDP is one of the paid on-chain services offered by Synapse, future services may be included in the future.

1. Clients and providers establish a proof set for data storage verification
2. Providers add data roots (identified by CommP) to the proof set at the request of clients, and submit periodic proofs
3. The system verifies these proofs using randomized challenges based on chain randomness
4. Faults are reported when proofs fail or are not submitted

All interactions with PDP contracts from clients via a PDP server (typically running Curio) use standard signed EIP-712 encoding of authentication blobs via ethers.js `signTypedData`. The SDK automatically detects whether to use MetaMask-friendly signing (for browser wallets) or standard signing (for private keys). Use PDPAuthHelper directly for signing operations.

### Curio PDP API Endpoints
- `POST /pdp/proof-sets` - Create new proof set
- `GET /pdp/proof-sets/created/{txHash}` - Check proof set creation status
- `GET /pdp/proof-sets/{proofSetId}` - Get proof set details
- `POST /pdp/proof-sets/{proofSetId}/roots` - Add roots to proof set
- `DELETE /pdp/proof-sets/{proofSetId}/roots/{rootId}` - Schedule root removal
- `POST /pdp/piece` - Create piece upload session
- `PUT /pdp/piece/upload/{uploadUUID}` - Upload piece data
- `GET /pdp/piece/` - Find existing pieces

This architecture enables a clean separation where PDPVerifier handles the cryptographic protocol, Pandora manages business logic and payments, and Curio provides the operational HTTP interface for clients.

### Download Flow Patterns

#### Direct Download (via Synapse)
1. **Client** calls `synapse.download(commp, options)`
2. **PieceRetriever** (ChainRetriever by default) queries proof sets to find providers
3. **ChainRetriever** filters for non-zero root counts, validates via `findPiece` endpoint, attempts downloads from multiple providers in parallel using Promise.race() with AbortController for efficient cancellation
4. **downloadAndValidateCommP** verifies the downloaded data matches the expected CommP

#### Provider-Specific Download (via StorageService)
1. **Client** calls `storage.providerDownload(commp)`
2. **StorageService** delegates to `synapse.download()` with `providerAddress` hint
3. **ChainRetriever** skips proof set lookup and directly queries the specified provider
4. Download and validation proceed as above

## Development Environment and External Repositories

In development environments, the following related repositories may be available locally for reference and testing. **Local Repository Naming Convention**: Repositories should be cloned with the format `{org-name}-{repo-name}` (e.g., `filecoin-project-curio`, `FilOzone-pdp`) to avoid naming conflicts and clearly identify the source organization.

### Usage Notes
- **Local Development**: If repositories are available locally with the `{org}-{repo}` naming convention, files can be accessed directly for debugging and testing. When using local development environment, expect repositories at paths like `./filecoin-project-curio/` and `./FilOzone-pdp/` cloned to the same directory as the SDK project. This allows for easy import and testing of contract interactions but they should not be checked in if they exist.
- **Remote Access**: Contract files can also be viewed via GitHub URLs when local copies aren't available

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

This document should be kept updated and curated as the SDK implementation progresses.
