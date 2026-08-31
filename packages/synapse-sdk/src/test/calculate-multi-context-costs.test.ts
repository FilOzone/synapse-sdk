/* globals describe it before after beforeEach */

import type { AccountClient } from '@filoz/synapse-core'
import { calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { leafCountToRawSize, rawSizeToLeafCount, SIZE_CONSTANTS } from '@filoz/synapse-core/utils'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import { createWalletClient, maxUint256, parseUnits, http as viemHttp } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { StorageContext } from '../storage/context.ts'
import { StorageManager } from '../storage/manager.ts'
import { Synapse } from '../synapse.ts'
import type { PDPProvider } from '../types.ts'
import { WarmStorageService } from '../warm-storage/index.ts'

const server = setup()

describe('calculateMultiContextCosts', () => {
  // Shared mock provider
  const mockProvider = {
    id: 1n,
    serviceProvider: Mocks.ADDRESSES.serviceProvider1,
    payee: Mocks.ADDRESSES.payee1,
    name: 'Test Provider',
    description: 'Test Provider',
    isActive: true,
    pdp: {
      serviceURL: 'https://pdp.example.com',
      minPieceSizeInBytes: 1024n,
      maxPieceSizeInBytes: 32n * 1024n * 1024n * 1024n,
      storagePricePerTibPerDay: 1_000_000n,
      minProvingPeriodInEpochs: 30n,
      location: 'us-east',
      paymentTokenAddress: Mocks.ADDRESSES.calibration.usdfcToken,
      ipniPiece: false,
      ipniIpfs: false,
    },
  }

  const mockProvider2 = {
    ...mockProvider,
    id: 2n,
    serviceProvider: Mocks.ADDRESSES.serviceProvider2,
    pdp: { ...mockProvider.pdp, serviceURL: 'https://pdp2.example.com' },
  }

  /** Helper: build a StorageContext with minimal valid data */
  function makeContext(
    synapse: Synapse,
    warmStorageService: WarmStorageService,
    opts: { dataSetId?: bigint; withCDN?: boolean; provider?: PDPProvider }
  ): StorageContext {
    return new StorageContext({
      synapse,
      warmStorageService,
      provider: opts.provider ?? mockProvider,
      dataSetId: opts.dataSetId,
      options: { withCDN: opts.withCDN ?? false },
      dataSetMetadata: {},
    })
  }

  /** Full-approval mock override (maxUint256 allowances) */
  const fullyApproved = () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256] as const

  /** Active FWSS data-set state used by existing-context cost tests. */
  const activeDataSet = (dataSetId: bigint, lifecycleReserveBalance = parseUnits('0.5', 18)) =>
    [
      {
        cacheMissRailId: 0n,
        cdnRailId: 0n,
        clientDataSetId: 0n,
        commissionBps: 100n,
        dataSetId,
        payee: Mocks.ADDRESSES.payee1,
        payer: Mocks.ADDRESSES.client1,
        pdpEndEpoch: 0n,
        pdpRailId: 1n,
        providerId: 1n,
        pendingOneTimePayments: 0n,
        lifecycleReserveBalance,
        serviceProvider: Mocks.ADDRESSES.serviceProvider1,
      },
    ] as const

  let client: AccountClient
  let synapse: Synapse
  let warmStorageService: WarmStorageService
  let manager: StorageManager

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
    client = createWalletClient({
      chain: calibration,
      transport: viemHttp(),
      account: privateKeyToAccount(Mocks.PRIVATE_KEYS.key1),
    })
    synapse = new Synapse({ client, source: null })
    warmStorageService = new WarmStorageService({ client })
    manager = new StorageManager({
      synapse,
      warmStorageService,
      withCDN: false,
      source: null,
    })
  })

  it('should return correct shape', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n] })

    assert.equal(typeof result.rates.perEpoch, 'bigint')
    assert.equal(typeof result.rates.perMonth, 'bigint')
    assert.equal(typeof result.fees.total, 'bigint')
    assert.equal(typeof result.lockups.total, 'bigint')
    assert.equal(typeof result.depositNeeded, 'bigint')
    assert.equal(typeof result.needsFwssMaxApproval, 'boolean')
    assert.equal(typeof result.ready, 'boolean')
  })

  it('should report ready when funded and approved (single new context)', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n] })

    assert.equal(result.depositNeeded, 0n)
    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.ready, true)

    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const storagePerMonth = (parseUnits('2.5', 18) * pricedSize) / (1n << 40n)
    assert.equal(result.rates.perMonth, parseUnits('0.12', 18) + storagePerMonth)
  })

  it('should aggregate rates across two new contexts', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          operatorApprovals: fullyApproved,
        },
      })
    )

    // Single context baseline
    const ctx1 = makeContext(synapse, warmStorageService, {})
    const single = await manager.calculateMultiContextCosts([ctx1], { pieceSizes: [1n] })

    // Two contexts
    const ctxA = makeContext(synapse, warmStorageService, {})
    const ctxB = makeContext(synapse, warmStorageService, { provider: mockProvider2 })
    const double = await manager.calculateMultiContextCosts([ctxA, ctxB], { pieceSizes: [1n] })

    // Rates should be exactly 2x single context
    assert.equal(double.rates.perEpoch, single.rates.perEpoch * 2n)
    assert.equal(double.rates.perMonth, single.rates.perMonth * 2n)
  })

  it('should fetch the data set leaf count for existing contexts', async () => {
    // Mock getDataSetLeafCount to return 1 TiB worth of leaves for dataset 5
    const oneTiB = 1n << 40n
    const leafCount = oneTiB / SIZE_CONSTANTS.BYTES_PER_LEAF

    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [parseUnits('10000', 18), 0n, 0n, 1_000_000n],
          operatorApprovals: fullyApproved,
        },
        pdpVerifier: {
          ...Mocks.presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [leafCount],
        },
        warmStorageView: {
          ...Mocks.presets.basic.warmStorageView,
          getDataSet: (args) => activeDataSet(args[0]),
        },
      })
    )

    // Existing dataset plus 1 TiB of new raw data.
    const existing = makeContext(synapse, warmStorageService, { dataSetId: 5n })
    const resultExisting = await manager.calculateMultiContextCosts([existing], { pieceSizes: [oneTiB] })

    // New dataset with 1 TiB → total 1 TiB
    const newCtx = makeContext(synapse, warmStorageService, {})
    const resultNew = await manager.calculateMultiContextCosts([newCtx], { pieceSizes: [oneTiB] })

    // pricePerTiBPerMonth = 2.5 USDFC
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    const addedLeafCount = rawSizeToLeafCount(oneTiB)
    const newPricedSize = leafCountToRawSize(addedLeafCount)
    const existingFinalPricedSize = leafCountToRawSize(leafCount + addedLeafCount)
    const existingStorageRate = (pricePerTiBPerMonth * existingFinalPricedSize) / oneTiB
    assert.equal(resultNew.rates.perMonth, (pricePerTiBPerMonth * newPricedSize) / oneTiB + parseUnits('0.12', 18))
    assert.equal(resultExisting.rates.perMonth, existingStorageRate + parseUnits('0.12', 18))
  })

  it('should handle mixed new + existing contexts', async () => {
    const oneTiB = 1n << 40n
    const leafCount = oneTiB / SIZE_CONSTANTS.BYTES_PER_LEAF

    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [parseUnits('10000', 18), 0n, 0n, 1_000_000n],
          operatorApprovals: fullyApproved,
        },
        pdpVerifier: {
          ...Mocks.presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [leafCount],
        },
        warmStorageView: {
          ...Mocks.presets.basic.warmStorageView,
          getDataSet: (args) => activeDataSet(args[0]),
        },
      })
    )

    // New context: one 1 TiB piece.
    const newCtx = makeContext(synapse, warmStorageService, {})
    // Existing context: padded leaf count converted to raw bytes + 1 TiB new.
    const existingCtx = makeContext(synapse, warmStorageService, {
      dataSetId: 5n,
      provider: mockProvider2,
    })

    const result = await manager.calculateMultiContextCosts([newCtx, existingCtx], {
      pieceSizes: [oneTiB],
    })

    // Combined rate: storage rates plus one proving service rate per context.
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    const addedLeafCount = rawSizeToLeafCount(oneTiB)
    const totalPricedSize = leafCountToRawSize(addedLeafCount) + leafCountToRawSize(leafCount + addedLeafCount)
    const expectedStorageRate = (pricePerTiBPerMonth * totalPricedSize) / oneTiB
    assert.equal(result.rates.perMonth, expectedStorageRate + parseUnits('0.12', 18) * 2n)
  })

  it('should include debt in deposit for account in debt', async () => {
    // Mock: lockupRate = 0.0001/epoch, settled at 1,100,000, currentEpoch = 1,208,321
    // debt = (5e18 + 1e14 * 108321) - 10e18 = 5,832,100,000,000,000,000
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [
            parseUnits('10', 18), // funds
            parseUnits('5', 18), // lockupCurrent
            100_000_000_000_000n, // lockupRate
            1_100_000n, // lockupLastSettledAt
          ],
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n] })

    const expectedDebt = 5_832_100_000_000_000_000n
    assert.ok(
      result.depositNeeded >= expectedDebt,
      `depositNeeded (${result.depositNeeded}) should be >= debt (${expectedDebt})`
    )
    assert.equal(result.ready, false)
  })

  it('should increase deposit with larger runway across multiple contexts', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctxA = makeContext(synapse, warmStorageService, {})
    const ctxB = makeContext(synapse, warmStorageService, { provider: mockProvider2 })

    const baseline = await manager.calculateMultiContextCosts([ctxA, ctxB], {
      pieceSizes: [1n],
      extraRunwayEpochs: 0n,
    })

    const withRunway = await manager.calculateMultiContextCosts([ctxA, ctxB], {
      pieceSizes: [1n],
      extraRunwayEpochs: 10_000n,
    })

    assert.ok(
      withRunway.depositNeeded > baseline.depositNeeded,
      `deposit with runway (${withRunway.depositNeeded}) should exceed baseline (${baseline.depositNeeded})`
    )

    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const ratePerEpoch = (parseUnits('2.5', 18) * pricedSize) / ((1n << 40n) * 86400n) + parseUnits('0.12', 18) / 86400n
    const expectedRunway = 2n * ratePerEpoch * 10_000n
    assert.equal(
      withRunway.depositNeeded - baseline.depositNeeded,
      expectedRunway,
      'runway delta should equal totalRateDelta * extraRunwayEpochs'
    )
  })

  it('should skip buffer when all new datasets and no existing rails', async () => {
    // Fresh account: lockupRate=0, all new dataset contexts
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [
            0n, // funds
            0n, // lockupCurrent
            0n, // lockupRate: no existing rails
            0n, // lockupLastSettledAt
          ],
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, {})

    const noBuffer = await manager.calculateMultiContextCosts([ctx], {
      pieceSizes: [1n],
      bufferEpochs: 0n,
    })

    const withBuffer = await manager.calculateMultiContextCosts([ctx], {
      pieceSizes: [1n],
      bufferEpochs: 100n,
    })

    // No existing rails + all new datasets → buffer skipped
    assert.equal(
      withBuffer.depositNeeded,
      noBuffer.depositNeeded,
      'new user deposit should be identical regardless of bufferEpochs'
    )
    assert.ok(noBuffer.depositNeeded > 0n, 'should still require lockup deposit')
  })

  it('should increase deposit with larger buffer when lockupRate > 0', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [
            0n, // funds
            0n, // lockupCurrent
            100_000_000_000_000n, // lockupRate: 0.0001 USDFC/epoch
            1_000_000n, // lockupLastSettledAt
          ],
          operatorApprovals: fullyApproved,
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, {})

    const noBuffer = await manager.calculateMultiContextCosts([ctx], {
      pieceSizes: [1n],
      bufferEpochs: 0n,
    })

    const withBuffer = await manager.calculateMultiContextCosts([ctx], {
      pieceSizes: [1n],
      bufferEpochs: 100n,
    })

    assert.ok(
      withBuffer.depositNeeded > noBuffer.depositNeeded,
      `deposit with buffer=100 (${withBuffer.depositNeeded}) should exceed buffer=0 (${noBuffer.depositNeeded})`
    )

    // buffer delta = netRate * bufferEpochs = (currentLockupRate + rateDelta) * 100
    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const ratePerEpoch = (parseUnits('2.5', 18) * pricedSize) / ((1n << 40n) * 86400n) + parseUnits('0.12', 18) / 86400n
    const netRate = 100_000_000_000_000n + ratePerEpoch
    const expectedDelta = netRate * 100n
    assert.equal(
      withBuffer.depositNeeded - noBuffer.depositNeeded,
      expectedDelta,
      'buffer delta should equal netRate * bufferEpochs'
    )
  })

  it('should add CDN fixed lockup only for CDN-enabled new contexts', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: fullyApproved,
        },
      })
    )

    // Two contexts, neither with CDN
    const noCdnA = makeContext(synapse, warmStorageService, {})
    const noCdnB = makeContext(synapse, warmStorageService, { provider: mockProvider2 })
    const baselineResult = await manager.calculateMultiContextCosts([noCdnA, noCdnB], {
      pieceSizes: [1n],
    })

    // Two contexts, one with CDN
    const cdnCtx = makeContext(synapse, warmStorageService, { withCDN: true })
    const plainCtx = makeContext(synapse, warmStorageService, { provider: mockProvider2 })
    const mixedResult = await manager.calculateMultiContextCosts([cdnCtx, plainCtx], {
      pieceSizes: [1n],
    })

    const cdnLockupTotal = parseUnits('1', 18)
    assert.equal(
      mixedResult.depositNeeded - baselineResult.depositNeeded,
      cdnLockupTotal,
      `CDN context should add exactly ${cdnLockupTotal} to deposit`
    )
  })

  it('should report needsFwssMaxApproval when not approved', async () => {
    // Default preset has rateAllowance != maxUint256 → needs approval
    server.use(Mocks.JSONRPC(Mocks.presets.basic))

    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n] })

    assert.equal(result.needsFwssMaxApproval, true)
    assert.equal(result.ready, false)
  })

  it('should compute deposit for underfunded account across multiple contexts', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: fullyApproved,
        },
      })
    )

    // Single context underfunded
    const single = makeContext(synapse, warmStorageService, {})
    const singleResult = await manager.calculateMultiContextCosts([single], { pieceSizes: [1n] })

    // Three contexts underfunded
    const ctxs = [
      makeContext(synapse, warmStorageService, {}),
      makeContext(synapse, warmStorageService, { provider: mockProvider2 }),
      makeContext(synapse, warmStorageService, {}),
    ]
    const tripleResult = await manager.calculateMultiContextCosts(ctxs, { pieceSizes: [1n] })

    // Deposit for 3 contexts should be ~3x the single-context lockup
    // (debt=0, runway=0, buffer=0 since lockupRate=0)
    assert.ok(tripleResult.depositNeeded > singleResult.depositNeeded, 'deposit for 3 contexts should exceed 1 context')
    assert.equal(tripleResult.depositNeeded, singleResult.depositNeeded * 3n)
  })

  it('should handle a new context with zero current leaves', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [parseUnits('10000', 18), 0n, 0n, 1_000_000n],
          operatorApprovals: fullyApproved,
        },
      })
    )

    const oneTiB = 1n << 40n
    const pricePerTiBPerMonth = parseUnits('2.5', 18)

    // New context: dataSetId = undefined → isNewDataSet = true
    // Rate should be based on the data-bearing leaves of the new piece.
    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [oneTiB] })

    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(oneTiB))
    assert.equal(result.rates.perMonth, (pricePerTiBPerMonth * pricedSize) / oneTiB + parseUnits('0.12', 18))
  })

  it('should derive add-pieces fees from pieceSizes', async () => {
    server.use(Mocks.JSONRPC(Mocks.presets.basic))

    const ctx = makeContext(synapse, warmStorageService, {})
    const onePiece = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [2n] })
    const twoPieces = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n, 1n] })

    assert.equal(twoPieces.fees.addPiecesFee - onePiece.fees.addPiecesFee, parseUnits('0.011', 18))
  })

  it('should include reserve replenishment for an existing data set below threshold', async () => {
    server.use(
      Mocks.JSONRPC({
        ...Mocks.presets.basic,
        payments: {
          ...Mocks.presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: fullyApproved,
        },
        pdpVerifier: {
          ...Mocks.presets.basic.pdpVerifier,
          getDataSetLeafCount: () => [0n],
        },
        warmStorageView: {
          ...Mocks.presets.basic.warmStorageView,
          getDataSet: (args) => activeDataSet(args[0], parseUnits('0.03', 18)),
        },
      })
    )

    const ctx = makeContext(synapse, warmStorageService, { dataSetId: 5n })
    const result = await manager.calculateMultiContextCosts([ctx], { pieceSizes: [1n], bufferEpochs: 0n })

    assert.equal(result.lockups.reserveReplenishment, parseUnits('0.481', 18))
    assert.equal(result.depositNeeded, result.lockups.total)
  })
})
