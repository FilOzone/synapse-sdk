/* globals describe it before after beforeEach */

import { type Chain, calibration } from '@filoz/synapse-core/chains'
import * as Mocks from '@filoz/synapse-core/mocks'
import { CDN_FIXED_LOCKUP, SIZE_CONSTANTS } from '@filoz/synapse-core/utils'
import { assert } from 'chai'
import { setup } from 'iso-web/msw'
import {
  type Account,
  type Client,
  createWalletClient,
  maxUint256,
  parseUnits,
  type Transport,
  http as viemHttp,
} from 'viem'
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

  let client: Client<Transport, Chain, Account>
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
    const result = await manager.calculateMultiContextCosts([ctx], { dataSize: 1n })

    assert.equal(typeof result.rate.perEpoch, 'bigint')
    assert.equal(typeof result.rate.perMonth, 'bigint')
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
    const result = await manager.calculateMultiContextCosts([ctx], { dataSize: 1n })

    assert.equal(result.depositNeeded, 0n)
    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.ready, true)

    // Floor pricing for tiny file
    const minimumPricePerMonth = parseUnits('6', 16) // 0.06 USDFC
    assert.equal(result.rate.perMonth, minimumPricePerMonth)
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
    const single = await manager.calculateMultiContextCosts([ctx1], { dataSize: 1n })

    // Two contexts
    const ctxA = makeContext(synapse, warmStorageService, {})
    const ctxB = makeContext(synapse, warmStorageService, { provider: mockProvider2 })
    const double = await manager.calculateMultiContextCosts([ctxA, ctxB], { dataSize: 1n })

    // Rates should be exactly 2x single context
    assert.equal(double.rate.perEpoch, single.rate.perEpoch * 2n)
    assert.equal(double.rate.perMonth, single.rate.perMonth * 2n)
  })

  it('should fetch dataset size for existing contexts', async () => {
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
      })
    )

    // Existing dataset with 1 TiB, adding 1 TiB more → total 2 TiB
    const existing = makeContext(synapse, warmStorageService, { dataSetId: 5n })
    const resultExisting = await manager.calculateMultiContextCosts([existing], { dataSize: oneTiB })

    // New dataset with 1 TiB → total 1 TiB
    const newCtx = makeContext(synapse, warmStorageService, {})
    const resultNew = await manager.calculateMultiContextCosts([newCtx], { dataSize: oneTiB })

    // Existing 1 TiB + 1 TiB = 2 TiB rate, new 1 TiB = 1 TiB rate
    // pricePerTiBPerMonth = 2.5 USDFC
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    assert.equal(resultNew.rate.perMonth, pricePerTiBPerMonth) // 1 TiB = 2.5 USDFC/month
    assert.equal(resultExisting.rate.perMonth, pricePerTiBPerMonth * 2n) // 2 TiB = 5 USDFC/month
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
      })
    )

    // New context: dataSize = 1 TiB → rate for 1 TiB
    const newCtx = makeContext(synapse, warmStorageService, {})
    // Existing context: 1 TiB existing + 1 TiB new → rate for 2 TiB
    const existingCtx = makeContext(synapse, warmStorageService, {
      dataSetId: 5n,
      provider: mockProvider2,
    })

    const result = await manager.calculateMultiContextCosts([newCtx, existingCtx], {
      dataSize: oneTiB,
    })

    // Combined rate: 1 TiB (2.5 USDFC) + 2 TiB (5 USDFC) = 7.5 USDFC/month
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    assert.equal(result.rate.perMonth, pricePerTiBPerMonth * 3n)
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
    const result = await manager.calculateMultiContextCosts([ctx], { dataSize: 1n })

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
      dataSize: 1n,
      extraRunwayEpochs: 0n,
    })

    const withRunway = await manager.calculateMultiContextCosts([ctxA, ctxB], {
      dataSize: 1n,
      extraRunwayEpochs: 10_000n,
    })

    assert.ok(
      withRunway.depositNeeded > baseline.depositNeeded,
      `deposit with runway (${withRunway.depositNeeded}) should exceed baseline (${baseline.depositNeeded})`
    )

    // runway = (currentLockupRate + totalRateDelta) * extraRunwayEpochs
    // currentLockupRate = 0, totalRateDelta = 2 * floor rate per epoch
    // floor per epoch = 6e16 / 86400 = 694,444,444,444
    // runway = 2 * 694,444,444,444 * 10,000 = 13,888,888,888,880,000
    const expectedRunway = 13_888_888_888_880_000n
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
      dataSize: 1n,
      bufferEpochs: 0n,
    })

    const withBuffer = await manager.calculateMultiContextCosts([ctx], {
      dataSize: 1n,
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
      dataSize: 1n,
      bufferEpochs: 0n,
    })

    const withBuffer = await manager.calculateMultiContextCosts([ctx], {
      dataSize: 1n,
      bufferEpochs: 100n,
    })

    assert.ok(
      withBuffer.depositNeeded > noBuffer.depositNeeded,
      `deposit with buffer=100 (${withBuffer.depositNeeded}) should exceed buffer=0 (${noBuffer.depositNeeded})`
    )

    // buffer delta = netRate * bufferEpochs = (currentLockupRate + rateDelta) * 100
    // rateDelta = floor rate for 1-byte file = minimumPricePerMonth / epochsPerMonth
    const floorRatePerEpoch = 60_000_000_000_000_000n / 86400n
    const netRate = 100_000_000_000_000n + floorRatePerEpoch
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
      dataSize: 1n,
    })

    // Two contexts, one with CDN
    const cdnCtx = makeContext(synapse, warmStorageService, { withCDN: true })
    const plainCtx = makeContext(synapse, warmStorageService, { provider: mockProvider2 })
    const mixedResult = await manager.calculateMultiContextCosts([cdnCtx, plainCtx], {
      dataSize: 1n,
    })

    // Difference should be exactly CDN_FIXED_LOCKUP.total (1 USDFC)
    assert.equal(
      mixedResult.depositNeeded - baselineResult.depositNeeded,
      CDN_FIXED_LOCKUP.total,
      `CDN context should add exactly ${CDN_FIXED_LOCKUP.total} to deposit`
    )
  })

  it('should report needsFwssMaxApproval when not approved', async () => {
    // Default preset has rateAllowance != maxUint256 → needs approval
    server.use(Mocks.JSONRPC(Mocks.presets.basic))

    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { dataSize: 1n })

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
    const singleResult = await manager.calculateMultiContextCosts([single], { dataSize: 1n })

    // Three contexts underfunded
    const ctxs = [
      makeContext(synapse, warmStorageService, {}),
      makeContext(synapse, warmStorageService, { provider: mockProvider2 }),
      makeContext(synapse, warmStorageService, {}),
    ]
    const tripleResult = await manager.calculateMultiContextCosts(ctxs, { dataSize: 1n })

    // Deposit for 3 contexts should be ~3x the single-context lockup
    // (debt=0, runway=0, buffer=0 since lockupRate=0)
    assert.ok(tripleResult.depositNeeded > singleResult.depositNeeded, 'deposit for 3 contexts should exceed 1 context')
    assert.equal(tripleResult.depositNeeded, singleResult.depositNeeded * 3n)
  })

  it('should handle new context as isNewDataSet=true with currentDataSetSize=0', async () => {
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
    // Rate should be for dataSize alone (1 TiB)
    const ctx = makeContext(synapse, warmStorageService, {})
    const result = await manager.calculateMultiContextCosts([ctx], { dataSize: oneTiB })

    assert.equal(result.rate.perMonth, pricePerTiBPerMonth)
  })
})
