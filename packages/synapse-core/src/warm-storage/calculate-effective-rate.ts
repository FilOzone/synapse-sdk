import { SIZE_CONSTANTS } from '../utils/constants.ts'

export namespace calculateEffectiveRate {
  export type ParamsType = {
    /** Total data size in the dataset (existing + new), in bytes. */
    sizeInBytes: bigint
    /** Price per TiB per month from getServicePrice(). */
    pricePerTiBPerMonth: bigint
    /** Minimum monthly charge from getServicePrice(). */
    minimumPricePerMonth: bigint
    /** Epochs per month from getServicePrice() (always 86400). */
    epochsPerMonth: bigint
  }

  export type OutputType = {
    /** Rate per epoch — matches what the contract stores on the PDP rail. */
    ratePerEpoch: bigint
    /** Rate per month — full precision, no epoch division. Use for display. */
    ratePerMonth: bigint
  }
}

/**
 * Mirror the contract's `_calculateStorageRate` with floor pricing.
 *
 * Computes both per-epoch and per-month rates with dual precision:
 * - `ratePerMonth` = max(naturalPerMonth, minimumPricePerMonth) — full precision
 * - `ratePerEpoch` = max(naturalPerEpoch, minimumPerEpoch) — matches on-chain rail rate
 *
 * Note: `ratePerMonth !== ratePerEpoch * epochsPerMonth` due to integer truncation.
 *
 * @param params - {@link calculateEffectiveRate.ParamsType}
 * @returns {@link calculateEffectiveRate.OutputType}
 */
export function calculateEffectiveRate(params: calculateEffectiveRate.ParamsType): calculateEffectiveRate.OutputType {
  const { sizeInBytes, pricePerTiBPerMonth, minimumPricePerMonth, epochsPerMonth } = params

  // Natural rate per month (full precision, no epoch division)
  const naturalPerMonth = (pricePerTiBPerMonth * sizeInBytes) / SIZE_CONSTANTS.TiB

  // Natural rate per epoch (matches on-chain integer division)
  const naturalPerEpoch = (pricePerTiBPerMonth * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

  // Floor rate per epoch
  const minimumPerEpoch = minimumPricePerMonth / epochsPerMonth

  // Apply floor pricing
  const ratePerMonth = naturalPerMonth > minimumPricePerMonth ? naturalPerMonth : minimumPricePerMonth
  const ratePerEpoch = naturalPerEpoch > minimumPerEpoch ? naturalPerEpoch : minimumPerEpoch

  return { ratePerEpoch, ratePerMonth }
}
