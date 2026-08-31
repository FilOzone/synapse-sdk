/* globals describe it */

import assert from 'assert'
import { calculateUploadFees } from '../src/warm-storage/calculate-upload-fees.ts'

const priceList = {
  token: '0x00000000000000000000000000000000000000aa' as const,
  rates: {
    storagePerTibPerMonth: 0n,
    datasetFeePerMonth: 0n,
    cdnEgressPerTib: 0n,
    cacheMissEgressPerTib: 0n,
  },
  fees: {
    createDataSetFee: 100n,
    addPiecesBaseFee: 10n,
    addPiecesPerPieceFee: 1n,
    schedulePieceRemovalsFee: 0n,
    terminateFee: 0n,
  },
  lockups: {
    lifecycleReserveTarget: 0n,
    replenishThreshold: 0n,
    defaultLockupPeriod: 0n,
    cdnLockupAmount: 0n,
    cacheMissLockupAmount: 0n,
    cdnLockupPeriod: 0n,
  },
}

describe('calculateUploadFees', () => {
  it('rejects empty and non-positive piece sizes', () => {
    assert.throws(
      () => calculateUploadFees({ priceList, isNewDataSet: false, pieceSizes: [] }),
      /pieceSizes must contain at least one piece/
    )
    assert.throws(
      () => calculateUploadFees({ priceList, isNewDataSet: false, pieceSizes: [-1n] }),
      /pieceSizes must contain only positive byte sizes/
    )
  })

  it('charges the create fee only for new datasets', () => {
    const existing = calculateUploadFees({ priceList, isNewDataSet: false, pieceSizes: [1n] })
    const fresh = calculateUploadFees({ priceList, isNewDataSet: true, pieceSizes: [1n] })

    assert.equal(existing.createDataSetFee, 0n)
    assert.equal(fresh.createDataSetFee, priceList.fees.createDataSetFee)
  })

  it('conservatively charges one add-pieces operation per piece', () => {
    const pieceSizes = [1n, 2n, 3n]
    const result = calculateUploadFees({ priceList, isNewDataSet: false, pieceSizes })
    assert.equal(result.addPiecesFee, (priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee) * 3n)
    assert.equal(result.total, result.addPiecesFee)
  })
})
