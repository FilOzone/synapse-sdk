/* globals describe it */

import assert from 'assert'
import { maxUint256 } from 'viem'
import { calculateAccountDebt } from '../src/pay/account-debt.ts'
import { getAccountInfoIfSettled } from '../src/pay/get-account-info-if-settled.ts'

describe('getAccountInfoIfSettled', () => {
  it('healthy account: funds > lockup → correct availableFunds and fundedUntilEpoch', () => {
    const result = getAccountInfoIfSettled({
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
    assert.equal(result.currentFunds, 1000n)
    assert.equal(result.currentLockupRate, 1n)
  })

  it('underfunded account: lockup > funds → availableFunds = 0, fundedUntilEpoch < currentEpoch', () => {
    const result = getAccountInfoIfSettled({
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
  })

  it('zero lockupRate → fundedUntilEpoch = maxUint256', () => {
    const result = getAccountInfoIfSettled({
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
  })
})

describe('calculateAccountDebt', () => {
  it('healthy account: debt = 0, availableFunds > 0', () => {
    const result = calculateAccountDebt({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // totalOwed = 100 + 1 * 100 = 200
    // debt = max(0, 200 - 1000) = 0
    assert.equal(result.debt, 0n)
    assert.equal(result.availableFunds, 800n)
    assert.equal(result.fundedUntilEpoch, 900n)
  })

  it('underfunded account: debt > 0, availableFunds = 0', () => {
    const result = calculateAccountDebt({
      funds: 100n,
      lockupCurrent: 50n,
      lockupRate: 1n,
      lockupLastSettledAt: 0n,
      currentEpoch: 200n,
    })

    // totalOwed = 50 + 1 * 200 = 250
    // debt = max(0, 250 - 100) = 150
    assert.equal(result.debt, 150n)
    assert.equal(result.availableFunds, 0n)
    assert.equal(result.fundedUntilEpoch, 50n)
  })

  it('zero lockupRate: debt = 0, fundedUntilEpoch = maxUint256', () => {
    const result = calculateAccountDebt({
      funds: 1000n,
      lockupCurrent: 100n,
      lockupRate: 0n,
      lockupLastSettledAt: 0n,
      currentEpoch: 100n,
    })

    // totalOwed = 100 + 0 * 100 = 100
    // debt = max(0, 100 - 1000) = 0
    assert.equal(result.debt, 0n)
    assert.equal(result.fundedUntilEpoch, maxUint256)
    assert.equal(result.availableFunds, 900n)
  })
})
