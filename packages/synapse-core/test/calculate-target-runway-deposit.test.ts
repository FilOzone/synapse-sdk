/* globals describe it */

import assert from 'assert'
import { calculateTargetRunwayDeposit } from '../src/pay/index.ts'

const params = {
  availableFunds: 0n,
  debt: 0n,
  lockupRatePerEpoch: 10n,
  targetRunwayInEpochs: 50n,
}

describe('calculateTargetRunwayDeposit', () => {
  it('returns the exact shortfall for a healthy underfunded account', () => {
    assert.equal(calculateTargetRunwayDeposit({ ...params, availableFunds: 400n }), 100n)
  })

  it('returns zero when the target is exactly met or exceeded', () => {
    for (const availableFunds of [500n, 600n]) {
      assert.equal(calculateTargetRunwayDeposit({ ...params, availableFunds }), 0n)
    }
  })

  it('includes current debt for an account in deficit', () => {
    assert.equal(calculateTargetRunwayDeposit({ ...params, debt: 75n }), 575n)
  })

  it('does not create a runway requirement when the per-epoch rate is zero', () => {
    assert.equal(calculateTargetRunwayDeposit({ ...params, lockupRatePerEpoch: 0n }), 0n)
    assert.equal(
      calculateTargetRunwayDeposit({ ...params, availableFunds: 50n, debt: 75n, lockupRatePerEpoch: 0n }),
      25n
    )
  })
})
