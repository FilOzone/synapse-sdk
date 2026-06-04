/* globals describe it */

import assert from 'assert'
import { SIZE_CONSTANTS } from '../src/utils/constants.ts'
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

const maxBatch = BigInt(SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE)

describe('calculateUploadFees', () => {
  it('charges the create fee only for new datasets', () => {
    const existing = calculateUploadFees({ priceList, isNewDataSet: false })
    const fresh = calculateUploadFees({ priceList, isNewDataSet: true })

    assert.equal(existing.createDataSetFee, 0n)
    assert.equal(fresh.createDataSetFee, priceList.fees.createDataSetFee)
  })

  it('derives addPieces operation count from the batch limit when not provided', () => {
    // One full batch is a single addPieces operation.
    const oneBatch = calculateUploadFees({ priceList, isNewDataSet: false, pieceCount: maxBatch })
    assert.equal(
      oneBatch.addPiecesFee,
      priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee * maxBatch
    )

    // One piece over the limit spills into a second operation.
    const spill = calculateUploadFees({ priceList, isNewDataSet: false, pieceCount: maxBatch + 1n })
    assert.equal(
      spill.addPiecesFee,
      priceList.fees.addPiecesBaseFee * 2n + priceList.fees.addPiecesPerPieceFee * (maxBatch + 1n)
    )
  })

  it('uses an explicit addPiecesOperationCount over the derived value', () => {
    const result = calculateUploadFees({
      priceList,
      isNewDataSet: false,
      pieceCount: maxBatch + 1n,
      addPiecesOperationCount: 1n,
    })
    assert.equal(
      result.addPiecesFee,
      priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee * (maxBatch + 1n)
    )
  })
})
