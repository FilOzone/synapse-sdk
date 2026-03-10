/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, maxUint256, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { getUploadCosts } from '../src/warm-storage/get-upload-costs.ts'

describe('getUploadCosts', () => {
  const server = setup()

  before(async () => {
    await server.start()
  })

  after(() => {
    server.stop()
  })

  beforeEach(() => {
    server.resetHandlers()
  })

  it('should return correct shape with basic preset', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n, // tiny file → uses floor pricing
    })

    assert.equal(typeof result.rate.perEpoch, 'bigint')
    assert.equal(typeof result.rate.perMonth, 'bigint')
    assert.equal(typeof result.depositNeeded, 'bigint')
    assert.equal(typeof result.needsFwssMaxApproval, 'boolean')
    assert.equal(typeof result.ready, 'boolean')
  })

  it('should report needsFwssMaxApproval when allowances are not maxUint256', async () => {
    // Default mock has rateAllowance=1000000n (not maxUint256) → needs approval
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
    })

    assert.equal(result.needsFwssMaxApproval, true)
    assert.equal(result.ready, false)
  })

  it('should report ready when fully approved and funded', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    // Account has 500 USDFC with no lockup, tiny file → deposit should be 0
    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
    })

    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.depositNeeded, 0n)
    assert.equal(result.ready, true)
  })

  it('should compute non-zero deposit when account is underfunded', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          // Account with almost no funds
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n, // tiny file but no funds → needs deposit
    })

    assert.ok(result.depositNeeded > 0n, `depositNeeded should be positive, got ${result.depositNeeded}`)
    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.ready, false)
  })

  it('should apply floor pricing for tiny files', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
    })

    // Floor: minimumPricePerMonth = 0.06 USDFC
    // perMonth should equal minimumPricePerMonth (floor)
    const minimumPricePerMonth = parseUnits('6', 16) // 0.06 USDFC
    assert.equal(result.rate.perMonth, minimumPricePerMonth)
  })

  it('should use natural rate for large files above floor', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    // 1 TiB should be above floor pricing
    const onetiB = 1n << 40n
    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: onetiB,
    })

    // Natural rate for 1 TiB = pricePerTiBPerMonth = 2.5 USDFC
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    assert.equal(result.rate.perMonth, pricePerTiBPerMonth)
  })

  it('should include debt in deposit for account in debt', async () => {
    // Account state: settled in the past with active lockup rate → accrued debt
    // Mock eth_blockNumber = 0x127001 = 1,208,321
    // elapsed = 1,208,321 - 1,100,000 = 108,321 epochs
    // totalOwed = 5 USDFC + 0.0001/epoch * 108,321 = ~15.83 USDFC
    // funds = 10 USDFC → debt = ~5.83 USDFC
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [
            parseUnits('10', 18), // funds: 10 USDFC
            parseUnits('5', 18), // lockupCurrent: 5 USDFC
            100_000_000_000_000n, // lockupRate: 0.0001 USDFC/epoch
            1_100_000n, // lockupLastSettledAt
          ],
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
    })

    // debt = (5e18 + 1e14 * 108321) - 10e18 = 5,832,100,000,000,000,000
    const expectedDebt = 5_832_100_000_000_000_000n
    assert.ok(
      result.depositNeeded >= expectedDebt,
      `depositNeeded (${result.depositNeeded}) should be >= debt (${expectedDebt})`
    )
    assert.equal(result.ready, false)
  })

  it('should increase deposit when extraRunwayEpochs is specified', async () => {
    // Underfunded account so deposit is always needed
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const baseline = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      extraRunwayEpochs: 0n,
    })

    const withRunway = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      extraRunwayEpochs: 10_000n,
    })

    assert.ok(
      withRunway.depositNeeded > baseline.depositNeeded,
      `deposit with runway (${withRunway.depositNeeded}) should exceed baseline (${baseline.depositNeeded})`
    )

    // runway = (currentLockupRate + rateDeltaPerEpoch) * extraRunwayEpochs
    // currentLockupRate = 0, rateDeltaPerEpoch = floor rate = minimumPerEpoch
    // minimumPerEpoch = 6e16 / 86400 = 694,444,444,444 (bigint truncation)
    // runway = 694,444,444,444 * 10,000 = 6,944,444,444,440,000
    const expectedRunway = 6_944_444_444_440_000n
    assert.equal(
      withRunway.depositNeeded - baseline.depositNeeded,
      expectedRunway,
      'runway delta should equal rateDeltaPerEpoch * extraRunwayEpochs'
    )
  })

  it('should increase deposit when bufferEpochs is larger', async () => {
    // Underfunded account: deposit needed → buffer = netRate * bufferEpochs
    // With currentLockupRate > 0, increasing bufferEpochs increases the deposit
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [
            0n, // funds
            0n, // lockupCurrent
            100_000_000_000_000n, // lockupRate: 0.0001 USDFC/epoch
            1_000_000n, // lockupLastSettledAt
          ],
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const smallBuffer = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      bufferEpochs: 0n,
    })

    const largeBuffer = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      bufferEpochs: 100n,
    })

    assert.ok(
      largeBuffer.depositNeeded > smallBuffer.depositNeeded,
      `deposit with buffer=100 (${largeBuffer.depositNeeded}) should exceed buffer=0 (${smallBuffer.depositNeeded})`
    )

    // Buffer delta = netRate * bufferEpochs = (currentLockupRate + rateDelta) * 100
    // rateDelta = floor rate for 1-byte file = minimumPricePerMonth / epochsPerMonth
    const floorRatePerEpoch = 60_000_000_000_000_000n / 86400n
    const netRate = 100_000_000_000_000n + floorRatePerEpoch
    const expectedBufferDelta = netRate * 100n
    assert.equal(
      largeBuffer.depositNeeded - smallBuffer.depositNeeded,
      expectedBufferDelta,
      'buffer delta should equal netRate * bufferEpochs'
    )
  })

  it('should use total size for rate when adding to existing dataset', async () => {
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const halfTiB = (1n << 40n) / 2n

    // Existing dataset: 0.5 TiB current + 0.5 TiB new → 1 TiB total rate
    const existing = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: halfTiB,
      isNewDataSet: false,
      currentDataSetSize: halfTiB,
    })

    // New dataset: 0.5 TiB → 0.5 TiB rate
    const newDs = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: halfTiB,
      isNewDataSet: true,
    })

    // 1 TiB rate = 2.5 USDFC/month, 0.5 TiB rate < 2.5 USDFC/month
    assert.equal(existing.rate.perMonth, parseUnits('2.5', 18))
    assert.ok(
      existing.rate.perMonth > newDs.rate.perMonth,
      `existing dataset rate (${existing.rate.perMonth}) should exceed new dataset rate (${newDs.rate.perMonth})`
    )
  })

  it('should add CDN fixed lockup for new CDN datasets', async () => {
    // Underfunded so deposit > 0 for both cases
    server.use(
      JSONRPC({
        ...presets.basic,
        payments: {
          ...presets.basic.payments,
          accounts: () => [0n, 0n, 0n, 0n],
          operatorApprovals: () => [true, maxUint256, maxUint256, 0n, 0n, maxUint256],
        },
      })
    )

    const client = createPublicClient({
      chain: calibration,
      transport: http(),
    })

    const withoutCDN = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      withCDN: false,
    })

    const withCDN = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      dataSize: 1n,
      withCDN: true,
    })

    // CDN_FIXED_LOCKUP.total = 1 USDFC (cdn 0.7 + cacheMiss 0.3)
    const cdnFixedLockupTotal = 1_000_000_000_000_000_000n
    assert.equal(
      withCDN.depositNeeded - withoutCDN.depositNeeded,
      cdnFixedLockupTotal,
      'CDN deposit should exceed non-CDN deposit by exactly CDN_FIXED_LOCKUP.total (1 USDFC)'
    )
  })
})
