import { ValidationError } from '../errors/base.ts'
import { TIME_CONSTANTS } from '../utils/constants.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'
import type { getPriceList } from './price-list.ts'

export namespace estimateStorageCost {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    /** Total raw payload size of one copy, in bytes. */
    sizeInBytes: bigint
    /** How long the data is kept, in epochs. Use `TIME_CONSTANTS.EPOCHS_PER_MONTH` to convert from months. */
    durationInEpochs: bigint
    /** Number of copies, each stored in its own data set. Defaults to 1n. */
    copies?: bigint
  }

  export type OutputType = {
    /** Recurring rate across all copies, as charged on-chain. */
    ratePerEpoch: bigint
    /** Recurring monthly rate across all copies, for display. */
    ratePerMonth: bigint
    /** Total paid across all copies for the whole duration (ratePerEpoch x durationInEpochs). */
    total: bigint
  }
}

/**
 * Estimate what it costs to keep data on FWSS for a period of time, without a wallet or account state.
 *
 * Each copy is a separate data set paying the size-based storage rate plus the
 * per-data-set fee. One-time upload fees and the up-front deposit are covered
 * by {@link estimateOnboardingCost}.
 *
 * The storage rate is priced from `sizeInBytes` directly. On-chain pricing uses
 * PDP leaf counts, which add at most 31 bytes per piece; see
 * {@link calculateEffectiveRate} for the exact per-data-set calculation.
 *
 * @param params - {@link estimateStorageCost.ParamsType}
 * @returns {@link estimateStorageCost.OutputType}
 * @throws {@link ValidationError} when size, duration or copies are not positive
 */
export function estimateStorageCost(params: estimateStorageCost.ParamsType): estimateStorageCost.OutputType {
  const { priceList, sizeInBytes, durationInEpochs } = params
  const copies = params.copies ?? 1n
  if (sizeInBytes <= 0n || durationInEpochs <= 0n || copies <= 0n) {
    throw new ValidationError('sizeInBytes, durationInEpochs and copies must be positive')
  }

  const rate = calculateEffectiveRate({
    sizeInBytes,
    storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
    datasetFeePerMonth: priceList.rates.datasetFeePerMonth,
    epochsPerMonth: TIME_CONSTANTS.EPOCHS_PER_MONTH,
  })
  const ratePerEpoch = rate.ratePerEpoch * copies

  return {
    ratePerEpoch,
    ratePerMonth: rate.ratePerMonth * copies,
    total: ratePerEpoch * durationInEpochs,
  }
}
