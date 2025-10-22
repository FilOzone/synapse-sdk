import { SIZE_CONSTANTS, TIME_CONSTANTS } from '../constants.ts'
import type { ServicePriceResult } from './service-price.ts'

export type StorageCosts = {
  perEpoch: bigint
  perDay: bigint
  perMonth: bigint
}

export interface CalculateStorageCostsResult {
  withCDN: StorageCosts
  withoutCDN: StorageCosts
}

/**
 * Calculate the costs for a storage operation
 */
export function calculateStorageCosts(sizeInBytes: bigint, prices: ServicePriceResult): CalculateStorageCostsResult {
  const { pricePerTiBPerMonthNoCDN, pricePerTiBPerMonthWithCDN, epochsPerMonth } = prices
  // Calculate price per byte per epoch
  const pricePerEpochNoCDN = (pricePerTiBPerMonthNoCDN * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)
  const pricePerEpochWithCDN = (pricePerTiBPerMonthWithCDN * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

  return {
    withCDN: {
      perEpoch: pricePerEpochWithCDN,
      perDay: pricePerEpochWithCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
      perMonth: pricePerEpochWithCDN * epochsPerMonth,
    },
    withoutCDN: {
      perEpoch: pricePerEpochNoCDN,
      perDay: pricePerEpochNoCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
      perMonth: pricePerEpochNoCDN * epochsPerMonth,
    },
  }
}
