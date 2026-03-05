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
    /**
     * Rate per epoch — matches the on-chain PDP rail rate.
     *
     * The contract computes this as a single division:
     *   `(totalBytes * pricePerTiBPerMonth) / (TiB * EPOCHS_PER_MONTH)`
     *
     * Because truncation depends on totalBytes, this value is only valid for
     * the exact size it was computed for — you cannot scale it linearly to
     * estimate costs for different sizes.
     *
     * Use for: lockup calculations, on-chain comparisons.
     */
    ratePerEpoch: bigint
    /**
     * Rate per month — preserves precision before epoch division.
     *
     * Computed as `(totalBytes * pricePerTiBPerMonth) / TiB` (one fewer
     * division than ratePerEpoch), so it retains more precision and scales
     * linearly with size, making it suitable for display and cost estimation.
     *
     * Note: this is slightly higher than `ratePerEpoch * epochsPerMonth`
     * (the actual on-chain monthly cost) due to integer truncation in the
     * per-epoch calculation.
     *
     * Use for: display, cost comparisons across sizes.
     */
    ratePerMonth: bigint
  }
}

/**
 * Mirror the contract's `_calculateStorageRate` with floor pricing.
 *
 * Returns two rates for different use cases:
 * - `ratePerEpoch` — matches the on-chain rail rate (use for lockup math)
 * - `ratePerMonth` — higher precision, linearly scalable (use for display)
 *
 * The contract multiplies `totalBytes * pricePerTiBPerMonth` before dividing
 * by `TiB * EPOCHS_PER_MONTH` in a single step, so `ratePerEpoch` depends on
 * the total size and cannot be scaled to estimate other sizes. `ratePerMonth`
 * avoids the epoch division, preserving that scalability.
 *
 * On-chain reference:
 * - `_calculateStorageRate`: {@link https://github.com/FilOzone/filecoin-services/blob/053885eba807ed40a0e834c080606f4286ab4ef2/service_contracts/src/FilecoinWarmStorageService.sol#L1388-L1397}
 * - `calculateStorageSizeBasedRatePerEpoch`: {@link https://github.com/FilOzone/filecoin-services/blob/053885eba807ed40a0e834c080606f4286ab4ef2/service_contracts/src/FilecoinWarmStorageService.sol#L1349-L1370}
 *
 * @param params - {@link calculateEffectiveRate.ParamsType}
 * @returns {@link calculateEffectiveRate.OutputType}
 */
export function calculateEffectiveRate(params: calculateEffectiveRate.ParamsType): calculateEffectiveRate.OutputType {
  const { sizeInBytes, pricePerTiBPerMonth, minimumPricePerMonth, epochsPerMonth } = params

  // One division (by TiB only) — preserves precision, linearly scalable with size
  const naturalPerMonth = (pricePerTiBPerMonth * sizeInBytes) / SIZE_CONSTANTS.TiB

  // Two-factor division (by TiB * epochs) — matches contract's single-step division,
  // truncation is size-dependent so this value is only valid for this exact sizeInBytes
  const naturalPerEpoch = (pricePerTiBPerMonth * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

  // Floor rate per epoch
  const minimumPerEpoch = minimumPricePerMonth / epochsPerMonth

  // Apply floor pricing
  const ratePerMonth = naturalPerMonth > minimumPricePerMonth ? naturalPerMonth : minimumPricePerMonth
  const ratePerEpoch = naturalPerEpoch > minimumPerEpoch ? naturalPerEpoch : minimumPerEpoch

  return { ratePerEpoch, ratePerMonth }
}
