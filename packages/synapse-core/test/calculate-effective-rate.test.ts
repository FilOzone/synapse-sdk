/* globals describe it */

import assert from 'assert'
import { calculateEffectiveRate } from '../src/warm-storage/calculate-effective-rate.ts'

const TiB = 1n << 40n
const pricePerTiBPerMonth = 2_500_000_000_000_000_000n // 2.5 USDFC
const minimumPricePerMonth = 60_000_000_000_000_000n // 0.06 USDFC
const epochsPerMonth = 86400n

describe('calculateEffectiveRate', () => {
  it('floor pricing: tiny file uses the minimum rate', () => {
    const result = calculateEffectiveRate({
      sizeInBytes: 1n,
      pricePerTiBPerMonth,
      minimumPricePerMonth,
      epochsPerMonth,
    })

    // naturalPerEpoch = (2.5e18 * 1) / (TiB * 86400) = 0 (truncated to 0)
    // minimumPerEpoch = 60_000_000_000_000_000 / 86400 = 694_444_444_444
    const minimumPerEpoch = minimumPricePerMonth / epochsPerMonth
    assert.equal(result.ratePerEpoch, minimumPerEpoch)
    assert.equal(result.ratePerMonth, minimumPricePerMonth)
  })

  it('above floor: large file natural rate exceeds minimum', () => {
    const result = calculateEffectiveRate({
      sizeInBytes: TiB,
      pricePerTiBPerMonth,
      minimumPricePerMonth,
      epochsPerMonth,
    })

    // naturalPerMonth = (2.5e18 * TiB) / TiB = 2.5e18
    // naturalPerEpoch = (2.5e18 * TiB) / (TiB * 86400) = 2.5e18 / 86400
    const expectedPerMonth = pricePerTiBPerMonth
    const expectedPerEpoch = pricePerTiBPerMonth / epochsPerMonth

    assert.equal(result.ratePerMonth, expectedPerMonth)
    assert.equal(result.ratePerEpoch, expectedPerEpoch)
    assert.ok(result.ratePerEpoch > minimumPricePerMonth / epochsPerMonth)
  })

  it('precision: perMonth !== perEpoch * epochsPerMonth due to truncation', () => {
    // Use a size that causes a non-round division
    const sizeInBytes = TiB / 3n

    const result = calculateEffectiveRate({
      sizeInBytes,
      pricePerTiBPerMonth,
      minimumPricePerMonth,
      epochsPerMonth,
    })

    // naturalPerMonth = (2.5e18 * (TiB/3)) / TiB = 2.5e18 / 3 = 833_333_333_333_333_333
    // naturalPerEpoch = (2.5e18 * (TiB/3)) / (TiB * 86400)
    // These won't be exactly equal after integer truncation
    assert.notEqual(result.ratePerMonth, result.ratePerEpoch * epochsPerMonth)
  })
})
