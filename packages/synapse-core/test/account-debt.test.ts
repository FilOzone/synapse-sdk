/* globals describe it */

import assert from 'assert'
import { maxUint256 } from 'viem'
import { calculateAccountDebt } from '../src/pay/account-debt.ts'
import { resolveAccountState } from '../src/pay/resolve-account-state.ts'

describe('resolveAccountState', () => {
  it('healthy account: funds > lockup → correct availableFunds, fundedUntilEpoch, runwayInEpochs', () => {
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // fundedUntilEpoch = 0 + (1000 - 100) / 1 = 900
    assert.equal(result.fundedUntilEpoch, 900n)

    // simulatedSettledAt = min(900, 100) = 100
    // simulatedLockupCurrent = 100 + 1 * (100 - 0) = 200
    // availableFunds = max(0, 1000 - 200) = 800
    assert.equal(result.availableFunds, 800n)

    // runwayInEpochs = fundedUntilEpoch - currentEpoch = 900 - 100 = 800
    assert.equal(result.runwayInEpochs, 800n)
  })

  it('underfunded account: lockup > funds → availableFunds = 0, fundedUntilEpoch < currentEpoch, runway = 0', () => {
    const result = resolveAccountState({
      funds: 100n,
      lockupCurrent: 200n,
      lockupRate: 2n,
      lockupLastSettledAt: 1000n,
      currentEpoch: 1200n,
    })

    // fundedUntilEpoch = 1000 + (100 - 200) / 2 = 1000 + (-50) = 950
    assert.equal(result.fundedUntilEpoch, 950n)
    assert.ok(result.fundedUntilEpoch < 1200n)

    // simulatedSettledAt = min(950, 1200) = 950
    // simulatedLockupCurrent = 200 + 2 * (950 - 1000) = 200 + (-100) = 100
    // availableFunds = max(0, 100 - 100) = 0
    assert.equal(result.availableFunds, 0n)

    // fundedUntilEpoch < currentEpoch → runway clamped to 0n
    assert.equal(result.runwayInEpochs, 0n)
  })

  it('partially funded account: funds > lockupCurrent but runs out before currentEpoch', () => {
    const result = resolveAccountState({
      funds: 100n,
      lockupCurrent: 50n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 200n,
    })

    // fundedUntilEpoch = 0 + (100 - 50) / 1 = 50
    assert.equal(result.fundedUntilEpoch, 50n)
    assert.ok(result.fundedUntilEpoch < 200n)

    // simulatedSettledAt = min(50, 200) = 50
    // simulatedLockupCurrent = 50 + 1 * (50 - 0) = 100
    // availableFunds = max(0, 100 - 100) = 0
    assert.equal(result.availableFunds, 0n)

    // ran out 150 epochs ago → runway = 0n
    assert.equal(result.runwayInEpochs, 0n)
  })

  it('zero lockupRate → fundedUntilEpoch = maxUint256, runway = maxUint256', () => {
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 0n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    assert.equal(result.fundedUntilEpoch, maxUint256)

    // simulatedSettledAt = min(maxUint256, 100) = 100
    // simulatedLockupCurrent = 100 + 0 * (100 - 0) = 100
    // availableFunds = max(0, 1000 - 100) = 900
    assert.equal(result.availableFunds, 900n)

    // zero rate → infinite runway
    assert.equal(result.runwayInEpochs, maxUint256)
  })

  it('zero lockupRate with zero funds → runway = maxUint256 (no drain)', () => {
    const result = resolveAccountState({
      funds: 0n,
      lockupCurrent: 0n,
      lockupRate: 0n,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    assert.equal(result.fundedUntilEpoch, maxUint256)
    assert.equal(result.availableFunds, 0n)
    assert.equal(result.runwayInEpochs, maxUint256)
  })

  it('fundedUntilEpoch exactly equals currentEpoch → runway = 0n', () => {
    // fundedUntilEpoch = 0 + (1000 - 0) / 10 = 100
    // currentEpoch = 100 → just hit the funded epoch, no more runway
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 0n,
      lockupRate: 10n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    assert.equal(result.fundedUntilEpoch, 100n)
    assert.equal(result.runwayInEpochs, 0n)
  })

  it('fixed lockup implicit in lockupCurrent: held but does not drain', () => {
    // funds=500, lockupCurrent=100 (all fixed lockup), rate=1, settledAt=1000, currentEpoch=1200
    // fundedUntilEpoch = 1000 + (500 - 100) / 1 = 1400
    // simulatedSettledAt = min(1400, 1200) = 1200
    // simulatedLockupCurrent = 100 + 1 * (1200 - 1000) = 300
    // availableFunds = max(0, 500 - 300) = 200
    // runway = 1400 - 1200 = 200
    const result = resolveAccountState({
      funds: 500n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 1000n,
      currentEpoch: 1200n,
    })

    assert.equal(result.fundedUntilEpoch, 1400n)
    assert.equal(result.availableFunds, 200n)
    assert.equal(result.runwayInEpochs, 200n)
  })

  it('realistic USDFC numbers: 100 USDFC funds, 1 USDFC/day rate', () => {
    const oneUsdfc = 1_000_000_000_000_000_000n
    const epochsPerDay = 2880n
    const ratePerEpoch = oneUsdfc / epochsPerDay

    const result = resolveAccountState({
      funds: 100n * oneUsdfc,
      lockupCurrent: 0n,
      lockupRate: ratePerEpoch,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    // ~100 days of runway = 100 * 2880 epochs, with rounding from integer div
    assert.ok(
      result.runwayInEpochs > 287_000n && result.runwayInEpochs <= 300_000n,
      `expected ~288000, got ${result.runwayInEpochs}`
    )
  })

  it('truncation: (funds - lockupCurrent) divisible by lockupRate', () => {
    // funds=10, lockupCurrent=1, lockupRate=3, settledAt=0, currentEpoch=0
    // fundedUntilEpoch = 0 + (10 - 1) / 3 = 3 (exact)
    const result = resolveAccountState({
      funds: 10n,
      lockupCurrent: 1n,
      lockupRate: 3n,
      lockupLastSettledAt: 0n,
      currentEpoch: 0n,
    })

    assert.equal(result.fundedUntilEpoch, 3n)
    assert.equal(result.runwayInEpochs, 3n)
  })

  it('truncation with remainder: (funds - lockupCurrent) not divisible by lockupRate', () => {
    // funds=10, lockupCurrent=0, lockupRate=3, settledAt=0, currentEpoch=0
    // fundedUntilEpoch = 0 + 10 / 3 = 3 (remainder discarded)
    const result = resolveAccountState({
      funds: 10n,
      lockupCurrent: 0n,
      lockupRate: 3n,
      lockupLastSettledAt: 0n,
      currentEpoch: 0n,
    })

    assert.equal(result.fundedUntilEpoch, 3n)
    assert.equal(result.runwayInEpochs, 3n)
  })
})

describe('calculateAccountDebt', () => {
  it('healthy account: debt = 0', () => {
    const result = calculateAccountDebt({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // totalOwed = 100 + 1 * 100 = 200
    // debt = max(0, 200 - 1000) = 0
    assert.equal(result, 0n)
  })

  it('underfunded account: debt > 0', () => {
    const result = calculateAccountDebt({
      funds: 100n,
      lockupCurrent: 50n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 200n,
    })

    // totalOwed = 50 + 1 * 200 = 250
    // debt = max(0, 250 - 100) = 150
    assert.equal(result, 150n)
  })

  it('zero lockupRate: debt = 0', () => {
    const result = calculateAccountDebt({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 0n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // totalOwed = 100 + 0 * 100 = 100
    // debt = max(0, 100 - 1000) = 0
    assert.equal(result, 0n)
  })
})
