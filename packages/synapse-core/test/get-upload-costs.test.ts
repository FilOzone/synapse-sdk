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
      dataSize: 1n,
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
      dataSize: 1n,
    })

    // Additive: 1-byte dataset pays a tiny storage rate on top of proving.
    const storagePerMonth1Byte = parseUnits('2.5', 18) / (1n << 40n)
    assert.equal(result.rates.perMonth, parseUnits('0.024', 18) + storagePerMonth1Byte)
    assert.equal(result.fees.createDataSetFee, parseUnits('0.025', 18))
    assert.equal(result.fees.addPiecesFee, parseUnits('0.0008', 18))
    assert.equal(result.lockups.lifecycleLockup, parseUnits('0.10', 18))
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
      dataSize: onetiB,
    })

    // 1 TiB storage plus proving service rate.
    const pricePerTiBPerMonth = parseUnits('2.5', 18)
    assert.equal(result.rates.perMonth, pricePerTiBPerMonth + parseUnits('0.024', 18))
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
    // currentLockupRate = 0; rateDeltaPerEpoch = storage(1 byte) + proving, per epoch
    const ratePerEpoch1Byte = parseUnits('2.5', 18) / ((1n << 40n) * 86400n) + parseUnits('0.024', 18) / 86400n
    const expectedRunway = ratePerEpoch1Byte * 10_000n
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
    const ratePerEpoch1Byte = parseUnits('2.5', 18) / ((1n << 40n) * 86400n) + parseUnits('0.024', 18) / 86400n
    const netRate = 100_000_000_000_000n + ratePerEpoch1Byte
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

    // Existing dataset pays storage for 1 TiB plus one proving service rate.
    assert.equal(existing.rates.perMonth, parseUnits('2.524', 18))
    assert.ok(
      existing.rates.perMonth > newDs.rates.perMonth,
      `existing dataset rate (${existing.rates.perMonth}) should exceed new dataset rate (${newDs.rates.perMonth})`
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

    const cdnFixedLockupTotal = 1_000_000_000_000_000_000n
    assert.equal(
      withCDN.depositNeeded - withoutCDN.depositNeeded,
      cdnFixedLockupTotal,
      'CDN deposit should exceed non-CDN deposit by the CDN and cache-miss lockups'
    )
  })

  it('includes operation fees in the deposit for a new dataset', async () => {
    // Fresh account (no funds, no existing rails) creating a new dataset: with
    // default runway/buffer this isolates the deposit to lockups + fees, so it
    // proves operation fees are actually counted in depositNeeded.
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
      dataSize: 1n,
    })

    assert.ok(result.fees.total > 0n)
    assert.equal(result.depositNeeded, result.lockups.total + result.fees.total)
  })

  it('derives an extra addPieces operation fee when pieceCount exceeds the batch limit', async () => {
    server.use(JSONRPC(presets.basic))

    const client = createPublicClient({ chain: calibration, transport: http() })

    const within = await getUploadCosts(client, { clientAddress: ADDRESSES.client1, dataSize: 1n, pieceCount: 40n })
    const spill = await getUploadCosts(client, { clientAddress: ADDRESSES.client1, dataSize: 1n, pieceCount: 41n })

    // 41 pieces span two addPieces ops (ceil(41/40) = 2), so the 41-piece cost
    // adds exactly one extra base fee plus one extra per-piece fee over 40.
    assert.equal(
      spill.fees.addPiecesFee - within.fees.addPiecesFee,
      parseUnits('0.0005', 18) + parseUnits('0.0003', 18)
    )
  })
})
