---
title: Migration Guide
description: Learn how to migrate to newer versions of the SDK.
sidebar: 
  order: 100
---

If you are coming from an earlier version of any of the Synapse packages, you will need to make sure to update the APIs listed below.

---

## synapse-sdk 2.0.0

This release changes upload cost inputs, enables automatic piece batching, and removes the piece metadata getters deprecated in 1.2.1. If you use core actions directly, also follow [synapse-core 0.9.0](#synapse-core-090).

### Action: Use new data sets for compact storage

PDPVerifier 3.5.0 introduces compact piece storage for data sets created after the network's migration. Existing data sets keep their legacy format permanently, including newly appended pieces; neither the contract upgrade nor the SDK migrates them automatically.

Read [Larger, Cheaper Storage Batches](/developer-guides/storage/storage-upgrade/) for gas savings, batching, and how to explicitly direct future uploads to new data sets. Reuse the new data sets after switching; changing application metadata is optional.

### Action: Pass exact piece sizes to upload cost APIs

Replace `dataSize` with `pieceSizes` in `storage.prepare()`, `storage.calculateMultiContextCosts()`, and `storage.getUploadCosts()`. Remove `pieceCount` from `getUploadCosts()` calls: the number of pieces is now the array length.

```ts
// before: one piece
await synapse.storage.prepare({ dataSize })

// after: one piece
await synapse.storage.prepare({ pieceSizes: [dataSize] })

// after: multiple pieces, with the same pieces uploaded to every context
const pieceSizes = files.map((file) => BigInt(file.size))
await synapse.storage.prepare({ context: contexts, pieceSizes })
```

Supply each piece's exact raw payload size as a `bigint`. Do not replace a multi-piece upload with `[totalSize]`: each piece is rounded independently to PDP leaves and incurs operation fees. Empty arrays and non-positive sizes are rejected.

When passing precomputed `costs` to `prepare()`, calculate them for the exact contexts and piece sizes. Use `calculateMultiContextCosts(contexts, { pieceSizes })` for multiple copies; `getUploadCosts()` estimates only one context.

### Action: Supply existing data-set state when estimating costs

For `storage.getUploadCosts({ isNewDataSet: false, ... })`, replace `currentDataSetSize` with `dataSetLeafCount` and supply `currentLifecycleReserveBalance` and `pdpEndEpoch`. All three fields are required. Include `pendingOneTimePayments` when fees are pending; it defaults to `0n`.

```ts
import { getDataSetLeafCount } from '@filoz/synapse-core/pdp-verifier'
import { getDataSet } from '@filoz/synapse-core/warm-storage'

const [dataSet, dataSetLeafCount] = await Promise.all([
  getDataSet(synapse.readClient, { dataSetId }),
  getDataSetLeafCount(synapse.readClient, { dataSetId }),
])
if (dataSet == null) throw new Error('Data set not found')

const costs = await synapse.storage.getUploadCosts({
  isNewDataSet: false,
  pieceSizes,
  dataSetLeafCount,
  currentLifecycleReserveBalance: dataSet.lifecycleReserveBalance,
  pendingOneTimePayments: dataSet.pendingOneTimePayments,
  pdpEndEpoch: dataSet.pdpEndEpoch,
})
```

Missing required state throws `ValidationError`. A non-zero `pdpEndEpoch` throws `ServiceAlreadyTerminatedError`, since the data set can no longer accept uploads.

To have the SDK read this state for you, use `storage.prepare({ context, pieceSizes })` or `storage.calculateMultiContextCosts(contexts, { pieceSizes })`. `DataSetInfo` now includes the required `pendingOneTimePayments` and `lifecycleReserveBalance` fields; update any typed fixtures or adapters that construct it.

### Action: Use the reserve-aware funding result

Use `costs.depositNeeded` for the amount to fund. Operation fees are paid from the lifecycle reserve and are no longer added directly to the deposit. Funding includes the initial reserve for a new data set and any replenishment required as pending fees drain the reserve. Do not add `costs.fees.total` to `depositNeeded`.

The lockup breakdown now includes `lockups.reserveReplenishment` and `lockups.rateDeltaPerEpoch`. Include replenishment when displaying the components of `lockups.total`. Fee and reserve estimates conservatively treat each supplied piece as a separate add-pieces operation; actual batched fees can be lower. See [Storage Costs](/developer-guides/storage/storage-costs/) for the funding model.

### Action: Account for automatic upload batching

`storage.upload()` and `StorageContext.upload()` now batch compatible concurrent uploads by default. Uploads to the same provider and data set can share a transaction, so multiple upload callbacks may report the same transaction hash. Each upload still returns its own result; check `complete` on each result.

The default wait is `{ kind: 'delay', ms: 0 }`: the batch is submitted after a zero-delay window once its uploads and pulls finish parking. Start uploads concurrently to let them join a batch. Sequentially awaiting each upload prevents them from sharing a batch.

To preserve the previous upload path, disable batching when creating the SDK:

```ts
import { Synapse } from '@filoz/synapse-sdk'

const synapse = Synapse.create({ account, source: 'my-app', pieceBatching: false })
// With an existing client:
const fromClient = new Synapse({ client, source: 'my-app', pieceBatching: false })
```

If you select limiter mode, start the uploads before flushing. A pending batch waits until the next piece would exceed the count or message-size limit, or until you call `storage.flush()`:

```ts
const synapse = Synapse.create({
  account,
  source: 'my-app',
  pieceBatching: { wait: { kind: 'limiter' } },
})

const resultsPromise = Promise.allSettled(
  files.map((file) => synapse.storage.upload(file.stream()))
)
await synapse.storage.flush()
const results = await resultsPromise
```

`flush()` waits for accepted uploads and pulls to finish parking, then submits their pending batches. It does not establish that every upload succeeded or was confirmed. Inspect the settled results for rejections and check `complete` on fulfilled upload results. Awaiting an upload before flushing in limiter mode can leave it waiting indefinitely.

Batched secondary pulls sign their per-piece authorization separately from the eventual commit batch. Interactive wallets can therefore prompt again at commit time. Use `pieceBatching: false` or the [split operations](/developer-guides/storage/upload-pipeline/#split-operations) with the same presigned `extraData` for pull and commit when you need signature reuse.

### Action: Replace SDK piece metadata reads

Newly added piece metadata is no longer stored in FWSS contract state, including additions to existing data sets. Upload and commit options still accept metadata, which is validated, signed, and emitted in `PieceAdded` events.

`WarmStorageService.getPieceMetadata()` and `getPieceMetadataByKey()` were deprecated in 1.2.1 and are removed in 2.0.0. Read piece metadata from FWSS `PieceAdded` events or an indexer.

For React integrations using the updated core, each data set returned by `useDataSets()` now has a `pieces: Piece[]` array whose items have no `metadata` field. Update components that read `piece.metadata` to use event or indexer data. See the [core metadata migration](#action-replace-core-piece-metadata-reads) for the removed actions and replacement types.

---

## synapse-core 0.9.0

This release changes cost calculations and batch validation, and removes the piece metadata APIs deprecated in 0.8.1.

### Action: Update core cost inputs and funding calculations

The following APIs from `@filoz/synapse-core/warm-storage` now require exact raw piece sizes:

| API | Input changes |
| --- | --- |
| `getUploadCosts()` | Replace `dataSize` and `pieceCount` with `pieceSizes`; replace `currentDataSetSize` with `dataSetLeafCount` |
| `calculateDepositNeeded()` | Replace `dataSize` and `pieceCount` with `pieceSizes`; replace `currentDataSetSize` with `dataSetLeafCount` |
| `calculateAdditionalLockupRequired()` | Replace `dataSize` with `pieceSizes` and `currentDataSetSize` with `dataSetLeafCount` |
| `calculateUploadFees()` | Replace `pieceCount` with `pieceSizes` |

`pieceSizes` must be a non-empty array of positive `bigint` byte sizes. Supply every piece separately, rather than a combined size. For the pure helpers that require `dataSetLeafCount`, use `0n` for new data sets.

For existing data sets, `getUploadCosts()` and `calculateDepositNeeded()` require `dataSetLeafCount`, `currentLifecycleReserveBalance`, and `pdpEndEpoch`. Pass `pendingOneTimePayments` when fees are pending. Missing state throws `ValidationError`; a non-zero `pdpEndEpoch` throws `ServiceAlreadyTerminatedError`. Read this state as shown in the [SDK cost example](#action-supply-existing-data-set-state-when-estimating-costs), and include `clientAddress` when calling the core action:

```ts
import { getUploadCosts } from '@filoz/synapse-core/warm-storage'

const costs = await getUploadCosts(client, {
  clientAddress,
  isNewDataSet: true,
  pieceSizes: [1_000_000n, 2_000_000n],
})
```

Deposit calculations now fund lifecycle-reserve creation and replenishment instead of adding operation fees directly to the deposit. `calculateDepositNeeded()` exposes `lockup.reserveReplenishment`; `getUploadCosts()` exposes `lockups.reserveReplenishment` and `lockups.rateDeltaPerEpoch`. Fee and replenishment estimates price each piece as its own operation, so actual batching can cost less.

For custom cost calculations, use `calculateUploadCosts()` from `@filoz/synapse-core/utils` with resolved context, price-list, and account state. It aggregates context costs and applies account debt, available funds, runway, and buffer once. `calculateAdditionalLockupRequired()` alone does not calculate reserve replenishment; use `calculateLifecycleReserveFunding()` from `/warm-storage` if composing the individual helpers.

### Action: Rename and relocate runway and buffer helpers

The old helpers were removed from `@filoz/synapse-core/warm-storage`. Their replacements keep the same input fields and are exported from `@filoz/synapse-core/utils`:

| Removed export | Replacement export |
| --- | --- |
| `calculateRunwayAmount` | `calculateRunwayAmountFromState` |
| `calculateBufferAmount` | `calculateBufferAmountFromState` |
| `calculateRunwayAmount.ParamsType` | `CalculateRunwayAmountFromStateOptions` |
| `calculateBufferAmount.ParamsType` | `CalculateBufferAmountFromStateOptions` |

```ts
import {
  calculateBufferAmountFromState,
  calculateRunwayAmountFromState,
} from '@filoz/synapse-core/utils'
```

### Action: Replace data-set byte reads with leaf counts

`getDataSetSizes()` was removed from `@filoz/synapse-core/pdp-verifier`. Use `getDataSetLeafCounts()`, which returns a `Map<bigint, bigint>` keyed by data-set ID instead of a byte-size array ordered like the input. Duplicate IDs are read once, and non-live data sets have a leaf count of `0n`.

```ts
import { getDataSetLeafCounts } from '@filoz/synapse-core/pdp-verifier'
import { leafCountToRawSize } from '@filoz/synapse-core/utils'

const leafCounts = await getDataSetLeafCounts(client, { dataSetIds })
for (const [dataSetId, leafCount] of leafCounts) {
  console.log(dataSetId, leafCountToRawSize(leafCount))
}
```

Pass leaf counts directly to the new cost inputs. For custom rate calculations, combine the existing data-set leaf count with `pieceSizesToLeafCount(pieceSizes)`, then call `leafCountToRawSize()` once on that total before passing it to `calculateEffectiveRate({ sizeInBytes, ... })`. This preserves per-piece leaf rounding and the contract's aggregate conversion order.

`leafCountToRawSize()` converts leaves using `leafCount × 32 × 127 / 128`, rounded down. `getAccountTotalStorageSize().totalSizeBytes` now sums these FWSS-priced approximate sizes per live data set, replacing the previous padded-byte calculation. Use exact piece payload sizes for application accounting; this pricing approximation is not an exact sum of uploaded bytes.

### Action: Replace count-only batch validation

`validateAddPiecesBatch(count)` was removed from `@filoz/synapse-core/sp`. Use `assertAddPiecesFit()` with actual PieceCIDs and metadata:

```ts
import { assertAddPiecesFit } from '@filoz/synapse-core/sp'

// Existing data set
assertAddPiecesFit({ kind: 'addPieces', pieces })

// New data set: include its metadata and CDN setting in the size estimate
assertAddPiecesFit({
  kind: 'createDataSetAndAddPieces',
  pieces,
  metadata: dataSetMetadata,
  cdn: withCDN,
})
```

Each piece uses `{ pieceCid, metadata? }`. Validation enforces both the temporary **40-piece cap** and the encoded message-size budget (`SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE`). Metadata can make a batch exceed the byte budget even within the count cap. Automatic batching splits pending pieces into fitting batches; explicit `commit()` and core add-pieces calls require callers to split oversized batches themselves.

Update error handling: oversized batches now throw `AddPiecesBatchTooLargeError` instead of `TooManyPiecesError`. PieceCIDs outside Curio's upload-size bounds throw `InvalidUploadSizeError`; empty batches still throw `AtLeastOnePieceRequiredError`. These checks also apply to SDK `commit()`, `presignForCommit()`, and `pull()`.

Use `addPiecesFits()` for a boolean count/message-size check when constructing batches. Use `assertAddPiecesFit()` when you also need PieceCID upload-size validation.

### Action: Replace core piece metadata reads

The following APIs were deprecated in 0.8.1 and are removed in 0.9.0:

- `getAllPieceMetadata()`, `getAllPieceMetadataCall()`, and `parseAllPieceMetadata()` from `@filoz/synapse-core/warm-storage`
- `getPiecesWithMetadata()` from `@filoz/synapse-core/pdp-verifier`
- `PieceWithMetadata` from `@filoz/synapse-core/warm-storage`

Replace `getPiecesWithMetadata()` with `getPieces()` using the same options and page handling, and replace the `PieceWithMetadata` type with `Piece`:

```ts
import { getPieces } from '@filoz/synapse-core/pdp-verifier'
import type { Piece } from '@filoz/synapse-core/warm-storage'

const page = await getPieces(client, { dataSet, address, cursor })
const pieces: Piece[] = page.items
```

FWSS no longer persists piece metadata in contract state. Read it from FWSS `PieceAdded` events or an indexer. Upload and commit inputs continue to accept piece metadata for those events. Data-set metadata getters remain available.

---

## synapse-core 0.8.0

### Action: Migrate paginated reads to cursors and pages

Paginated actions in `@filoz/synapse-core` now share a bounded cursor interface:

```ts
type PaginationOptions = {
  cursor?: bigint
  limit?: bigint
}

type Page<T> = {
  items: T[]
  nextCursor?: bigint
}
```

Replace contract-specific `offset`, `hasMore`, and array result handling with `cursor`, `items`, and `nextCursor`. Treat `nextCursor` as opaque and pass it back unchanged. Omitting `limit` uses a bounded default; `limit: 0n` is now rejected instead of meaning “fetch everything.”

```ts
// before
const dataSets = await getClientDataSets(client, {
  address,
  offset: 0n,
  limit: 0n,
})

// after: read one page
const page = await getClientDataSets(client, {
  address,
  limit: 100n,
})
console.log(page.items)

const nextPage = page.nextCursor === undefined
  ? undefined
  : await getClientDataSets(client, {
      address,
      cursor: page.nextCursor,
      limit: 100n,
    })
```

Use the generic `paginate()` generator to traverse every page or accumulate all items:

```ts
import { paginate } from '@filoz/synapse-core'
import { getClientDataSets } from '@filoz/synapse-core/warm-storage'

for await (const dataSet of paginate(({ cursor }) =>
  getClientDataSets(client, { address, cursor })
)) {
  console.log(dataSet.dataSetId)
}

const allDataSets = await Array.fromAsync(
  paginate(({ cursor }) => getClientDataSets(client, { address, cursor }))
)
```

This result change applies to paginated payment rails, FWSS client data sets and approved providers, PDP pieces and CID matches, and service-provider registry queries. Payment rail pages additionally include `total`.

The `WarmStorageService.getClientDataSets()` and `getClientDataSetIds()` methods in `@filoz/synapse-sdk` expose the same page interface. Higher-level SDK methods whose names promise all results, such as provider listing and rail listing methods, continue to return complete arrays and paginate internally.

### Action: Replace `getActivePieces` with `getActivePiecesByCursor`

The offset-based `getActivePieces` action was removed. Use piece-ID cursor pagination instead:

```ts
// before
const result = await getActivePieces(client, {
  dataSetId,
  offset: 0n,
  limit: 100n,
})

// after
const page = await getActivePiecesByCursor(client, {
  dataSetId,
  limit: 100n,
})

// iterate
for await (const piece of paginate(({ cursor }) =>
  getActivePiecesByCursor(client, { dataSetId, cursor, limit: 100n })
)) {
  console.log(piece.id, piece.cid)
}
```

`findPieceIdsByCid` and `getPieces` also return pages and accept `cursor` rather than `startPieceId` or `offset` at the action level.

Raw `*Call` helpers in `@filoz/synapse-core` remain ABI-oriented: provide their required contract-facing `offset` or `startPieceId` and `limit` fields explicitly when constructing multicalls.

### Action: Replace core `activePieceCount` with `hasActivePieces`

The enriched `PdpDataSet` values returned by `getPdpDataSet()` and `getPdpDataSets()` no longer include an exact `activePieceCount`. They now expose `hasActivePieces`, derived from a non-zero `getDataSetLeafCount` read. Leaf count is an O(1) storage lookup, unlike `getActivePiecesByCursor` and `getActivePieceCount`, which scan piece IDs and can run out of gas on large or fully drained data sets:

```ts
// before
const dataSet = await getPdpDataSet(client, { dataSetId })
if (dataSet && dataSet.activePieceCount > 0n) {
  // the data set has pieces
}

// after
const dataSet = await getPdpDataSet(client, { dataSetId })
if (dataSet?.hasActivePieces) {
  // the data set has pieces
}
```

`WarmStorageService.hasActivePieces()` keeps the same public API, but now uses the same leaf-count proxy instead of calculating an exact count. `EnhancedDataSetInfo` from `getClientDataSetsWithDetails()` / `findDataSets()` also exposes `hasActivePieces` instead of `activePieceCount`.

The core `getActivePieceCount()` action remains available, but the underlying contract getter scans the data set's piece-ID range and can fail for large data sets. `WarmStorageService.getActivePieceCount()` now paginates `getActivePiecesByCursor` to derive an exact count:

```ts
const activePieceCount = await warmStorageService.getActivePieceCount({ dataSetId })
```

To paginate explicitly in core:

```ts
let activePieceCount = 0n

for await (const _piece of paginate(({ cursor }) =>
  getActivePiecesByCursor(client, { dataSetId, cursor })
)) {
  activePieceCount++
}
```

---

## 1.0.0

### Action: Replace `terminateDataSet` with `terminateService`

Data set termination is now service termination. `terminateDataSet` was removed.

```ts
// before
const hash = await synapse.storage.terminateDataSet({ dataSetId })
await synapse.client.waitForTransactionReceipt({ hash })

// after: provider-relayed by default
const result = await synapse.storage.terminateService({ dataSetId })
console.log(result.endEpoch)

// independent on-chain fallback
const direct = await synapse.storage.terminateService({ dataSetId, onChain: true })
console.log(direct.txHash, direct.endEpoch)
```

`context.terminate()` now uses the same provider-relayed default and returns `{ txHash?, dataSetId, endEpoch }`.

### Action: Read pricing with `getPriceList()`

`getServicePrice()` was removed from both `@filoz/synapse-core` and `WarmStorageService`. Use `getPriceList()`, which returns the full on-chain price catalogue (`token`, `rates`, `fees`, `lockups`).

```ts
// before
const price = await warmStorage.getServicePrice()
price.pricePerTiBPerMonthNoCDN
price.pricePerTiBCdnEgress

// after
const priceList = await warmStorage.getPriceList()
priceList.rates.storagePerTibPerMonth
priceList.rates.cdnEgressPerTib
```

The React `useServicePrice()` hook was removed in favor of `usePriceList()`.

```tsx
// before
import { useServicePrice } from '@filoz/synapse-react'
const { data } = useServicePrice()
data?.pricePerTiBPerMonthNoCDN

// after
import { usePriceList } from '@filoz/synapse-react'
const { data } = usePriceList()
data?.rates.storagePerTibPerMonth
```

### Action: Read upload rates from `costs.rates`

The `rate` alias on upload-cost results was removed. Use `rates`.

```ts
// before
const { costs } = await synapse.storage.prepare({ dataSize })
costs.rate.perMonth

// after
const { costs } = await synapse.storage.prepare({ dataSize })
costs.rates.perMonth
```

### Action: Replace the `LOCKUP_PERIOD` constant

The `LOCKUP_PERIOD` export was removed from `@filoz/synapse-core`. The lockup period is now read from the chain; use `getPriceList().lockups.defaultLockupPeriod` if you need the value.

## 0.42.0

### Action: Re-mint session keys for service termination

`DeleteDataSetPermission` has been replaced by `TerminateServicePermission`.

Existing session keys granted with `DeleteDataSetPermission` will fail the `Synapse.create()` permission check. Re-authorize session keys so they include `TerminateServicePermission`.

```ts
// before
SessionKey.DeleteDataSetPermission
TypedData.signDeleteDataSet(client, { dataSetId })

// after
SessionKey.TerminateServicePermission
TypedData.signTerminateService(client, { dataSetId })
```

## 0.37.0

`synapse-sdk` moved to a viem-first API, removed deprecated modules/methods, and standardized method signatures around options objects plus `bigint` identifiers.

### Action: Migrate from `ethers` setup to `viem` setup

```ts
// before
import { Synapse } from '@filoz/synapse-sdk'

const synapse = await Synapse.create({
  privateKey: PRIVATE_KEY,
  rpcURL: 'https://api.calibration.node.glif.io/rpc/v1'
})

// after
import { calibration } from '@filoz/synapse-sdk'
import { privateKeyToAccount } from 'viem/accounts'
import { http } from 'viem'
import { Synapse } from '@filoz/synapse-sdk'

const synapse = Synapse.create({
  account: privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`),
  source: 'my-app',
  chain: calibration, // optional
  transport: http() // optional
})
```

### Action: Remove deprecated SDK module imports

The following subpath exports were removed from `@filoz/synapse-sdk`:

- `@filoz/synapse-sdk/pdp`
- `@filoz/synapse-sdk/subgraph`
- `@filoz/synapse-sdk/telemetry`

```ts
// before
import { PDPAuthHelper, PDPServer, PDPVerifier } from '@filoz/synapse-sdk/pdp'
import { SubgraphService } from '@filoz/synapse-sdk/subgraph'
import { getGlobalTelemetry } from '@filoz/synapse-sdk/telemetry'

// after
import { Synapse } from '@filoz/synapse-sdk'
import { PaymentsService } from '@filoz/synapse-sdk/payments'
import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'
import { StorageContext, StorageManager } from '@filoz/synapse-sdk/storage'
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
```

### Action: Convert positional parameters to object parameters

Most service methods now take an options object. IDs are now `bigint` in the public API.

```ts
// before
await synapse.storage.download(pieceCid, { withCDN: true })
await synapse.payments.allowance(spender)
await synapse.payments.settle(12, 5000)
await synapse.providers.getProvider(1)

// after
await synapse.storage.download({ pieceCid, withCDN: true })
await synapse.payments.allowance({ spender })
await synapse.payments.settle({ railId: 12n, untilEpoch: 5000n })
await synapse.providers.getProvider({ providerId: 1n })
```

This change applies broadly across:

- `PaymentsService`
- `WarmStorageService`
- `SPRegistryService`
- retrievers and storage download APIs

### Action: Replace removed deprecated methods

Deprecated methods that were previously shimmed were removed from `Synapse`.

```ts
// before
const storage = await synapse.createStorage({ providerId: 1 })
const data = await synapse.download(pieceCid)
const info = await synapse.getStorageInfo()

// after
const context = await synapse.storage.createContext({ providerId: 1n })
const data = await synapse.storage.download({ pieceCid })
const info = await synapse.storage.getStorageInfo()
```

### Action: Update dataset and callback assumptions

```ts
// before
if (dataSet.currentPieceCount > 0) {
  // ...
}

callbacks: {
  onPieceAdded: () => {},
  onPieceConfirmed: () => {}
}

// after
if (dataSet.activePieceCount > 0n) {
  // ...
}

callbacks: {
  onPiecesAdded: (txHash, pieces) => {},
  onPiecesConfirmed: (dataSetId, pieces) => {}
}
```

### Migration checklist for this range

1. Replace `ethers`-based initialization (`privateKey`/`provider`/`signer`) with viem (`account` + `transport` + `chain`).
2. Remove imports from `@filoz/synapse-sdk/pdp`, `@filoz/synapse-sdk/subgraph`, and `@filoz/synapse-sdk/telemetry`.
3. Migrate method calls to options-object style and switch numeric IDs to `bigint`.
4. Replace removed deprecated methods (`synapse.createStorage`, `synapse.download`, `synapse.getStorageInfo`) with `synapse.storage.*`.
5. Update dataset field usage (`currentPieceCount` -> `activePieceCount`) and callback names (`onPieceAdded`/`onPieceConfirmed` -> plural callbacks).

## 0.24.0+

### Terminology Update

Starting with version 0.24.0, the SDK introduces comprehensive terminology changes to better align with Filecoin ecosystem conventions:

- **Pandora** → **Warm Storage**
- **Proof Sets** → **Data Sets**
- **Roots** → **Pieces**
- **Storage Providers** → **Service Providers**
  - _Note: most service providers are, in fact, storage providers, however this language reflects the emergence of new service types on Filecoin beyond storage._

This is a breaking change that affects imports, type names, method names, and configuration options throughout the SDK.

#### Import Path Changes

**Before (v0.23.x and earlier):**

```typescript
import { PandoraService } from '@filoz/synapse-sdk/pandora'
```

**After (v0.24.0+):**

```typescript
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
```

#### Type Name Changes

| Old Type (< v0.24.0) | New Type (v0.24.0+) |
| ---------------------- | --------------------- |
| `ProofSetId` | `DataSetId` |
| `RootData` | `PieceData` |
| `ProofSetInfo` | `DataSetInfo` |
| `EnhancedProofSetInfo` | `EnhancedDataSetInfo` |
| `ProofSetCreationStatusResponse` | `DataSetCreationStatusResponse` |
| `RootAdditionStatusResponse` | `PieceAdditionStatusResponse` |
| `StorageProvider` | `ServiceProvider` |

#### Method Name Changes

**Synapse Class:**

```typescript
// Before (< v0.24.0)
synapse.getPandoraAddress()

// After (v0.24.0+)
synapse.getWarmStorageAddress()
```

**WarmStorageService (formerly PandoraService):**

```typescript
// Before (< v0.24.0)
pandoraService.getClientProofSets(client)
pandoraService.getAddRootsInfo(proofSetId)

// After (v0.24.0+)
warmStorageService.getClientDataSets(client)
warmStorageService.getAddPiecesInfo(dataSetId)
```

**PDPAuthHelper:**

```typescript
// Before (< v0.24.0)
authHelper.signCreateProofSet(serviceProvider, clientDataSetId)
authHelper.signAddRoots(proofSetId, rootData)

// After (v0.24.0+)
authHelper.signCreateDataSet(serviceProvider, clientDataSetId)
authHelper.signAddPieces(dataSetId, pieceData)
```

**PDPServer:**

```typescript
// Before (< v0.24.0)
pdpServer.createProofSet(serviceProvider, clientDataSetId)
pdpServer.addRoots(proofSetId, clientDataSetId, nextRootId, rootData)

// After (v0.24.0+)
pdpServer.createDataSet(clientDataSetId, serviceProvider, metadata, recordKeeper)
pdpServer.addPieces(dataSetId, clientDataSetId, pieceData, metadata)
```

#### Service Provider Registry

v0.24.0 introduces the `SPRegistryService` for on-chain provider management:

```typescript
import { SPRegistryService } from '@filoz/synapse-sdk/sp-registry'

// Query and manage providers through the registry
const spRegistry = new SPRegistryService(provider, registryAddress)
const providers = await spRegistry.getAllActiveProviders()
```

This replaces previous provider discovery methods and provides a standardized way to register and manage service providers on-chain.

#### Interface Property Changes

**StorageService Properties:**

```typescript
// Before (< v0.24.0)
storage.storageProvider  // Provider address property

// After (v0.24.0+)
storage.serviceProvider  // Renamed property
```

**Callback Interfaces:**

```typescript
// Before (< v0.24.0)
onProofSetResolved?: (info: { proofSetId: number }) => void

// After (v0.24.0+)
onDataSetResolved?: (info: { dataSetId: number }) => void
```

#### Configuration Changes

**Before (< v0.24.0):**

```typescript
const synapse = await Synapse.create({
  pandoraAddress: '0x...',
  // ...
})
```

**After (v0.24.0+):**

```typescript
const synapse = await Synapse.create({
  warmStorageAddress: '0x...',
  // ...
})
```

#### Complete Migration Example

**Before (< v0.24.0):**

```typescript
import { PandoraService } from '@filoz/synapse-sdk/pandora'
import type { StorageProvider } from '@filoz/synapse-sdk'

const pandoraService = new PandoraService(provider, pandoraAddress)
const proofSets = await pandoraService.getClientProofSets(client)

for (const proofSet of proofSets) {
  console.log(`Proof set ${proofSet.railId} has ${proofSet.rootMetadata.length} roots`)
}

// Using storage service
const storage = await synapse.createStorage({
  callbacks: {
    onProofSetResolved: (info) => {
      console.log(`Using proof set ${info.proofSetId}`)
    }
  }
})
console.log(`Storage provider: ${storage.storageProvider}`)
```

**After (v0.24.0+):**

```typescript
import { WarmStorageService } from '@filoz/synapse-sdk/warm-storage'
import type { ServiceProvider } from '@filoz/synapse-sdk'

const warmStorageService = await WarmStorageService.create(provider, warmStorageAddress)
const dataSets = await warmStorageService.getClientDataSets(client)

for (const dataSet of dataSets) {
  console.log(`Data set ${dataSet.railId} has ${dataSet.pieceMetadata.length} pieces`)
}

// Using new storage context API
const context = await synapse.storage.createContext({
  callbacks: {
    onDataSetResolved: (info) => {
      console.log(`Using data set ${info.dataSetId}`)
    }
  }
})
console.log(`Service provider: ${context.serviceProvider}`)

// Downloads now use clearer method names
const data = await context.download(pieceCid)  // Download from this context's provider
const anyData = await synapse.storage.download(pieceCid)  // Download from any provider
```

#### Storage Architecture Changes (v0.24.0+)

The storage API has been redesigned for simplicity and clarity:

**Simplified Storage API:**

```typescript
// Before (< v0.24.0)
const storage = await synapse.createStorage()
await storage.upload(data)
await storage.providerDownload(pieceCid)  // Confusing method name
await synapse.download(pieceCid)  // Duplicate functionality

// After (v0.24.0+) - Recommended approach
await synapse.storage.upload(data)  // Simple: auto-managed contexts
await synapse.storage.download(pieceCid)  // Simple: download from anywhere

// Advanced usage (when you need explicit control)
const context = await synapse.storage.createContext({ providerAddress: '0x...' })
await context.upload(data)  // Upload to specific provider
await context.download(pieceCid)  // Download from specific provider
```

**Key improvements:**

- Access all storage operations via `synapse.storage`
- Automatic context management - no need to explicitly create contexts for basic usage
- Clear separation between SP-agnostic downloads (`synapse.storage.download()`) and context-specific downloads (`context.download()`)

#### Migration Checklist

When upgrading from versions prior to v0.24.0:

1. **Update imports** - Replace `@filoz/synapse-sdk/pandora` with `@filoz/synapse-sdk/warm-storage`
2. **Update type references**:
   - Replace all `ProofSet`/`proofSet` with `DataSet`/`dataSet`
   - Replace all `Root`/`root` with `Piece`/`piece`
   - Replace `StorageProvider` type with `ServiceProvider`
3. **Update interface properties**:
   - `ApprovedProviderInfo.owner` → `ApprovedProviderInfo.serviceProvider`
   - `ApprovedProviderInfo.pdpUrl` → `ApprovedProviderInfo.serviceURL`
   - `storage.storageProvider` → `storage.serviceProvider`
4. **Update callback names**:
   - `onProofSetResolved` → `onDataSetResolved`
   - Callback parameter `proofSetId` → `dataSetId`
5. **Simplify storage API calls**:
   - `synapse.createStorage()` → `synapse.storage.upload()` (for simple usage)
   - `synapse.createStorage()` → `synapse.storage.createContext()` (for advanced usage)
   - `storage.providerDownload()` → `context.download()`
   - `synapse.download()` → `synapse.storage.download()`
6. **Update method calls** - Use the new method names as shown above
7. **Update configuration** - Replace `pandoraAddress` with `warmStorageAddress`
8. **Update environment variables** - `PANDORA_ADDRESS` → `WARM_STORAGE_ADDRESS`
9. **Update GraphQL queries** (if using subgraph) - `proofSets` → `dataSets`, `roots` → `pieces`

#### PaymentsService Parameter Order Changes

All PaymentsService methods now consistently place the `token` parameter last with USDFC as the default:

**Before (< v0.24.0):**

```typescript
await payments.allowance(TOKENS.USDFC, spender)
await payments.approve(TOKENS.USDFC, spender, amount)
await payments.deposit(amount, TOKENS.USDFC, callbacks)
```

**After (v0.24.0+):**

```typescript
await payments.allowance(spender)  // USDFC is default
await payments.approve(spender, amount)  // USDFC is default
await payments.deposit(amount, TOKENS.USDFC, callbacks)  // callbacks last for deposit
```

#### Contract Address Configuration

The SDK now automatically discovers all necessary contract addresses. The `warmStorageAddress` option in `Synapse.create()` has been removed as addresses are managed internally by the SDK for each network.

Note: There is no backward compatibility layer. All applications must update to the new terminology and API signatures when upgrading to v0.24.0 or later.
