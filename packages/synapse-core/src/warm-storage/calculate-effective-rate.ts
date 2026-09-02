import { SIZE_CONSTANTS } from '../utils/constants.ts'

export namespace calculateEffectiveRate {
  export type ParamsType = {
    /** Aggregate byte size produced by PDP's `leafCountToRawSize`, after combining all data-set leaves. */
    sizeInBytes: bigint
    /** Storage price per TiB per month. */
    storagePerTibPerMonth: bigint
    /**
     * Per-dataset monthly fee (the contract's `datasetFeePerMonth`), charged as
     * a flat additive proving service fee on non-empty datasets.
     */
    datasetFeePerMonth: bigint
    /** Epochs per month. */
    epochsPerMonth: bigint
  }

  export type OutputType = {
    /**
     * Rate per epoch — matches the contract's additive per-epoch rate
     * (`calculateStorageSizeBasedRatePerEpoch`): the size-based storage rate plus
     * the per-epoch dataset fee, each truncated independently then summed:
     *   `(totalBytes * storagePerTibPerMonth) / (TiB * EPOCHS_PER_MONTH) + datasetFeePerMonth / EPOCHS_PER_MONTH`
     *
     * Because truncation depends on totalBytes, this value is only valid for
     * the exact size it was computed for; you cannot scale it linearly to
     * estimate costs for different sizes.
     *
     * Use for: lockup calculations, on-chain comparisons.
     */
    ratePerEpoch: bigint
    /**
     * Rate per month — preserves precision before epoch division.
     *
     * Computed as `(totalBytes * storagePerTibPerMonth) / TiB` (one fewer
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
 * Calculate the expected FWSS recurring rate for a contract-priced data-set size.
 *
 * Returns two rates for different use cases:
 * - `ratePerEpoch` — matches the on-chain rail rate (use for lockup math)
 * - `ratePerMonth` — higher precision, linearly scalable (use for display)
 *
 * Callers matching on-chain behavior must first combine all PDP leaf counts,
 * then convert that aggregate count with `leafCountToRawSize`. Empty data sets
 * have no recurring rate. Non-empty data sets pay the size-based storage rate
 * plus the per-data-set proving service fee.
 *
 * @param params - {@link calculateEffectiveRate.ParamsType}
 * @returns {@link calculateEffectiveRate.OutputType}
 */
export function calculateEffectiveRate(params: calculateEffectiveRate.ParamsType): calculateEffectiveRate.OutputType {
  const { sizeInBytes, storagePerTibPerMonth, datasetFeePerMonth, epochsPerMonth } = params

  if (sizeInBytes === 0n) {
    return { ratePerEpoch: 0n, ratePerMonth: 0n }
  }

  // One division (by TiB only) — preserves precision, linearly scalable with size
  const storagePerMonth = (storagePerTibPerMonth * sizeInBytes) / SIZE_CONSTANTS.TiB

  // Two-factor division (by TiB * epochs) — matches contract's single-step division,
  // truncation is size-dependent so this value is only valid for this exact sizeInBytes
  const storagePerEpoch = (storagePerTibPerMonth * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

  const ratePerMonth = storagePerMonth + datasetFeePerMonth
  const ratePerEpoch = storagePerEpoch + datasetFeePerMonth / epochsPerMonth

  return { ratePerEpoch, ratePerMonth }
}
