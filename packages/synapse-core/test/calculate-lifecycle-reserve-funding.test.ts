/* globals describe it */

import assert from 'assert'
import { parseUnits } from 'viem'
import { calculateLifecycleReserveFunding } from '../src/warm-storage/calculate-lifecycle-reserve-funding.ts'
import type { getPriceList } from '../src/warm-storage/price-list.ts'

const priceList = {
  token: '0x0000000000000000000000000000000000000001',
  rates: {
    storagePerTibPerMonth: parseUnits('2.5', 18),
    datasetFeePerMonth: parseUnits('0.12', 18),
    cdnEgressPerTib: parseUnits('7', 18),
    cacheMissEgressPerTib: parseUnits('7', 18),
  },
  fees: {
    createDataSetFee: parseUnits('0.025', 18),
    addPiecesBaseFee: parseUnits('0.008', 18),
    addPiecesPerPieceFee: parseUnits('0.003', 18),
    schedulePieceRemovalsFee: parseUnits('0.007', 18),
    terminateFee: parseUnits('0.006', 18),
  },
  lockups: {
    lifecycleReserveTarget: parseUnits('0.5', 18),
    replenishThreshold: parseUnits('0.025', 18),
    defaultLockupPeriod: 86_400n,
    cdnLockupAmount: parseUnits('0.7', 18),
    cacheMissLockupAmount: parseUnits('0.3', 18),
    cdnLockupPeriod: 14_400n,
  },
} satisfies getPriceList.OutputType

describe('calculateLifecycleReserveFunding', () => {
  it('funds a new reserve once and pays create/add fees from it', () => {
    const result = calculateLifecycleReserveFunding({
      priceList,
      isNewDataSet: true,
      pieceSizes: [1n],
    })

    assert.equal(result.initialLockup, parseUnits('0.5', 18))
    assert.equal(result.replenishmentLockup, 0n)
    assert.equal(result.total, parseUnits('0.5', 18))
    assert.equal(result.finalReserveBalance, parseUnits('0.464', 18))
  })

  it('does not replenish when the reserve equals the pending fees plus threshold', () => {
    const result = calculateLifecycleReserveFunding({
      priceList,
      isNewDataSet: false,
      pieceSizes: [1n],
      currentReserveBalance: parseUnits('0.036', 18),
    })

    assert.equal(result.initialLockup, 0n)
    assert.equal(result.replenishmentLockup, 0n)
    assert.equal(result.finalReserveBalance, parseUnits('0.025', 18))
  })

  it('requests the full fixed-lockup increase when replenishment triggers', () => {
    const result = calculateLifecycleReserveFunding({
      priceList,
      isNewDataSet: false,
      pieceSizes: [1n],
      currentReserveBalance: parseUnits('0.03', 18),
    })

    assert.equal(result.replenishmentLockup, parseUnits('0.481', 18))
    assert.equal(result.finalReserveBalance, parseUnits('0.5', 18))
  })

  it('includes fees already pending on the data set in the next flush', () => {
    const result = calculateLifecycleReserveFunding({
      priceList,
      isNewDataSet: false,
      pieceSizes: [1n],
      currentReserveBalance: parseUnits('0.04', 18),
      pendingOneTimePayments: parseUnits('0.007', 18),
    })

    assert.equal(result.replenishmentLockup, parseUnits('0.478', 18))
    assert.equal(result.finalReserveBalance, parseUnits('0.5', 18))
  })

  it('rejects missing existing reserve state', () => {
    assert.throws(
      () => calculateLifecycleReserveFunding({ priceList, isNewDataSet: false, pieceSizes: [1n] }),
      /currentReserveBalance is required/
    )
  })
})
