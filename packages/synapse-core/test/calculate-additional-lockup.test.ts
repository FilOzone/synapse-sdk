/* globals describe it */

import assert from 'assert'
import { calculateAdditionalLockup } from '../src/warm-storage/calculate-additional-lockup.ts'

const pricing = {
  pricePerTiBPerMonth: 2_500_000_000_000_000_000n, // 2.5 USDFC
  minimumPricePerMonth: 60_000_000_000_000_000n, // 0.06 USDFC
  epochsPerMonth: 86400n,
}

const lockupEpochs = 86400n // 30 days

describe('calculateAdditionalLockup', () => {
  it('new dataset without CDN: no CDN fixed lockup', () => {
    const result = calculateAdditionalLockup({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs,
      isNewDataset: true,
      withCDN: false,
    })

    assert.equal(result.cdnFixedLockup, 0n)
    // For a small file, should use floor rate
    const minimumPerEpoch = pricing.minimumPricePerMonth / pricing.epochsPerMonth
    assert.equal(result.rateDeltaPerEpoch, minimumPerEpoch)
    assert.equal(result.rateLockupDelta, minimumPerEpoch * lockupEpochs)
    assert.equal(result.total, result.rateLockupDelta)
  })

  it('new dataset with CDN: includes CDN fixed lockup of 1 USDFC', () => {
    const result = calculateAdditionalLockup({
      dataSize: 1000n,
      currentDataSetSize: 0n,
      ...pricing,
      lockupEpochs,
      isNewDataset: true,
      withCDN: true,
    })

    const cdnFixedLockup = 1_000_000_000_000_000_000n // 1 USDFC
    assert.equal(result.cdnFixedLockup, cdnFixedLockup)
    assert.equal(result.total, result.rateLockupDelta + cdnFixedLockup)
  })

  it('existing dataset floor-to-floor: rate delta = 0 when both sizes are below floor', () => {
    // Both 100 bytes and 200 bytes are well below floor threshold
    const result = calculateAdditionalLockup({
      dataSize: 100n,
      currentDataSetSize: 100n,
      ...pricing,
      lockupEpochs,
      isNewDataset: false,
      withCDN: false,
    })

    // Both sizes produce floor rate, so delta = 0
    assert.equal(result.rateDeltaPerEpoch, 0n)
    assert.equal(result.rateLockupDelta, 0n)
    assert.equal(result.cdnFixedLockup, 0n)
    assert.equal(result.total, 0n)
  })

  it('existing dataset crossing floor threshold: rate delta > 0', () => {
    const TiB = 1n << 40n
    // Start with 0 (treated as new since isNewDataset=false but currentDataSetSize=0
    // triggers the else branch... actually currentDataSetSize > 0n check fails so it
    // goes to the else branch). Use a large currentDataSetSize instead.
    const result = calculateAdditionalLockup({
      dataSize: TiB,
      currentDataSetSize: 1n, // tiny existing dataset at floor
      ...pricing,
      lockupEpochs,
      isNewDataset: false,
      withCDN: false,
    })

    // Adding 1 TiB to a 1-byte dataset: new rate will be well above floor
    // while current rate is at the floor, so delta should be positive
    assert.ok(result.rateDeltaPerEpoch > 0n)
    assert.equal(result.rateLockupDelta, result.rateDeltaPerEpoch * lockupEpochs)
    assert.equal(result.cdnFixedLockup, 0n)
    assert.equal(result.total, result.rateLockupDelta)
  })
})
