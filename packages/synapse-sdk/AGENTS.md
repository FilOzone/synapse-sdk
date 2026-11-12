# Synapse SDK

High-level SDK for Filecoin Onchain Cloud, published as `@filoz/synapse-sdk`. Built on `@filoz/synapse-core` (see its `AGENTS.md` for contracts and protocol details).

**Design**: simple golden path (`Synapse` class) + composable services, all exported independently.

## Layout

```text
src/
├── synapse.ts       # Synapse class
├── types.ts         # Public types
├── storage/         # StorageManager (multi-copy orchestration), StorageContext (per-provider ops)
├── payments/        # PaymentsService (Filecoin Pay)
├── warm-storage/    # WarmStorageService (FWSS costs, allowances, data sets)
├── sp-registry/     # SPRegistryService (provider discovery)
├── filbeam/         # FilBeamService (CDN)
├── errors/          # StoreError, CommitError
├── utils/           # TOKENS, METADATA_KEYS, DEFAULT_CHAIN, SynapseError
└── test/            # Tests (mock RPC/HTTP with @filoz/synapse-core/mocks)
```

## Synapse

`Synapse.create({ account, chain?, transport?, sessionKey? })` builds a viem client; `new Synapse({ client, sessionClient? })` takes your own. Exposes `synapse.storage`, `synapse.payments`, and the other services. Amounts are always `bigint`.

## Storage

**StorageManager** (`synapse.storage`): auto-selects providers, runs the store → pull → commit pipeline, SP-agnostic downloads.

**StorageContext**: one provider + data set. Split operations `store()`, `pull()`, `commit()`, `presignForCommit()`, plus `upload()` (store + commit). Created via `StorageManager.createContexts()`.

1. **store()**: upload to the primary provider. Returns PieceCID. No on-chain state.
2. **pull()**: secondaries fetch the piece from the primary (SP-to-SP). Curio validates authorization via `estimateGas` against the EIP-712 signed blob.
3. **commit()**: AddPieces (or CreateDataSetAndAddPieces) on-chain for each provider.

`presignForCommit()` creates the signed blob before pull, so one signature authorizes both pull and commit (avoids double wallet prompts).

### Provider selection

- **Endorsed** providers are curated and always used as primary. Endorsed is a subset of **approved**, which pass automated checks and are used as secondaries.
- Default is 2 copies (1 primary + 1 secondary).
- `createContexts()` has 3 mutually exclusive paths: no options = auto-select, `dataSetIds` = use those exactly, `providerIds` = use those exactly. No mixing.

### Failure handling

`UploadResult` returns `complete`, `copies[]` (successful), and `failedAttempts[]` (intermediate failures). Check `complete` for overall success; a non-empty `failedAttempts` does not mean failure. Primary store failure throws `StoreError`; all commits failing throws `CommitError`. Both carry providerId and cause chain.

### Example

```typescript
const synapse = Synapse.create({ account: privateKeyToAccount(privateKey) })
const result = await synapse.storage.upload(data)
const bytes = await synapse.storage.download({ pieceCid: result.pieceCid })

// Split operations
const [primary, secondary] = await synapse.storage.createContexts({ copies: 2 })
const stored = await primary.store(data)
const extraData = await secondary.presignForCommit([{ pieceCid: stored.pieceCid }])
await secondary.pull({ pieces: [stored.pieceCid], from: (cid) => primary.getPieceUrl(cid), extraData })
await primary.commit({ pieces: [{ pieceCid: stored.pieceCid }] })
await secondary.commit({ pieces: [{ pieceCid: stored.pieceCid }], extraData })
```

## Session keys

```typescript
const sessionKey = SessionKey.fromSecp256k1({ chain, privateKey: sessionPrivateKey, root: account })
const synapse = Synapse.create({ account, chain, sessionKey })
// or: new Synapse({ client, sessionClient: sessionKey.client })
```

All signing (store, pull, commit, delete) uses `sessionClient ?? client`; the `payer` is always the root wallet. `Synapse.create` checks the session key has the required FWSS permissions.

## E2E

`node utils/example-storage-e2e.js <file> [file2] ...` (from the repo root) runs against calibnet, mainnet, or devnet (`NETWORK=devnet`). See `resolveConfig()` in the file for env vars. One file uses streaming upload; several files demonstrate split operations.
