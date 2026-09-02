import { ValidationError } from '../errors/base.ts'
import { TIME_CONSTANTS } from '../utils/constants.ts'
import { leafCountToRawSize, pieceSizesToLeafCount } from '../utils/pdp-size.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateAdditionalLockupRequired {
  export type ParamsType = {
    /** Exact raw payload size of every piece added by this operation, in bytes. */
    pieceSizes: readonly bigint[]
    /** Aggregate leaf count reported by PDP Verifier. 0n for new data sets. */
    dataSetLeafCount: bigint
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
 * Compute how much additional lockup an upload of known piece sizes requires.
 *
 * Existing datasets pay only the incremental rate lockup. New datasets also
 * include lifecycle and optional CDN/cache-miss lockups. Storage rates are
 * calculated from aggregate PDP leaf counts, matching FWSS's rounding order.
 *
 * @param params - {@link calculateAdditionalLockupRequired.ParamsType}
 * @returns {@link calculateAdditionalLockupRequired.OutputType}
 * @throws {@link ValidationError} when the leaf count or piece sizes are invalid
 */
export function calculateAdditionalLockupRequired(
  params: calculateAdditionalLockupRequired.ParamsType
): calculateAdditionalLockupRequired.OutputType {
  const {
    pieceSizes,
    dataSetLeafCount,
    priceList,
    epochsPerMonth = TIME_CONSTANTS.EPOCHS_PER_MONTH,
    lockupEpochs,
    isNewDataSet,
    withCDN,
  } = params

  if (dataSetLeafCount < 0n) {
    throw new ValidationError('dataSetLeafCount cannot be negative')
  }

  const currentLeafCount = isNewDataSet ? 0n : dataSetLeafCount
  const addedLeafCount = pieceSizesToLeafCount(pieceSizes)
  const finalLeafCount = currentLeafCount + addedLeafCount

  // The price list defines the default PDP rail lockup period.
  const effectiveLockupEpochs = lockupEpochs ?? priceList.lockups.defaultLockupPeriod

  const rateParams = {
    storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
    datasetFeePerMonth: priceList.rates.datasetFeePerMonth,
    epochsPerMonth,
  }

  let rateDeltaPerEpoch: bigint

  if (currentLeafCount > 0n) {
    // Existing dataset: compute delta between new and current rates
    const newRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: leafCountToRawSize(finalLeafCount),
    })
    const currentRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: leafCountToRawSize(currentLeafCount),
    })
    rateDeltaPerEpoch = newRate.ratePerEpoch - currentRate.ratePerEpoch
    // Defensive only: additive storage rate is monotonic in size, so a positive
    // size delta never yields a negative rate delta in the current model.
    if (rateDeltaPerEpoch < 0n) rateDeltaPerEpoch = 0n
  } else {
    // New or empty dataset: full rate after adding the pieces.
    const newRate = calculateEffectiveRate({
      ...rateParams,
      sizeInBytes: leafCountToRawSize(finalLeafCount),
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
