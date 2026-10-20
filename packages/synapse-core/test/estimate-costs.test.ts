/* globals describe it */

import assert from 'assert'
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
  })

  it('defaults to one add-pieces call per piece, like calculateUploadFees', () => {
    const result = estimateOnboardingCost({ priceList, sizeInBytes: 10n * TiB, pieceCount: 10240n })
    assert.equal(result.addPiecesCalls, 10240n)
    assert.equal(result.fees.addPieces, (8n + 3n) * 10240n * (USDFC / 1000n))
  })

  it('10 TiB in 1 GiB pieces, 100 per call, 1 copy', () => {
    const result = estimateOnboardingCost({
      priceList,
      sizeInBytes: 10n * TiB,
      pieceCount: (10n * TiB) / GiB,
      piecesPerAddPiecesCall: 100n,
    })
    assert.equal(result.addPiecesCalls, 103n)
    assert.equal(result.fees.createDataSet, (25n * USDFC) / 1000n)
    assert.equal(result.fees.addPieces, ((8n * 103n + 3n * 10240n) * USDFC) / 1000n) // 31.544
    assert.equal(result.deposit.lifecycleReserve, USDFC / 2n)
    assertUsdfc(result.deposit.streamingLockup, (2512n * USDFC) / 100n) // 30 days of 25.12/month
  })

  it('scales fees and deposit by copies', () => {
    const one = estimateOnboardingCost({ priceList, sizeInBytes: TiB, pieceCount: 4n })
    const two = estimateOnboardingCost({ priceList, sizeInBytes: TiB, pieceCount: 4n, copies: 2n })
    assert.equal(two.fees.total, one.fees.total * 2n)
    assert.equal(two.deposit.total, one.deposit.total * 2n)
  })

  it('handles a billion pieces without a list of sizes', () => {
    const result = estimateOnboardingCost({ priceList, sizeInBytes: 10n * TiB, pieceCount: 1n << 30n })
    assert.ok(result.fees.addPieces > 3_000_000n * USDFC)
  })
})

describe('estimateStorageCost', () => {
  it('rejects non-positive inputs', () => {
    assert.throws(() => estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: 0n }), /must be positive/)
  })

  it('10 TiB for 12 months is 301.44 USDFC per copy', () => {
    const result = estimateStorageCost({ priceList, sizeInBytes: 10n * TiB, durationInEpochs: 12n * EPOCHS_PER_MONTH })
    assert.equal(result.ratePerMonth, (2512n * USDFC) / 100n)
    assertUsdfc(result.total, (30144n * USDFC) / 100n)
  })

  it('scales by copies', () => {
    const one = estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: EPOCHS_PER_MONTH })
    const two = estimateStorageCost({ priceList, sizeInBytes: TiB, durationInEpochs: EPOCHS_PER_MONTH, copies: 2n })
    assert.equal(two.total, one.total * 2n)
    assert.equal(two.ratePerMonth, one.ratePerMonth * 2n)
  })
})
