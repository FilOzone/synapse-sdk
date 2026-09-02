/* globals describe it */

import assert from 'assert'
import { setup } from 'iso-web/msw'
import { createPublicClient, http, maxUint256, parseUnits } from 'viem'
import { calibration } from '../src/chains.ts'
import { ServiceAlreadyTerminatedError } from '../src/errors/pdp.ts'
import { ADDRESSES, JSONRPC, presets } from '../src/mocks/jsonrpc/index.ts'
import { leafCountToRawSize, rawSizeToLeafCount } from '../src/utils/pdp-size.ts'
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
      pieceSizes: [1n],
    })

    assert.equal(typeof result.rates.perEpoch, 'bigint')
    assert.equal(typeof result.rates.perMonth, 'bigint')
    assert.equal(typeof result.fees.total, 'bigint')
    assert.equal(typeof result.lockups.total, 'bigint')
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
      pieceSizes: [1n],
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
      pieceSizes: [1n],
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
      pieceSizes: [1n], // tiny file but no funds → needs deposit
    })

    assert.ok(result.depositNeeded > 0n, `depositNeeded should be positive, got ${result.depositNeeded}`)
    assert.equal(result.needsFwssMaxApproval, false)
    assert.equal(result.ready, false)
  })

  it('should apply proving service rate for tiny files', async () => {
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
      pieceSizes: [1n],
    })

    // Additive: 1-byte dataset pays a tiny storage rate on top of proving.
    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const storagePerMonth = (parseUnits('2.5', 18) * pricedSize) / (1n << 40n)
    assert.equal(result.rates.perMonth, parseUnits('0.12', 18) + storagePerMonth)
    assert.equal(result.fees.createDataSetFee, parseUnits('0.025', 18))
    assert.equal(result.fees.addPiecesFee, parseUnits('0.011', 18))
    assert.equal(result.lockups.lifecycleLockup, parseUnits('0.5', 18))
  })

  it('should use storage plus proving rate for large files', async () => {
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

    const onetiB = 1n << 40n
    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [onetiB],
    })

    // FWSS prices the aggregate leaves, which can exceed exact raw size by up to 31 bytes per piece.
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(onetiB))
    assert.equal(result.rates.perMonth, (pricePerTiBPerMonth * pricedSize) / onetiB + parseUnits('0.12', 18))
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
      pieceSizes: [1n],
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
      pieceSizes: [1n],
      extraRunwayEpochs: 0n,
    })

    const withRunway = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [1n],
      extraRunwayEpochs: 10_000n,
    })

    assert.ok(
      withRunway.depositNeeded > baseline.depositNeeded,
      `deposit with runway (${withRunway.depositNeeded}) should exceed baseline (${baseline.depositNeeded})`
    )

    // runway = (currentLockupRate + rateDeltaPerEpoch) * extraRunwayEpochs
    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const ratePerEpoch = (parseUnits('2.5', 18) * pricedSize) / ((1n << 40n) * 86400n) + parseUnits('0.12', 18) / 86400n
    const expectedRunway = ratePerEpoch * 10_000n
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
      pieceSizes: [1n],
      bufferEpochs: 0n,
    })

    const largeBuffer = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [1n],
      bufferEpochs: 100n,
    })

    assert.ok(
      largeBuffer.depositNeeded > smallBuffer.depositNeeded,
      `deposit with buffer=100 (${largeBuffer.depositNeeded}) should exceed buffer=0 (${smallBuffer.depositNeeded})`
    )

    // Buffer delta = netRate * bufferEpochs = (currentLockupRate + rateDelta) * 100
    const pricedSize = leafCountToRawSize(rawSizeToLeafCount(1n))
    const ratePerEpoch = (parseUnits('2.5', 18) * pricedSize) / ((1n << 40n) * 86400n) + parseUnits('0.12', 18) / 86400n
    const netRate = 100_000_000_000_000n + ratePerEpoch
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
      pieceSizes: [halfTiB],
      isNewDataSet: false,
      dataSetLeafCount: rawSizeToLeafCount(halfTiB),
      currentLifecycleReserveBalance: parseUnits('0.5', 18),
      pdpEndEpoch: 0n,
    })

    // New dataset: 0.5 TiB → 0.5 TiB rate
    const newDs = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [halfTiB],
      isNewDataSet: true,
    })

    const finalPricedSize = leafCountToRawSize(rawSizeToLeafCount(halfTiB) * 2n)
    const expectedExistingRate = (parseUnits('2.5', 18) * finalPricedSize) / (1n << 40n) + parseUnits('0.12', 18)
    assert.equal(existing.rates.perMonth, expectedExistingRate)
    assert.ok(
      existing.rates.perMonth > newDs.rates.perMonth,
      `existing dataset rate (${existing.rates.perMonth}) should exceed new dataset rate (${newDs.rates.perMonth})`
    )
  })

  it('should reject incomplete existing data-set state', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({ chain: calibration, transport: http() })

    await assert.rejects(
      getUploadCosts(client, {
        clientAddress: ADDRESSES.client1,
        pieceSizes: [1n],
        isNewDataSet: false,
        currentLifecycleReserveBalance: parseUnits('0.5', 18),
      }),
      /dataSetLeafCount is required/
    )
    await assert.rejects(
      getUploadCosts(client, {
        clientAddress: ADDRESSES.client1,
        pieceSizes: [1n],
        isNewDataSet: false,
        dataSetLeafCount: 0n,
      }),
      /currentLifecycleReserveBalance is required/
    )
    await assert.rejects(
      getUploadCosts(client, {
        clientAddress: ADDRESSES.client1,
        pieceSizes: [1n],
        isNewDataSet: false,
        dataSetLeafCount: 0n,
        currentLifecycleReserveBalance: parseUnits('0.5', 18),
      }),
      /pdpEndEpoch is required/
    )
  })

  it('should reject a terminated existing data set before reading account state', async () => {
    const client = createPublicClient({ chain: calibration, transport: http() })

    await assert.rejects(
      getUploadCosts(client, {
        clientAddress: ADDRESSES.client1,
        pieceSizes: [1n],
        isNewDataSet: false,
        dataSetLeafCount: 0n,
        currentLifecycleReserveBalance: parseUnits('0.5', 18),
        pdpEndEpoch: 42n,
      }),
      ServiceAlreadyTerminatedError
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
      pieceSizes: [1n],
      withCDN: false,
    })

    const withCDN = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [1n],
      withCDN: true,
    })

    const cdnFixedLockupTotal = 1_000_000_000_000_000_000n
    assert.equal(
      withCDN.depositNeeded - withoutCDN.depositNeeded,
      cdnFixedLockupTotal,
      'CDN deposit should exceed non-CDN deposit by the CDN and cache-miss lockups'
    )
  })

  it('uses the lifecycle lockups as the required deposit for a fresh account', async () => {
    // Fresh account (no funds, no existing rails) creating a new dataset: with
    // default runway/buffer this isolates the deposit to the required lockups.
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

    const result = await getUploadCosts(client, {
      clientAddress: ADDRESSES.client1,
      pieceSizes: [1n],
    })

    assert.ok(result.fees.total > 0n)
    assert.equal(result.lockups.reserveReplenishment, 0n)
    assert.equal(result.depositNeeded, result.lockups.total)
  })
})
