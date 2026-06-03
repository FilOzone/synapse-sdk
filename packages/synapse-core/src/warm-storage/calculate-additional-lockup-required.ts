import { TIME_CONSTANTS } from '../utils/constants.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateAdditionalLockupRequired {
  export type ParamsType = {
    /** Size of new data being uploaded, in bytes. */
    dataSize: bigint
    /** Current total data size in the existing dataset, in bytes. 0n for new datasets. */
    currentDataSetSize: bigint
    /** Canonical warm storage price list. */
    priceList: getPriceList.OutputType
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to priceList.lockups.defaultLockupPeriod. */
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
    streamingLockup: bigint
    /** Lifecycle lockup target for new datasets. */
    lifecycleLockup: bigint
    /** CDN lockup for new CDN datasets. */
    cdnLockup: bigint
    /** Cache-miss lockup for new CDN datasets. */
    cacheMissLockup: bigint
    /** streamingLockup + lifecycleLockup + cdnLockup + cacheMissLockup */
    total: bigint
  }
}

/**
 * Compute how much additional lockup this upload requires.
 *
 * Existing datasets pay only the incremental rate lockup. New datasets also
 * include lifecycle and optional CDN/cache-miss lockups.
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
    priceList,
    epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH,
    lockupEpochs,
    isNewDataSet,
    withCDN,
  } = params

  // The price list defines the default PDP rail lockup period.
  const effectiveLockupEpochs = lockupEpochs ?? priceList.lockups.defaultLockupPeriod

  const rateParams = {
    storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
    provingServicePerMonth: priceList.rates.datasetFeePerMonth,
    epochsPerMonth,
  }

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
    // Defensive only: additive storage rate is monotonic in size, so a positive
    // size delta never yields a negative rate delta in the current model.
    if (rateDeltaPerEpoch < 0n) rateDeltaPerEpoch = 0n
  } else {
    // New dataset or unknown current size: full rate for new data
    const newRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: dataSize,
    })
    rateDeltaPerEpoch = newRate.ratePerEpoch
  }

  const streamingLockup = rateDeltaPerEpoch * effectiveLockupEpochs
  // The lifecycle reserve is seeded once per new dataset (one PDP rail each), so
  // it is added per new dataset and summed across contexts by callers. CDN and
  // cache-miss lockups are flat fixed amounts on the CDN rail; the lockup periods
  // in the price list are rail settle windows, not rate multipliers.
  const lifecycleLockup = isNewDataSet ? priceList.lockups.lifecycleReserveTarget : 0n
  const cdnLockup = isNewDataSet && withCDN ? priceList.lockups.cdnLockupAmount : 0n
  const cacheMissLockup = isNewDataSet && withCDN ? priceList.lockups.cacheMissLockupAmount : 0n

  return {
    rateDeltaPerEpoch,
    streamingLockup,
    lifecycleLockup,
    cdnLockup,
    cacheMissLockup,
    total: streamingLockup + lifecycleLockup + cdnLockup + cacheMissLockup,
  }
}
