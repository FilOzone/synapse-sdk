/* globals describe it */

import assert from 'assert'
import { maxUint256 } from 'viem'
import {
  calculateBufferAmount,
  calculateDepositNeeded,
  calculateRunwayAmount,
} from '../src/warm-storage/calculate-deposit-needed.ts'
import type { getPriceList } from '../src/warm-storage/price-list.ts'

const priceList = {
  token: '0x0000000000000000000000000000000000000001',
  rates: {
    storagePerTibPerMonth: 2_500_000_000_000_000_000n,
    datasetFeePerMonth: 24_000_000_000_000_000n,
    cdnEgressPerTib: 0n,
    cacheMissEgressPerTib: 0n,
  },
  fees: {
    createDataSetFee: 25_000_000_000_000_000n,
    addPiecesBaseFee: 500_000_000_000_000n,
    addPiecesPerPieceFee: 300_000_000_000_000n,
    schedulePieceRemovalsFee: 2_000_000_000_000_000n,
    terminateFee: 1_120_000_000_000_000n,
  },
  lockups: {
    lifecycleReserveTarget: 100_000_000_000_000_000n,
    replenishThreshold: 5_000_000_000_000_000n,
    defaultLockupPeriod: 86_400n,
    cdnLockupAmount: 700_000_000_000_000_000n,
    cacheMissLockupAmount: 300_000_000_000_000_000n,
    cdnLockupPeriod: 14_400n,
  },
} satisfies getPriceList.OutputType

describe('calculateRunwayAmount', () => {
  it('computes netRateAfterUpload * extraRunwayEpochs', () => {
    const result = calculateRunwayAmount({
      netRateAfterUpload: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      extraRunwayEpochs: 100n,
    })

    assert.equal(result, 15n * 100n)
    assert.equal(result, 1500n)
  })
})

describe('calculateBufferAmount', () => {
  it('rawDepositNeeded > 0: returns netRateAfterUpload * bufferEpochs', () => {
    const result = calculateBufferAmount({
      rawDepositNeeded: 100n,
      netRateAfterUpload: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      runwayInEpochs: 400n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    // buffer = 15 * 20 = 300
    assert.equal(result, 15n * 20n)
    assert.equal(result, 300n)
  })

  it('rawDepositNeeded > 0, zero delta: returns netRateAfterUpload * bufferEpochs', () => {
    const result = calculateBufferAmount({
      rawDepositNeeded: 100n,
      netRateAfterUpload: 10n, // no delta, just currentLockupRate
      runwayInEpochs: 400n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    assert.equal(result, 10n * 20n)
    assert.equal(result, 200n)
  })

  it('rawDepositNeeded <= 0, runway within buffer window: returns max(0, netRateAfterUpload*buffer - available)', () => {
    // runwayInEpochs (10) <= bufferEpochs (20), within buffer window
    const result = calculateBufferAmount({
      rawDepositNeeded: -50n,
      netRateAfterUpload: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      runwayInEpochs: 10n,
      availableFunds: 50n,
      bufferEpochs: 20n,
    })

    // bufferCost = 15 * 20 = 300, needed = 300 - 50 = 250
    assert.equal(result, 250n)
  })

  it('rawDepositNeeded <= 0, runway beyond buffer window: returns 0', () => {
    // runwayInEpochs (400) > bufferEpochs (20), beyond buffer window
    const result = calculateBufferAmount({
      rawDepositNeeded: -50n,
      netRateAfterUpload: 15n,
      runwayInEpochs: 400n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    assert.equal(result, 0n)
  })

  it('rawDepositNeeded <= 0, infinite runway (lockupRate 0n): returns 0', () => {
    // runwayInEpochs is maxUint256 when nothing is draining
    const result = calculateBufferAmount({
      rawDepositNeeded: -50n,
      netRateAfterUpload: 0n,
      runwayInEpochs: maxUint256,
      availableFunds: 1000n,
      bufferEpochs: 20n,
    })

    assert.equal(result, 0n)
  })
})

describe('calculateDepositNeeded', () => {
  it('healthy account, no debt, sufficient funds: returns 0', () => {
    const result = calculateDepositNeeded({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      priceList,
      lockupEpochs: 86400n,
      isNewDataSet: true,
      withCDN: false,
      currentLockupRate: 0n,
      extraRunwayEpochs: 0n,
      debt: 0n,
      availableFunds: 100_000_000_000_000_000_000n, // 100 USDFC, way more than needed
      runwayInEpochs: maxUint256,
      bufferEpochs: 10n,
    })

    assert.equal(result.depositNeeded, 0n)
  })

  it('new dataset + no existing rails: buffer skipped', () => {
    const base = {
      dataSize: 1000n,
      currentDataSetSize: 0n,
      priceList,
      lockupEpochs: 86400n,
      isNewDataSet: true,
      withCDN: false,
      currentLockupRate: 0n,
      extraRunwayEpochs: 0n,
      debt: 0n,
      availableFunds: 0n,
      runwayInEpochs: 0n,
    }

    const withBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 100n })
    const withoutBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 0n })

    // No existing rails (currentLockupRate=0) + new dataset, buffer skipped
    assert.equal(withBuffer.depositNeeded, withoutBuffer.depositNeeded)
    assert.ok(withBuffer.depositNeeded > 0n) // still requires the lockup deposit
  })

  it('new dataset + existing rails: buffer still applies', () => {
    const base = {
      dataSize: 1000n,
      currentDataSetSize: 0n,
      priceList,
      lockupEpochs: 86400n,
      isNewDataSet: true,
      withCDN: false,
      currentLockupRate: 100_000_000_000_000n, // existing rails draining
      extraRunwayEpochs: 0n,
      debt: 0n,
      availableFunds: 0n,
      runwayInEpochs: 0n,
    }

    const withBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 100n })
    const withoutBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 0n })

    // Existing rails draining, buffer must apply even for new dataset
    assert.ok(withBuffer.depositNeeded > withoutBuffer.depositNeeded)
  })

  it('underfunded account with debt: includes debt in deposit', () => {
    const debt = 5_000_000_000_000_000_000n // 5 USDFC debt
    const result = calculateDepositNeeded({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      priceList,
      lockupEpochs: 86400n,
      isNewDataSet: true,
      withCDN: false,
      currentLockupRate: 10n,
      extraRunwayEpochs: 0n,
      debt,
      availableFunds: 0n,
      runwayInEpochs: 0n,
      bufferEpochs: 10n,
    })

    // Result should include the debt, and the deposit covers debt + fees + lockup.
    assert.ok(result.fees.total > 0n)
    assert.ok(result.depositNeeded >= debt + result.fees.total + result.lockup.total)
  })
})
