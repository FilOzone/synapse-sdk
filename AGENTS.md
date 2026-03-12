# Synapse SDK

TypeScript/JavaScript SDK for Filecoin Onchain Cloud (FOC). Published as `@filoz/synapse-sdk`.

## What This Is

Primary interface for developers building on the FOC services marketplace. Abstracts contract interactions and storage provider HTTP APIs into high-level TypeScript library. Works in Node.js and browsers.

**Design**: Simple golden path (main `Synapse` class) + composable components (all services exported independently).

**Stack**: Applications → Synapse SDK → Smart contracts (FWSS, Payments, PDPVerifier, SPRegistry) + Storage providers (Curio HTTP API)

## Architecture

```text
packages/synapse-sdk/src/
├── synapse.ts                  # Main entry point (Synapse class)
├── types.ts                    # TypeScript interfaces
├── storage/
│   ├── manager.ts              # StorageManager (multi-copy upload orchestration)
│   └── context.ts              # StorageContext (per-provider store/pull/commit ops)
├── payments/service.ts         # PaymentsService (deposits, withdrawals, rails)
├── warm-storage/service.ts     # WarmStorageService (storage costs, allowances, data sets)
├── sp-registry/                # SPRegistryService (provider discovery, products)
├── filbeam/                    # FilBeamService (CDN)
├── errors/
│   ├── index.ts                # Re-exports
│   └── storage.ts              # StoreError, CommitError
└── utils/
    ├── constants.ts            # CONTRACT_ADDRESSES, CONTRACT_ABIS, TOKENS
    ├── errors.ts               # SynapseError base class
    ├── metadata.ts
    └── network.ts

packages/synapse-core/src/      # Lower-level protocol layer (separate package)
├── sp/                         # Curio HTTP API client (PDP endpoints)
│   ├── sp.ts                   # Low-level PDP API calls
│   └── pull.ts                 # SP-to-SP pull with EIP-712 signing
├── piece/                      # PieceCID utilities
├── typed-data/                 # EIP-712 signing (CreateDataSet, AddPieces, etc.)
├── warm-storage/               # Provider selection, data set matching
├── session-key/                # Session key creation and management
├── pdp-verifier/               # PDPVerifier contract reads
├── pay/                        # Filecoin Pay contract interactions
├── sp-registry/                # ServiceProviderRegistry reads
├── chains.ts                   # Chain definitions (mainnet, calibration)
├── devnet/                     # foc-devnet integration (validateDevnetInfo, toChain)
├── mocks/                      # MSW-based test mocking infrastructure
└── utils/                      # Metadata, formatting, helpers
```

**Data flow**: Client signs EIP-712 for FWSS → Curio HTTP API → PDPVerifier contract → FWSS callback → Payments contract.

## Development

**Monorepo**: pnpm workspace, packages in `packages/*`, examples in `examples/*`

**Commands**:

- Root: `pnpm run lint:fix` (Biome auto-fix all), `pnpm run build` (all packages), `pnpm test`
- Package: `pnpm run lint:fix`, `pnpm run build`, `pnpm test` (from `packages/synapse-sdk/`)

**Build**: TypeScript → `dist/` (in package), ES modules with `.js` extensions, strict mode, NodeNext resolution

**Tests**: Mocha + Chai, `src/test/`, run with `pnpm test`

**E2E**: `node utils/example-storage-e2e.js <file> [file2] ...` against calibnet or devnet. See `resolveConfig()` in the file for env vars. Single file uses streaming upload; multiple files demonstrate split operations.

## Biome Linting (Critical)

**NO** `!` operator → use `?.` or explicit checks
**NO** semicolons at line end (`semicolons: "asNeeded"`)
**MUST** use kebab-case filenames

Run `pnpm run lint:fix` before commits.

## Key Components

**Synapse** (`Synapse.create({privateKey, rpcUrl})` or `{provider}` or `{signer}`): Main entry, auto-detects network (mainnet/calibration only), minimal interface (`synapse.payments`, `synapse.storage`). Optionally accepts `sessionKey` for delegated signing.

**PaymentsService**: Deposits, withdrawals, operator approvals, payment rails. Wraps Filecoin Pay contract.

**WarmStorageService**: Storage costs, allowances, data sets. Source of all contract addresses via auto-discovery. Wraps FWSS contract.

**SPRegistryService**: Provider discovery, metadata, products. Wraps ServiceProviderRegistry contract.

**StorageManager**: Multi-copy upload orchestration. Auto-selects providers (endorsed primary + approved secondaries), manages the store → pull → commit pipeline, handles SP-agnostic downloads. Entry point: `synapse.storage`.

**StorageContext**: Represents a specific provider + data set pair. Exposes split operations (`store()`, `pull()`, `commit()`, `presignForCommit()`) for fine-grained control, plus convenience `upload()` that combines store + commit. Created via `StorageManager.createContexts()`.

**synapse-core** (`@filoz/synapse-core`): Lower-level protocol package. Contains Curio HTTP client, EIP-712 signing, provider selection logic, PieceCID utilities, session key management, chain definitions, and test mocking infrastructure. Versions independently from synapse-sdk.

## Multi-Copy Upload Flow

Storage uses a store → pull → commit pipeline for multi-copy durability:

```text
Client ──store──> Primary SP (endorsed)
                    │
         ┌─────────┴─────────┐
         ▼                   ▼
      Secondary SP        Secondary SP
       (pull from          (pull from
        primary)            primary)
         │                   │
         ▼                   ▼
      commit()            commit()
      (on-chain)          (on-chain)
```

1. **store()**: Upload data to primary provider. Returns PieceCID. No on-chain state.
2. **pull()**: Secondary providers fetch the piece from primary via SP-to-SP transfer. Curio validates authorization via `estimateGas` against the EIP-712 signed blob.
3. **commit()**: Call AddPieces (or CreateDataSetAndAddPieces) on-chain for each provider.

**presignForCommit()** creates the EIP-712 signed blob before pull, so the same signature serves as authorization for both the pull (SP validates via estimateGas) and the commit (on-chain submission). Avoids double wallet prompts.

### Provider Selection

- **Endorsed** providers: curated, high-quality SPs. Always used as primary.
- **Approved** providers: pass automated quality checks. Used as secondaries.
- Endorsed is a subset of approved. Default count is 2 (1 primary + 1 secondary).
- `createContexts()` has 3 mutually exclusive paths: (1) no options = auto-select, (2) `dataSetIds` = use those exactly, (3) `providerIds` = use those exactly. No mixing.

### Failure Handling

`UploadResult` returns `complete` (boolean), `copies[]` (successful), and `failedAttempts[]` (intermediate failures). Check `complete` to determine overall success -- do not use `failedAttempts.length` as a failure signal. Primary store failure throws `StoreError`; all commits failing throws `CommitError`. Both carry providerId and cause chain.

## Session Keys

Session keys allow delegated signing without exposing the main wallet. Created via `@filoz/synapse-core/session-key`.

```typescript
import * as SessionKey from '@filoz/synapse-core/session-key'

const sessionKey = SessionKey.fromSecp256k1({
  chain: calibration,
  privateKey: sessionPrivateKey,
  root: client.account,
})
const synapse = new Synapse({ client, sessionClient: sessionKey.client })
```

All signing operations (store, pull, commit, delete) use `sessionClient ?? client` internally. The `payer` address always remains the root wallet.

## Contract Architecture

**Base**: Filecoin Pay - generic payment rails (deposits, withdrawals, operator approvals)

**Service**: FilecoinWarmStorageService (FWSS) - client auth (EIP-712), provider whitelist, payment rail creation, implements PDPListener callbacks. Split into main contract (write ops) + StateView contract (read ops).

**Protocol**: PDPVerifier - neutral proof verification, no business logic, delegates to service contracts via callbacks. Curio only talks to PDPVerifier.

**Discovery**: ServiceProviderRegistry - provider registration, metadata, products.

**Flow**: Client signs for FWSS → Curio includes signature in extraData when calling PDPVerifier → PDPVerifier calls FWSS callback → FWSS validates signature + manages payments.

## PieceCID (Critical)

Filecoin's content-addressed identifier for data pieces. Format: `uvarint padding | uint8 height | 32-byte piece data`.

**Last 32 bytes** = root of binary merkle tree. Contracts expect **32-byte digest only**, not full CID.

Extract digest: `digest.bytes.subarray(digest.bytes.length - 32)`

**Utilities** (`@filoz/synapse-core/piece`): `calculate()`, `asPieceCID()`, `asLegacyPieceCID()`, `createPieceCIDStream()`

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
// Simple: auto-managed multi-copy upload
const synapse = await Synapse.create({ privateKey, rpcUrl })
const result = await synapse.storage.upload(data)
// result.complete === true means all requested copies succeeded
// result.copies = [{ providerId, dataSetId, pieceId, role: 'primary'|'secondary' }]
// result.failedAttempts = [{ providerId, error, role }] (non-empty does NOT mean failure)

// Download (SP-agnostic, tries all known providers)
const bytes = await synapse.storage.download({ pieceCid })

// Explicit contexts for fine-grained control
const [primary, secondary] = await synapse.storage.createContexts({ copies: 2 })
const stored = await primary.store(data)            // Upload, get PieceCID
const extraData = await secondary.presignForCommit([{ pieceCid: stored.pieceCid }])
await secondary.pull({                               // SP-to-SP transfer
  pieces: [stored.pieceCid],
  from: (cid) => primary.getPieceUrl(cid),
  extraData,
})
await primary.commit({ pieces: [{ pieceCid: stored.pieceCid }] })
await secondary.commit({ pieces: [{ pieceCid: stored.pieceCid }], extraData })
```

## Curio PDP API

Endpoints on Curio's PDP HTTP API, called by synapse-core's SP client (`@filoz/synapse-core/sp`):

- `POST /pdp/data-sets` - Create data set
- `POST /pdp/data-sets/create-and-add` - Create data set and add pieces (primary path)
- `GET /pdp/data-sets/created/{txHash}` - Poll data set creation status
- `GET /pdp/data-sets/{dataSetId}` - Get data set details
- `DELETE /pdp/data-sets/{dataSetId}` - Delete data set
- `POST /pdp/data-sets/{dataSetId}/pieces` - Add pieces to existing data set
- `GET /pdp/data-sets/{dataSetId}/pieces/added/{txHash}` - Poll piece addition status
- `GET /pdp/data-sets/{dataSetId}/pieces/{pieceId}` - Get piece details
- `DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}` - Schedule piece removal
- `POST /pdp/piece` - Create upload session (legacy)
- `PUT /pdp/piece/upload/{uploadUUID}` - Upload piece data (legacy)
- `POST /pdp/piece/uploads` - Create streaming upload session
- `PUT /pdp/piece/uploads/{uploadUUID}` - Stream piece data
- `POST /pdp/piece/uploads/{uploadUUID}` - Finalize streaming upload
- `GET /pdp/piece/` - Find piece by PieceCID
- `GET /pdp/piece/{pieceCid}/status` - Piece indexing/IPNI status
- `POST /pdp/piece/pull` - Pull piece from another SP (idempotent, doubles as status poll)
- `GET /pdp/ping` - Health check

## Conventional Commits

Auto-publishing enabled. `feat:` → minor bump, `fix:`/`chore:`/`docs:`/`test:` → patch bump. AVOID `!` or `BREAKING CHANGE` (pre-v1).

Format: `<type>(<scope>): <description>`

Only commit when explicitly asked. Draft messages for user review.

## Blockchain Tools

**RPC endpoints**: Calibration `https://api.calibration.node.glif.io/rpc/v1`, Mainnet `https://api.node.glif.io/rpc/v1`

## Developing examples CLI

Run typescript files in `examples/cli` directory directly using `node`, e.g. `node examples/cli/src/index.ts`. Do not use wrappers like `tsx`.

Remember to rebuild dependencies before running any `examples/cli` commands if you made changes to `packages/*` files.
