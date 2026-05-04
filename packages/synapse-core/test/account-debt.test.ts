/* globals describe it */

import assert from 'assert'
import { maxUint256 } from 'viem'
import { calculateAccountDebt } from '../src/pay/account-debt.ts'
import { resolveAccountState } from '../src/pay/resolve-account-state.ts'

describe('resolveAccountState', () => {
  it('healthy account: funds > lockup, correct availableFunds and runwayInEpochs', () => {
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // simulatedSettledAt = min(900, 100) = 100
    // simulatedLockupCurrent = 100 + 1 * (100 - 0) = 200
    // availableFunds = max(0, 1000 - 200) = 800
    assert.equal(result.availableFunds, 800n)

    // runwayInEpochs = (funds - lockupCurrent) / lockupRate - elapsed
    //                = (1000 - 100) / 1 - 100 = 800
    assert.equal(result.runwayInEpochs, 800n)

    // grossCoverageInEpochs = 1000 / 1 = 1000
    assert.equal(result.grossCoverageInEpochs, 1000n)
  })

  it('underfunded account: lockup > funds, availableFunds = 0, runway = 0', () => {
    const result = resolveAccountState({
      funds: 100n,
      lockupCurrent: 200n,
      lockupRate: 2n,
      lockupLastSettledAt: 1000n,
      currentEpoch: 1200n,
    })

    // simulatedLockupCurrent = 200 + 2 * (950 - 1000) = 100
    // availableFunds = max(0, 100 - 100) = 0
    assert.equal(result.availableFunds, 0n)

    // funds < lockupCurrent already at lockupLastSettledAt, account is in
    // deficit, runway clamped to 0n
    assert.equal(result.runwayInEpochs, 0n)

    // funds remain even after settlement halts: 100 / 2 = 50
    assert.equal(result.grossCoverageInEpochs, 50n)
  })

  it('partially funded account: funds > lockupCurrent but runs out before currentEpoch', () => {
    const result = resolveAccountState({
      funds: 100n,
      lockupCurrent: 50n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 200n,
    })

    // simulatedSettledAt = min(50, 200) = 50
    // simulatedLockupCurrent = 50 + 1 * (50 - 0) = 100
    // availableFunds = max(0, 100 - 100) = 0
    assert.equal(result.availableFunds, 0n)

    // ran out 150 epochs ago, runway = 0n
    assert.equal(result.runwayInEpochs, 0n)

    // 100 / 1 = 100
    assert.equal(result.grossCoverageInEpochs, 100n)
  })

  it('zero lockupRate, runway and gross coverage = maxUint256', () => {
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 0n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // availableFunds = max(0, 1000 - 100) = 900
    assert.equal(result.availableFunds, 900n)
    // zero rate: nothing draining, infinite for both numbers
    assert.equal(result.runwayInEpochs, maxUint256)
    assert.equal(result.grossCoverageInEpochs, maxUint256)
  })

  it('zero lockupRate with zero funds, runway = maxUint256 (no drain)', () => {
    // Zero rate takes precedence over zero funds: nothing is draining.
    const result = resolveAccountState({
      funds: 0n,
      lockupCurrent: 0n,
      lockupRate: 0n,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    assert.equal(result.availableFunds, 0n)
    assert.equal(result.runwayInEpochs, maxUint256)
    assert.equal(result.grossCoverageInEpochs, maxUint256)
  })

  it('zero funds with positive lockupRate, runway and gross coverage = 0n', () => {
    const result = resolveAccountState({
      funds: 0n,
      lockupCurrent: 0n,
      lockupRate: 1n,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    assert.equal(result.availableFunds, 0n)
    assert.equal(result.runwayInEpochs, 0n)
    assert.equal(result.grossCoverageInEpochs, 0n)
  })

  it('in-deficit user retains a positive grossCoverageInEpochs (filecoin-pin issue #385)', () => {
    // Reproduces the user-reported scenario: ~10.52 USDFC deposit, ~0.467
    // USDFC/day spend across many rails. With multiple datasets the operator
    // commits enough lockup that lockupCurrent grows past the deposit, so
    // settlement halts and runwayInEpochs clamps to 0n. The user is right
    // that money still sits in the account though, so grossCoverageInEpochs
    // must stay positive to support a meaningful "X days prepaid" display
    // even though no further payment will flow until they top up.
    const oneUsdfc = 1_000_000_000_000_000_000n
    const epochsPerDay = 2880n
    const ratePerDay = 467_000_000_000_000_000n // 0.467 USDFC/day
    const ratePerEpoch = ratePerDay / epochsPerDay
    const funds = (oneUsdfc * 10_5225n) / 10_000n // 10.5225 USDFC
    // lockupCurrent past funds simulates the delinquent state
    const lockupCurrent = ratePerDay * 30n

    const result = resolveAccountState({
      funds,
      lockupCurrent,
      lockupRate: ratePerEpoch,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    // Settlement-halt runway is zero: the user must act
    assert.equal(result.runwayInEpochs, 0n)
    // But the deposit still represents real days of coverage
    const expectedExhaustion = funds / ratePerEpoch
    assert.equal(result.grossCoverageInEpochs, expectedExhaustion)
    // ~22 days at 0.467 USDFC/day
    assert.ok(
      result.grossCoverageInEpochs > 60_000n && result.grossCoverageInEpochs < 70_000n,
      `expected ~22 days (~63360 epochs), got ${result.grossCoverageInEpochs}`
    )
  })

  it('boundary: just hit deficit at currentEpoch, runway = 0n', () => {
    // (funds - lockupCurrent) / lockupRate = (1000 - 0) / 10 = 100 epochs
    // currentEpoch = 100, exactly hit the deficit point, no more runway
    const result = resolveAccountState({
      funds: 1000n,
      lockupCurrent: 0n,
      lockupRate: 10n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    assert.equal(result.runwayInEpochs, 0n)
    // total funds horizon still positive: 1000 / 10 = 100
    assert.equal(result.grossCoverageInEpochs, 100n)
  })

  it('fixed lockup implicit in lockupCurrent: held but does not drain', () => {
    // funds=500, lockupCurrent=100 (all fixed lockup), rate=1, settledAt=1000, currentEpoch=1200
    // simulatedSettledAt = 1200; simulatedLockupCurrent = 100 + 1 * 200 = 300
    // availableFunds = 500 - 300 = 200
    // runway = (500 - 100) / 1 - (1200 - 1000) = 400 - 200 = 200
    const result = resolveAccountState({
      funds: 500n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 1000n,
      currentEpoch: 1200n,
    })

    assert.equal(result.availableFunds, 200n)
    assert.equal(result.runwayInEpochs, 200n)
    // 500 / 1 = 500
    assert.equal(result.grossCoverageInEpochs, 500n)
  })

  it('realistic USDFC numbers: 100 USDFC funds, 1 USDFC/day rate', () => {
    const oneUsdfc = 1_000_000_000_000_000_000n
    const epochsPerDay = 2880n
    const ratePerEpoch = oneUsdfc / epochsPerDay // truncated

    const result = resolveAccountState({
      funds: 100n * oneUsdfc,
      lockupCurrent: 0n,
      lockupRate: ratePerEpoch,
      lockupLastSettledAt: 1_000_000n,
      currentEpoch: 1_000_000n,
    })

    // ~100 days runway, exact value derives from the truncated rate
    const expected = (100n * oneUsdfc) / ratePerEpoch
    assert.equal(result.runwayInEpochs, expected)
    assert.equal(result.grossCoverageInEpochs, expected)
  })

  it('truncation: (funds - lockupCurrent) divisible by lockupRate', () => {
    // funds=10, lockupCurrent=1, lockupRate=3, settledAt=0, currentEpoch=0
    // runway = (10 - 1) / 3 = 3 (exact)
    const result = resolveAccountState({
      funds: 10n,
      lockupCurrent: 1n,
      lockupRate: 3n,
      lockupLastSettledAt: 0n,
      currentEpoch: 0n,
    })

    assert.equal(result.runwayInEpochs, 3n)
    // 10 / 3 = 3 (truncated)
    assert.equal(result.grossCoverageInEpochs, 3n)
  })

  it('truncation with remainder: (funds - lockupCurrent) not divisible by lockupRate', () => {
    // funds=10, lockupCurrent=0, lockupRate=3, settledAt=0, currentEpoch=0
    // runway = 10 / 3 = 3 (remainder discarded)
    const result = resolveAccountState({
      funds: 10n,
      lockupCurrent: 0n,
      lockupRate: 3n,
      lockupLastSettledAt: 0n,
      currentEpoch: 0n,
    })

    assert.equal(result.runwayInEpochs, 3n)
    assert.equal(result.grossCoverageInEpochs, 3n)
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
