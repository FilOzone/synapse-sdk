/* globals describe it */

import assert from 'assert'
import { calculateLifecycleReserveFunding } from '../src/warm-storage/calculate-lifecycle-reserve-funding.ts'
import { estimateOnboardingCost } from '../src/warm-storage/estimate-onboarding-cost.ts'
import { estimateStorageCost } from '../src/warm-storage/estimate-storage-cost.ts'

const USDFC = 10n ** 18n
const TiB = 1n << 40n
const GiB = 1n << 30n
const EPOCHS_PER_MONTH = 86400n

// Mainnet FWSS v1.4.0 price list
const priceList = {
  token: '0x00000000000000000000000000000000000000aa' as const,
  rates: {
    storagePerTibPerMonth: (25n * USDFC) / 10n, // 2.5
    datasetFeePerMonth: (12n * USDFC) / 100n, // 0.12
    cdnEgressPerTib: 7n * USDFC,
    cacheMissEgressPerTib: 7n * USDFC,
  },
  fees: {
    createDataSetFee: (25n * USDFC) / 1000n, // 0.025
    addPiecesBaseFee: (8n * USDFC) / 1000n, // 0.008
    addPiecesPerPieceFee: (3n * USDFC) / 1000n, // 0.003
    schedulePieceRemovalsFee: (7n * USDFC) / 1000n,
    terminateFee: (6n * USDFC) / 1000n,
  },
  lockups: {
    lifecycleReserveTarget: USDFC / 2n, // 0.5
    replenishThreshold: (25n * USDFC) / 1000n,
    defaultLockupPeriod: EPOCHS_PER_MONTH,
    cdnLockupAmount: (7n * USDFC) / 10n,
    cacheMissLockupAmount: (3n * USDFC) / 10n,
    cdnLockupPeriod: 14400n,
  },
}

// Within 1e-9 USDFC of the expected value (per-epoch rates truncate).
function assertUsdfc(actual: bigint, expected: bigint) {
  const diff = actual > expected ? actual - expected : expected - actual
  assert.ok(diff < 10n ** 9n, `${actual} != ${expected}`)
}

describe('estimateOnboardingCost', () => {
  it('rejects non-positive inputs', () => {
    assert.throws(() => estimateOnboardingCost({ priceList, sizeInBytes: 0n, pieceCount: 1n }), /must be positive/)
    assert.throws(() => estimateOnboardingCost({ priceList, sizeInBytes: 1n, pieceCount: 0n }), /must be positive/)
    assert.throws(
      () => estimateOnboardingCost({ priceList, sizeInBytes: 1n, pieceCount: 1n, piecesPerAddPiecesCall: 0n }),
      /must be positive/
    )
    assert.throws(
      () => estimateOnboardingCost({ priceList, sizeInBytes: 1n, pieceCount: 1n, copies: 0n }),
      /must be positive/
    )
  })

  it('defaults to one add-pieces call per piece, like calculateUploadFees', () => {
    const result = estimateOnboardingCost({ priceList, sizeInBytes: 10n * TiB, pieceCount: 10240n })
    assert.equal(result.addPiecesCalls, 10240n)
    assert.equal(result.fees.addPieces, 112_640_000_000_000_000_000n) // 112.64
  })

  it('10 TiB in 1 GiB pieces at 100 per call charges 31.544 in add-pieces fees and reserves 31.941 for them', () => {
    const result = estimateOnboardingCost({
      priceList,
      sizeInBytes: 10n * TiB,
      pieceCount: (10n * TiB) / GiB,
      piecesPerAddPiecesCall: 100n,
    })
    assert.equal(result.addPiecesCalls, 103n)
    assert.equal(result.fees.createDataSet, (25n * USDFC) / 1000n)
    assert.equal(result.fees.addPieces, 31_544_000_000_000_000_000n) // 31.544
    // 0.5 initial plus 31.441 of replenishment: the fees are paid out of the reserve.
    assert.equal(result.deposit.lifecycleReserve, 31_941_000_000_000_000_000n)
    assertUsdfc(result.deposit.streamingLockup, (2512n * USDFC) / 100n) // 30 days of 25.12/month
  })

  it('charges fees and deposit once per copy', () => {
    const result = estimateOnboardingCost({ priceList, sizeInBytes: TiB, pieceCount: 4n, copies: 2n })
    assert.equal(result.fees.total, 138_000_000_000_000_000n) // 2 x (0.025 + 4 x 0.011)
    assertUsdfc(result.deposit.total, 6_240_000_000_000_000_000n) // 2 x (2.62 + 0.5)
  })

  it('sizes the streaming lockup by defaultLockupPeriod, not by month', () => {
    const result = estimateOnboardingCost({
      priceList: { ...priceList, lockups: { ...priceList.lockups, defaultLockupPeriod: 2n * EPOCHS_PER_MONTH } },
      sizeInBytes: 10n * TiB,
      pieceCount: 1n,
    })
    assertUsdfc(result.deposit.streamingLockup, 50_240_000_000_000_000_000n) // 60 days of 25.12/month
  })

  it('includes the reserve replenishments the upload will trigger, matching the per-piece calculation', () => {
    // 41 one-piece additions drain the 0.5 reserve past its threshold three times (Hugo, #1031 review).
    const result = estimateOnboardingCost({ priceList, sizeInBytes: 41n * GiB, pieceCount: 41n })
    const perPiece = calculateLifecycleReserveFunding({
      priceList,
      isNewDataSet: true,
      pieceSizes: Array(41).fill(GiB),
    })
    assert.equal(result.deposit.lifecycleReserve, perPiece.total)
    assert.equal(result.deposit.lifecycleReserve, 976_000_000_000_000_000n) // 0.976
  })

  it('replenishes per add-pieces call when pieces are batched', () => {
    const result = estimateOnboardingCost({
      priceList,
      sizeInBytes: 41n * GiB,
      pieceCount: 41n,
      piecesPerAddPiecesCall: 41n,
    })
    // One flush of 0.025 + 0.008 + 41 x 0.003 = 0.156 fits inside the 0.5 reserve: no replenishment.
    assert.equal(result.deposit.lifecycleReserve, USDFC / 2n)
  })

  it('prices a billion pieces without a list of sizes', () => {
    const result = estimateOnboardingCost({ priceList, sizeInBytes: 10n * TiB, pieceCount: 1n << 30n })
    assert.equal(result.fees.addPieces, 11_811_160_064_000_000_000_000_000n) // 2^30 x 0.011
  })
})

describe('estimateStorageCost', () => {
  it('rejects non-positive inputs', () => {
    assert.throws(() => estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: 0n }), /must be positive/)
    assert.throws(() => estimateStorageCost({ priceList, sizeInBytes: 0n, durationInEpochs: 1n }), /must be positive/)
    assert.throws(
      () => estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: 1n, copies: 0n }),
      /must be positive/
    )
  })

  it('10 TiB for 12 months is 301.44 USDFC per copy', () => {
    const result = estimateStorageCost({ priceList, sizeInBytes: 10n * TiB, durationInEpochs: 12n * EPOCHS_PER_MONTH })
    assert.equal(result.ratePerMonth, (2512n * USDFC) / 100n)
    assertUsdfc(result.total, (30144n * USDFC) / 100n)
  })

  it('charges each copy as its own data set', () => {
    const result = estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: EPOCHS_PER_MONTH, copies: 2n })
    assert.equal(result.ratePerMonth, 5_240_000_000_000_000_000n) // 2 x (2.5 + 0.12)
    assertUsdfc(result.total, 5_240_000_000_000_000_000n)
  })
})
