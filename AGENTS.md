# Synapse SDK

TypeScript/JavaScript SDK for Filecoin Onchain Cloud (FOC). Published as `@filoz/synapse-sdk`.

## What This Is

Primary interface for developers building on the FOC services marketplace. Abstracts contract interactions and storage provider HTTP APIs into high-level TypeScript library. Works in Node.js and browsers.

**Design**: Simple golden path (main `Synapse` class) + composable components (all services exported independently).

**Stack**: Applications → Synapse SDK → Smart contracts (FWSS, Payments, PDPVerifier, SPRegistry) + Storage providers (Curio HTTP API)

## Architecture

```
packages/synapse-sdk/src/
├── synapse.ts                  # Main entry point
├── types.ts                    # TypeScript interfaces
├── payments/service.ts         # PaymentsService (deposits, withdrawals, rails)
├── warm-storage/service.ts     # WarmStorageService (storage costs, allowances, data sets)
├── sp-registry/                # SPRegistryService (provider discovery, products)
├── storage/
│   ├── manager.ts              # StorageManager (auto-managed contexts)
│   └── context.ts              # StorageContext (explicit provider+dataset ops)
├── pdp/
│   ├── auth.ts                 # PDPAuthHelper (EIP-712 signatures)
│   ├── server.ts               # PDPServer (Curio HTTP client)
│   └── verifier.ts             # PDPVerifier (contract wrapper)
├── piece/                      # PieceCID utilities
├── session/                    # Session key support
├── subgraph/                   # Subgraph queries
├── retriever/                  # Content retrieval
└── utils/
    ├── constants.ts            # CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS
    ├── errors.ts
    ├── metadata.ts
    ├── network.ts
    └── provider-resolver.ts
```

**Data flow**: Client signs for FWSS → Curio HTTP API → PDPVerifier contract → FWSS callback → Payments contract.

## Development

**Monorepo**: pnpm workspace, packages in `packages/*`, examples in `examples/*`

**Commands**:
- Root: `pnpm run fix` (Biome auto-fix all), `pnpm run build` (all packages), `pnpm test`
- Package: `pnpm run lint:fix`, `pnpm run build`, `pnpm test` (from `packages/synapse-sdk/`)

**Build**: TypeScript → `dist/` (in package), ES modules with `.js` extensions, strict mode, NodeNext resolution

**Tests**: Mocha + Chai, `src/test/`, run with `pnpm test`

## Biome Linting (Critical)

**NO** `!` operator → use `?.` or explicit checks
**MUST** use `.js` extensions in imports (`import {x} from './y.js'` even for .ts)
**NO** semicolons at line end (`semicolons: "asNeeded"`)
**MUST** use kebab-case filenames

Run `pnpm run fix` before commits.

## Key Components

**Synapse** (`Synapse.create({privateKey, rpcUrl})` or `{provider}` or `{signer}`): Main entry, auto-detects network (mainnet/calibration only), minimal interface (`synapse.payments`, `synapse.storage`).

**PaymentsService**: Deposits, withdrawals, operator approvals, payment rails. Wraps Payments contract.

**WarmStorageService**: Storage costs, allowances, data sets. Source of all contract addresses via auto-discovery. Wraps FWSS contract.

**SPRegistryService**: Provider discovery, metadata, products. Wraps ServiceProviderRegistry contract.

**StorageManager**: High-level storage ops with auto-managed contexts, SP-agnostic downloads.

**StorageContext**: Explicit provider+dataset operations with metadata.

**PDPServer**: HTTP client for Curio PDP API (`POST /pdp/data-sets`, `POST /pdp/piece`, etc.).

**PDPAuthHelper**: EIP-712 signature creation for operations (CreateDataSet, AddPieces, ScheduleRemovals, DeleteDataSet).

## Contract Architecture

**Base**: :"Filecoin Pay" payments contract (generic payment rails, deposits, withdrawals, operator approvals)

**Service**: FilecoinWarmStorageService (FWSS) - client auth (EIP-712), provider whitelist, payment rail creation, implements PDPListener callbacks. Split into main contract (write ops) + StateView contract (read ops).

**Protocol**: PDPVerifier - neutral proof verification, no business logic, delegates to service contracts via callbacks. Curio only talks to PDPVerifier.

**Discovery**: ServiceProviderRegistry - provider registration, metadata, products.

**Flow**: Client signs for FWSS → Curio includes signature in extraData when calling PDPVerifier → PDPVerifier calls FWSS callback → FWSS validates signature + manages payments.

## PieceCID (Critical)

Filecoin's content-addressed identifier for data pieces. Format: `uvarint padding | uint8 height | 32-byte piece data`.

**Last 32 bytes** = root of binary merkle tree. Contracts expect **32-byte digest only**, not full CID.

Extract digest: `digest.bytes.subarray(digest.bytes.length - 32)`

**Utilities** (`@filoz/synapse-sdk/piece`): `calculate()`, `asPieceCID()`, `asLegacyPieceCID()`, `createPieceCIDStream()`

Ref: FRC-0069

## Metadata System

**User-facing**: `Record<string, string>` (e.g., `{category: 'videos', withCDN: ''}`)

**Internal**: `MetadataEntry[]` (alphabetically sorted for EIP-712)

**Validation**: Data sets max 10 keys, pieces max 5 keys, keys max 32 chars, values max 128 chars. Validated early in PDPServer.

**Security**: Uses `Object.create(null)` for prototype-safe objects from contracts.

## Critical Rules

**Environment agnostic**: NO `Buffer`, `fs`, `path`, `process` in core code. Use `toHex` from `multiformats/bytes`, web standard APIs (`fetch`, WebStreams).

**Wallet integration**: Exactly one of `privateKey`, `provider`, or `signer` required. Uses NonceManager by default.

**Contract addresses**: Auto-discovered from network via Multicall3. WarmStorage address is entry point, all others discovered from it.

**Tokens**: USDFC (auto-discovered), FIL (native). All amounts use `bigint`.

**Network**: Auto-detected from chainId. Only mainnet and calibration supported. Filecoin has a block time of 30 seconds, be patient.

## Storage API

```typescript
// Simple: auto-managed
const synapse = await Synapse.create({privateKey, rpcUrl})
await synapse.storage.upload(data)
await synapse.storage.download(pieceCid)  // SP-agnostic

// Advanced: explicit context
const ctx = await synapse.storage.createContext({
  providerId: 1,
  metadata: {category: 'videos', withCDN: ''}
})
await ctx.upload(data)
await ctx.download(pieceCid)  // SP-specific
```

## Curio PDP API

- `POST /pdp/data-sets` - Create data set
- `GET /pdp/data-sets/created/{txHash}` - Check creation status
- `GET /pdp/data-sets/{dataSetId}` - Get details
- `POST /pdp/data-sets/{dataSetId}/pieces` - Add pieces
- `DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}` - Schedule removal
- `POST /pdp/piece` - Create upload session
- `PUT /pdp/piece/upload/{uploadUUID}` - Upload piece data
- `GET /pdp/piece/` - Find pieces

## Conventional Commits

Auto-publishing enabled. `feat:` → minor bump, `fix:`/`chore:`/`docs:`/`test:` → patch bump. AVOID `!` or `BREAKING CHANGE` (pre-v1).

Format: `<type>(<scope>): <description>`

Only commit when explicitly asked. Draft messages for user review.

## Blockchain Tools

**RPC endpoints**: Calibration `https://api.calibration.node.glif.io/rpc/v1`, Mainnet `https://api.node.glif.io/rpc/v1`
