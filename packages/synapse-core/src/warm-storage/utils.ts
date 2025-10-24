import { SIZE_CONSTANTS, TIME_CONSTANTS } from '../constants.ts'
import type { ServicePriceResult } from './service-price.ts'

export type StorageCosts = {
  perEpoch: bigint
  perDay: bigint
  perMonth: bigint
}

/**
 * Calculate the costs for a storage operation
 */
export function calculateStorageCosts(sizeInBytes: bigint, prices: ServicePriceResult): StorageCosts {
  const { pricePerTiBPerMonthNoCDN, epochsPerMonth } = prices
  // Calculate price per byte per epoch
  const pricePerEpochNoCDN = (pricePerTiBPerMonthNoCDN * sizeInBytes) / (SIZE_CONSTANTS.TiB * epochsPerMonth)

  return {
      perEpoch: pricePerEpochNoCDN,
      perDay: pricePerEpochNoCDN * TIME_CONSTANTS.EPOCHS_PER_DAY,
      perMonth: pricePerEpochNoCDN * epochsPerMonth,
  }
}
