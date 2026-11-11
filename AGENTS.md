# Synapse SDK

TypeScript/JavaScript SDK for Filecoin Onchain Cloud (FOC). Published as `@filoz/synapse-sdk`. Works in Node.js and browsers.

**Design**: Simple golden path (main `Synapse` class) + composable components (all services exported independently).

**Stack**: Applications → Synapse SDK → synapse-core → Smart contracts (FWSS, Filecoin Pay, PDPVerifier, SPRegistry) + Storage providers (Curio HTTP API)

**Data flow**: Client signs EIP-712 for FWSS → Curio HTTP API → PDPVerifier contract → FWSS callback → Filecoin Pay contract.

## Packages

| Package | Purpose |
| --- | --- |
| `packages/synapse-sdk` | High-level SDK (`Synapse`, `StorageManager`, services) |
| `packages/synapse-core` | Lower-level protocol layer: viem actions per contract, Curio HTTP client, EIP-712, PieceCID, session keys, chains, MSW mocks. See its `AGENTS.md` |
| `packages/synapse-react` | React hooks |
| `packages/keysmith` | Deterministic key derivation for encryption |
| `packages/filecoin-encryption-envelope` | FIP-1253 encryption envelope. See its `AGENTS.md` |
| `examples/*`, `apps/*`, `docs/` | CLI and script-tag examples, playground app, docs site |

Packages version independently. Check for a package-level `AGENTS.md` before working in a package.

### synapse-sdk layout

```text
packages/synapse-sdk/src/
├── synapse.ts            # Synapse class
├── types.ts              # Public types
├── storage/              # StorageManager (multi-copy orchestration), StorageContext (per-provider ops)
├── payments/             # PaymentsService
├── warm-storage/         # WarmStorageService
├── sp-registry/          # SPRegistryService
├── filbeam/              # FilBeamService (CDN)
├── errors/               # StoreError, CommitError
├── utils/                # TOKENS, METADATA_KEYS, DEFAULT_CHAIN, SynapseError
└── test/                 # Tests
```

### synapse-core layout

One folder per domain, one file per action: `sp/` (Curio HTTP API), `warm-storage/`, `pay/`, `pdp-verifier/`, `sp-registry/`, `session-key/`, `piece/`, `typed-data/`, `erc20/`, `endorsements/`, `auction/`, `devnet/`, `mocks/`, `utils/`, `abis/`, `chains.ts`. Tests live in `packages/synapse-core/test/`.

## Development

**Monorepo**: pnpm workspace. Node ≥22 (`devEngines` pins ^24).

**Commands** (root or package dir): `pnpm run build`, `pnpm run lint:fix` (Biome), `pnpm test`. Inside a package, `pnpm test:node` / `pnpm test:browser` run one environment.

**Build**: TypeScript → `dist/`, ES modules, strict mode, NodeNext resolution. Scripts use wireit, which skips scripts whose inputs haven't changed; `pnpm run clean:cache` forces a rerun.

**Tests**: `playwright-test` with Mocha + Chai, run in Node and browser. Mock RPC/HTTP with `@filoz/synapse-core/mocks`.

**E2E**: `node utils/example-storage-e2e.js <file> [file2] ...` against calibnet, mainnet or devnet (`NETWORK=devnet`). See `resolveConfig()` in the file for env vars. Single file uses streaming upload; multiple files demonstrate split operations.

**Examples CLI**: run directly with `node examples/cli/src/index.ts` (no `tsx`). Rebuild packages first if you changed `packages/*`.

## Critical Rules

- **Biome**: no `!` non-null assertions (use `?.` or explicit checks), no trailing semicolons, kebab-case filenames. Run `pnpm run lint:fix` before commits.
- **Environment agnostic**: no `Buffer`, `fs`, `path`, `process` in package source. Use web standard APIs (`fetch`, WebStreams, `Uint8Array`).
- **Amounts**: always `bigint`. Tokens: USDFC and FIL.
- **Chains**: mainnet, calibration, and devnet (via `@filoz/synapse-core/devnet`). Contract addresses come from the chain definitions in `synapse-core/src/chains.ts`. Filecoin block time is 30 seconds, be patient.

## Key Components

**Synapse**: `Synapse.create({ account, chain?, transport?, sessionKey? })` builds a viem client, or `new Synapse({ client, sessionClient? })` with your own. Exposes `synapse.storage`, `synapse.payments`, and the other services.

**StorageManager** (`synapse.storage`): auto-selects providers, runs the store → pull → commit pipeline, SP-agnostic downloads.

**StorageContext**: one provider + data set. Split operations `store()`, `pull()`, `commit()`, `presignForCommit()`, plus `upload()` (store + commit). Created via `StorageManager.createContexts()`.

**PaymentsService** (Filecoin Pay), **WarmStorageService** (FWSS costs, allowances, data sets), **SPRegistryService** (provider discovery), **FilBeamService** (CDN).

## Multi-Copy Upload Flow

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
2. **pull()**: Secondaries fetch the piece from primary via SP-to-SP transfer. Curio validates authorization via `estimateGas` against the EIP-712 signed blob.
3. **commit()**: AddPieces (or CreateDataSetAndAddPieces) on-chain for each provider.

**presignForCommit()** creates the signed blob before pull, so one signature authorizes both pull and commit (avoids double wallet prompts).

### Provider Selection

- **Endorsed** providers: curated SPs, always used as primary. Endorsed is a subset of approved.
- **Approved** providers: pass automated quality checks, used as secondaries.
- Default is 2 copies (1 primary + 1 secondary).
- `createContexts()` has 3 mutually exclusive paths: no options = auto-select, `dataSetIds` = use those exactly, `providerIds` = use those exactly. No mixing.

### Failure Handling

`UploadResult` returns `complete` (boolean), `copies[]` (successful), and `failedAttempts[]` (intermediate failures). Check `complete` for overall success; do not use `failedAttempts.length` as a failure signal. Primary store failure throws `StoreError`; all commits failing throws `CommitError`. Both carry providerId and cause chain.

## Storage API

```typescript
import { Synapse } from '@filoz/synapse-sdk'
import { privateKeyToAccount } from 'viem/accounts'

const synapse = Synapse.create({ account: privateKeyToAccount(privateKey) })
const result = await synapse.storage.upload(data)
// result.complete === true means all requested copies succeeded
// result.copies = [{ providerId, dataSetId, pieceId, role: 'primary'|'secondary' }]
// result.failedAttempts = [{ providerId, error, role }] (non-empty does NOT mean failure)

// Download (SP-agnostic, tries all known providers)
const bytes = await synapse.storage.download({ pieceCid })

// Explicit contexts for fine-grained control
const [primary, secondary] = await synapse.storage.createContexts({ copies: 2 })
const stored = await primary.store(data)
const extraData = await secondary.presignForCommit([{ pieceCid: stored.pieceCid }])
await secondary.pull({
  pieces: [stored.pieceCid],
  from: (cid) => primary.getPieceUrl(cid),
  extraData,
})
await primary.commit({ pieces: [{ pieceCid: stored.pieceCid }] })
await secondary.commit({ pieces: [{ pieceCid: stored.pieceCid }], extraData })
```

## Session Keys

Delegated signing without exposing the main wallet, via `@filoz/synapse-core/session-key`.

```typescript
import * as SessionKey from '@filoz/synapse-core/session-key'

const sessionKey = SessionKey.fromSecp256k1({ chain, privateKey: sessionPrivateKey, root: account })
const synapse = Synapse.create({ account, chain, sessionKey })
// or: new Synapse({ client, sessionClient: sessionKey.client })
```

All signing operations (store, pull, commit, delete) use `sessionClient ?? client`. The `payer` is always the root wallet. `Synapse.create` checks the session key has the required FWSS permissions.

## Contracts

- **Filecoin Pay**: generic payment rails (deposits, withdrawals, operator approvals).
- **FWSS** (FilecoinWarmStorageService): client auth (EIP-712), provider whitelist, rail creation, PDPListener callbacks. Split into main contract (writes) + StateView (reads).
- **PDPVerifier**: neutral proof verification, delegates to service contracts via callbacks. Curio only talks to PDPVerifier.
- **ServiceProviderRegistry**: provider registration, metadata, products.

See `packages/synapse-core/AGENTS.md` for contract links and action conventions.

## PieceCID

Contracts expect the **32-byte digest only**, not the full CID: `digest.bytes.subarray(digest.bytes.length - 32)`. Utilities in `@filoz/synapse-core/piece`: `calculate()`, `asPieceCID()`, `asLegacyPieceCID()`, `createPieceCIDStream()`. Ref: FRC-0069.

## Metadata

User-facing `Record<string, string>` (e.g. `{ category: 'videos', withCDN: '' }`), internally `MetadataEntry[]` sorted alphabetically for EIP-712. Limits (`synapse-core/src/utils/metadata.ts`): data sets max 10 keys, pieces max 3 keys, keys max 32 chars, values max 96 chars. Use `Object.create(null)` for objects built from contract data.

## Commits

Conventional Commits drive release-please; see [CONTRIBUTING](.github/CONTRIBUTING.md#how-should-i-write-my-commits). Format `<type>(<scope>): <description>`. Mark breaking changes with `!`.

Only commit when explicitly asked. Draft messages for user review.
