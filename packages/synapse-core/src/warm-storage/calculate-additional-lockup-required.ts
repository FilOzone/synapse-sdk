import { CDN_FIXED_LOCKUP, LOCKUP_PERIOD, TIME_CONSTANTS } from '../utils/constants.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'

export namespace calculateAdditionalLockupRequired {
  export type ParamsType = {
    /** Size of new data being uploaded, in bytes. */
    dataSize: bigint
    /** Current total data size in the existing dataset, in bytes. 0n for new datasets. */
    currentDataSetSize: bigint
    /** Price per TiB per month from getServicePrice(). */
    pricePerTiBPerMonth: bigint
    /** Minimum monthly charge from getServicePrice(). */
    minimumPricePerMonth: bigint
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to LOCKUP_PERIOD (30 days). */
    lockupEpochs?: bigint
    /** Whether a new dataset is being created (vs adding to existing). */
    isNewDataSet: boolean
    /** Whether CDN is enabled for this dataset. */
    withCDN: boolean
  }

  export type OutputType = {
    /** Per-epoch rate increase from this upload. */
    rateDeltaPerEpoch: bigint
    /** Lockup increase from the rate change = rateDeltaPerEpoch * lockupEpochs. */
    rateLockupDelta: bigint
    /** Fixed CDN lockup (only for new CDN datasets), 0 otherwise. */
    cdnFixedLockup: bigint
    /** rateLockupDelta + cdnFixedLockup */
    total: bigint
  }
}

/**
 * Compute how much additional lockup this upload requires.
 *
 * Handles floor-to-floor transitions correctly: when both the current dataset size
 * and the new total size are below the floor threshold, the rate delta is 0.
 *
 * @param params - {@link calculateAdditionalLockupRequired.ParamsType}
 * @returns {@link calculateAdditionalLockupRequired.OutputType}
 */
export function calculateAdditionalLockupRequired(
  params: calculateAdditionalLockupRequired.ParamsType
): calculateAdditionalLockupRequired.OutputType {
  const {
    dataSize,
    currentDataSetSize,
    pricePerTiBPerMonth,
    minimumPricePerMonth,
    epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH,
    lockupEpochs = LOCKUP_PERIOD,
    isNewDataSet,
    withCDN,
  } = params

  const rateParams = { pricePerTiBPerMonth, minimumPricePerMonth, epochsPerMonth }

  let rateDeltaPerEpoch: bigint

  if (currentDataSetSize > 0n && !isNewDataSet) {
    // Existing dataset: compute delta between new and current rates
    const newRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: currentDataSetSize + dataSize,
    })
    const currentRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: currentDataSetSize,
    })
    rateDeltaPerEpoch = newRate.ratePerEpoch - currentRate.ratePerEpoch
    // Floor-to-floor: if both sizes are below floor, delta is 0
    if (rateDeltaPerEpoch < 0n) rateDeltaPerEpoch = 0n
  } else {
    // New dataset or unknown current size: full rate for new data
    const newRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: dataSize,
    })
    rateDeltaPerEpoch = newRate.ratePerEpoch
  }

  const rateLockupDelta = rateDeltaPerEpoch * lockupEpochs

  // CDN fixed lockup only applies to new CDN datasets
  const cdnFixedLockup = isNewDataSet && withCDN ? CDN_FIXED_LOCKUP.total : 0n

  return {
    rateDeltaPerEpoch,
    rateLockupDelta,
    cdnFixedLockup,
    total: rateLockupDelta + cdnFixedLockup,
  }
}
