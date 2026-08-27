/* globals describe it */

import assert from 'assert'
import { leafCountToRawSize, rawSizeToLeafCount } from '../src/utils/pdp-size.ts'
import { calculateAdditionalLockupRequired } from '../src/warm-storage/calculate-additional-lockup-required.ts'
import { calculateEffectiveRate } from '../src/warm-storage/calculate-effective-rate.ts'
import type { getPriceList } from '../src/warm-storage/price-list.ts'

const priceList = {
  token: '0x0000000000000000000000000000000000000001',
  rates: {
    storagePerTibPerMonth: 2_500_000_000_000_000_000n,
    datasetFeePerMonth: 120_000_000_000_000_000n,
    cdnEgressPerTib: 0n,
    cacheMissEgressPerTib: 0n,
  },
  fees: {
    createDataSetFee: 25_000_000_000_000_000n,
    addPiecesBaseFee: 8_000_000_000_000_000n,
    addPiecesPerPieceFee: 3_000_000_000_000_000n,
    schedulePieceRemovalsFee: 7_000_000_000_000_000n,
    terminateFee: 6_000_000_000_000_000n,
  },
  lockups: {
    lifecycleReserveTarget: 500_000_000_000_000_000n,
    replenishThreshold: 25_000_000_000_000_000n,
    defaultLockupPeriod: 86_400n,
    cdnLockupAmount: 700_000_000_000_000_000n,
    cacheMissLockupAmount: 300_000_000_000_000_000n,
    cdnLockupPeriod: 14_400n,
  },
} satisfies getPriceList.OutputType

const lockupEpochs = 86400n // 30 days

describe('calculateAdditionalLockupRequired', () => {
  it('new dataset without CDN: includes lifecycle lockup only', () => {
    const result = calculateAdditionalLockupRequired({
      pieceSizes: [1000n],
      dataSetLeafCount: 0n,
      priceList,
      lockupEpochs,
      isNewDataSet: true,
      withCDN: false,
    })

    // Additive model: rate delta for a new dataset is the storage rate for the
    // added bytes plus the proving service rate.
    const expectedRatePerEpoch = calculateEffectiveRate({
      sizeInBytes: leafCountToRawSize(rawSizeToLeafCount(1000n)),
      storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
      datasetFeePerMonth: priceList.rates.datasetFeePerMonth,
      epochsPerMonth: 86400n,
    }).ratePerEpoch
    assert.equal(result.lifecycleLockup, priceList.lockups.lifecycleReserveTarget)
    assert.equal(result.cdnLockup, 0n)
    assert.equal(result.cacheMissLockup, 0n)
    assert.equal(result.rateDeltaPerEpoch, expectedRatePerEpoch)
    assert.equal(result.streamingLockup, expectedRatePerEpoch * lockupEpochs)
    assert.equal(result.total, result.streamingLockup + result.lifecycleLockup)
  })

  it('new dataset with CDN: includes CDN and cache-miss lockups', () => {
    const result = calculateAdditionalLockupRequired({
      pieceSizes: [1000n],
      dataSetLeafCount: 0n,
      priceList,
      lockupEpochs,
      isNewDataSet: true,
      withCDN: true,
    })

    assert.equal(result.lifecycleLockup, priceList.lockups.lifecycleReserveTarget)
    assert.equal(result.cdnLockup, priceList.lockups.cdnLockupAmount)
    assert.equal(result.cacheMissLockup, priceList.lockups.cacheMissLockupAmount)
    assert.equal(
      result.total,
      result.streamingLockup + result.lifecycleLockup + result.cdnLockup + result.cacheMissLockup
    )
  })

  it('locks the recurring-rate increase for an existing data set', () => {
    const result = calculateAdditionalLockupRequired({
      pieceSizes: [100n],
      dataSetLeafCount: rawSizeToLeafCount(100n),
      priceList,
      lockupEpochs,
      isNewDataSet: false,
      withCDN: false,
    })

    // Proving rate cancels between current and new size; only the storage rate
    // delta for the added bytes is locked up.
    const rateParams = {
      storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
      datasetFeePerMonth: priceList.rates.datasetFeePerMonth,
      epochsPerMonth: 86400n,
    }
    const expectedDelta =
      calculateEffectiveRate({ ...rateParams, sizeInBytes: 254n }).ratePerEpoch -
      calculateEffectiveRate({ ...rateParams, sizeInBytes: 127n }).ratePerEpoch
    assert.ok(expectedDelta > 0n)
    assert.equal(result.rateDeltaPerEpoch, expectedDelta)
    assert.equal(result.streamingLockup, expectedDelta * lockupEpochs)
    assert.equal(result.lifecycleLockup, 0n)
    assert.equal(result.cdnLockup, 0n)
    assert.equal(result.cacheMissLockup, 0n)
    assert.equal(result.total, result.streamingLockup)
  })

  it('existing dataset with added storage has a positive rate delta', () => {
    const TiB = 1n << 40n
    // Non-zero existing dataset size so the existing-dataset delta path runs.
    const result = calculateAdditionalLockupRequired({
      pieceSizes: [TiB],
      dataSetLeafCount: 1n,
      priceList,
      lockupEpochs,
      isNewDataSet: false,
      withCDN: false,
    })

    assert.ok(result.rateDeltaPerEpoch > 0n)
    assert.equal(result.streamingLockup, result.rateDeltaPerEpoch * lockupEpochs)
    assert.equal(result.lifecycleLockup, 0n)
    assert.equal(result.cdnLockup, 0n)
    assert.equal(result.cacheMissLockup, 0n)
    assert.equal(result.total, result.streamingLockup)
  })

  it('sources the lockup period from priceList.lockups.defaultLockupPeriod when lockupEpochs is omitted', () => {
    const customPeriod = 1234n
    const customPriceList = {
      ...priceList,
      lockups: { ...priceList.lockups, defaultLockupPeriod: customPeriod },
    }

    const result = calculateAdditionalLockupRequired({
      pieceSizes: [1000n],
      dataSetLeafCount: 0n,
      priceList: customPriceList,
      isNewDataSet: true,
      withCDN: false,
    })

    assert.equal(result.streamingLockup, result.rateDeltaPerEpoch * customPeriod)
  })
})
