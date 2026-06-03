/* globals describe it */

import assert from 'assert'
import { calculateEffectiveRate } from '../src/warm-storage/calculate-effective-rate.ts'

const TiB = 1n << 40n
const storagePerTibPerMonth = 2_500_000_000_000_000_000n // 2.5 USDFC
const provingServicePerMonth = 24_000_000_000_000_000n // 0.024 USDFC
const epochsPerMonth = 86400n

describe('calculateEffectiveRate', () => {
  it('empty dataset has no recurring rate', () => {
    const result = calculateEffectiveRate({
      sizeInBytes: 0n,
      storagePerTibPerMonth,
      provingServicePerMonth,
      epochsPerMonth,
    })

    assert.equal(result.ratePerEpoch, 0n)
    assert.equal(result.ratePerMonth, 0n)
  })

  it('tiny non-empty dataset pays storage plus the proving service rate', () => {
    const result = calculateEffectiveRate({
      sizeInBytes: 1n,
      storagePerTibPerMonth,
      provingServicePerMonth,
      epochsPerMonth,
    })

    // Additive: even a 1-byte dataset pays a (tiny) storage rate on top of proving.
    const storagePerEpoch = (storagePerTibPerMonth * 1n) / (TiB * epochsPerMonth)
    const storagePerMonth = (storagePerTibPerMonth * 1n) / TiB
    assert.equal(result.ratePerEpoch, storagePerEpoch + provingServicePerMonth / epochsPerMonth)
    assert.equal(result.ratePerMonth, storagePerMonth + provingServicePerMonth)
  })

  it('large dataset pays storage plus proving service rate', () => {
    const result = calculateEffectiveRate({
      sizeInBytes: TiB,
      storagePerTibPerMonth,
      provingServicePerMonth,
      epochsPerMonth,
    })

    const expectedPerMonth = storagePerTibPerMonth + provingServicePerMonth
    const expectedPerEpoch = storagePerTibPerMonth / epochsPerMonth + provingServicePerMonth / epochsPerMonth

    assert.equal(result.ratePerMonth, expectedPerMonth)
    assert.equal(result.ratePerEpoch, expectedPerEpoch)
  })

  it('precision: perMonth !== perEpoch * epochsPerMonth due to truncation', () => {
    // Use a size that causes a non-round division
    const sizeInBytes = TiB / 3n

    const result = calculateEffectiveRate({
      sizeInBytes,
      storagePerTibPerMonth,
      provingServicePerMonth,
      epochsPerMonth,
    })

    // naturalPerMonth = (2.5e18 * (TiB/3)) / TiB = 2.5e18 / 3 = 833_333_333_333_333_333
    // naturalPerEpoch = (2.5e18 * (TiB/3)) / (TiB * 86400)
    // These won't be exactly equal after integer truncation
    assert.notEqual(result.ratePerMonth, result.ratePerEpoch * epochsPerMonth)
  })
})
