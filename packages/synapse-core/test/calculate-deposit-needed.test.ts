/* globals describe it */

import assert from 'assert'
import { maxUint256 } from 'viem'
import {
  calculateBufferAmount,
  calculateDepositNeeded,
  calculateRunwayAmount,
} from '../src/warm-storage/calculate-deposit-needed.ts'

describe('calculateRunwayAmount', () => {
  it('computes netRate * runwayEpochs', () => {
    const result = calculateRunwayAmount({
      netRate: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      runwayEpochs: 100n,
    })

    assert.equal(result, 15n * 100n)
    assert.equal(result, 1500n)
  })
})

describe('calculateBufferAmount', () => {
  it('rawDepositNeeded > 0: returns netRate * bufferEpochs', () => {
    const result = calculateBufferAmount({
      rawDepositNeeded: 100n,
      netRate: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      fundedUntilEpoch: 500n,
      currentEpoch: 100n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    // buffer = 15 * 20 = 300
    assert.equal(result, 15n * 20n)
    assert.equal(result, 300n)
  })

  it('rawDepositNeeded > 0, zero delta: returns netRate * bufferEpochs', () => {
    const result = calculateBufferAmount({
      rawDepositNeeded: 100n,
      netRate: 10n, // no delta — just currentLockupRate
      fundedUntilEpoch: 500n,
      currentEpoch: 100n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    assert.equal(result, 10n * 20n)
    assert.equal(result, 200n)
  })

  it('rawDepositNeeded <= 0, fundedUntilEpoch within buffer window: returns max(0, netRate*buffer - available)', () => {
    // fundedUntilEpoch = 110, currentEpoch = 100, bufferEpochs = 20
    // 110 <= 100 + 20 = 120, so within buffer window
    const result = calculateBufferAmount({
      rawDepositNeeded: -50n,
      netRate: 15n, // e.g. currentLockupRate(10) + rateDelta(5)
      fundedUntilEpoch: 110n,
      currentEpoch: 100n,
      availableFunds: 50n,
      bufferEpochs: 20n,
    })

    // bufferCost = 15 * 20 = 300, needed = 300 - 50 = 250
    assert.equal(result, 250n)
  })

  it('rawDepositNeeded <= 0, fundedUntilEpoch beyond buffer window: returns 0', () => {
    // fundedUntilEpoch = 500, currentEpoch = 100, bufferEpochs = 20
    // 500 > 100 + 20 = 120, so beyond buffer window
    const result = calculateBufferAmount({
      rawDepositNeeded: -50n,
      netRate: 15n,
      fundedUntilEpoch: 500n,
      currentEpoch: 100n,
      availableFunds: 200n,
      bufferEpochs: 20n,
    })

    assert.equal(result, 0n)
  })
})

describe('calculateDepositNeeded', () => {
  const pricing = {
    pricePerTiBPerMonth: 2_500_000_000_000_000_000n,
    minimumPricePerMonth: 60_000_000_000_000_000n,
    epochsPerMonth: 86400n,
  }

  it('healthy account, no debt, sufficient funds: returns 0', () => {
    const result = calculateDepositNeeded({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs: 86400n,
      isNewDataset: true,
      withCDN: false,
      currentLockupRate: 0n,
      runwayEpochs: 0n,
      debt: 0n,
      availableFunds: 100_000_000_000_000_000_000n, // 100 USDFC - way more than needed
      fundedUntilEpoch: maxUint256,
      currentEpoch: 1000n,
      bufferEpochs: 10n,
    })

    assert.equal(result, 0n)
  })

  it('new dataset + no existing rails: buffer skipped', () => {
    const base = {
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs: 86400n,
      isNewDataset: true,
      withCDN: false,
      currentLockupRate: 0n,
      runwayEpochs: 0n,
      debt: 0n,
      availableFunds: 0n,
      fundedUntilEpoch: 0n,
      currentEpoch: 1000n,
    }

    const withBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 100n })
    const withoutBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 0n })

    // No existing rails (currentLockupRate=0) + new dataset → buffer skipped
    assert.equal(withBuffer, withoutBuffer)
    assert.ok(withBuffer > 0n) // still requires the lockup deposit
  })

  it('new dataset + existing rails: buffer still applies', () => {
    const base = {
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs: 86400n,
      isNewDataset: true,
      withCDN: false,
      currentLockupRate: 100_000_000_000_000n, // existing rails draining
      runwayEpochs: 0n,
      debt: 0n,
      availableFunds: 0n,
      fundedUntilEpoch: 0n,
      currentEpoch: 1000n,
    }

    const withBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 100n })
    const withoutBuffer = calculateDepositNeeded({ ...base, bufferEpochs: 0n })

    // Existing rails draining → buffer must apply even for new dataset
    assert.ok(withBuffer > withoutBuffer)
  })

  it('underfunded account with debt: includes debt in deposit', () => {
    const debt = 5_000_000_000_000_000_000n // 5 USDFC debt
    const result = calculateDepositNeeded({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs: 86400n,
      isNewDataset: true,
      withCDN: false,
      currentLockupRate: 10n,
      runwayEpochs: 0n,
      debt,
      availableFunds: 0n,
      fundedUntilEpoch: 50n,
      currentEpoch: 1000n,
      bufferEpochs: 10n,
    })

    // Result should include the debt
    assert.ok(result >= debt)
  })
})
