import { SIZE_CONSTANTS } from '../utils/constants.ts'
import type { ServicePriceResult } from './service-price.ts'

export interface CalculateStorageCostsResult {
  storagePerMonth: bigint
  cdnEgressPerTiB: bigint
  cacheMissEgressPerTiB: bigint
  minimumPerMonth: bigint
}

/**
 * Calculate the costs for a storage operation.
 *
 * Note: CDN pricing is egress-based, not time-based.
 * storagePerMonth is calculated for a 30-day month based on 2880 epochs per day.
 * Egress costs are per TiB of data transferred and are charged separately.
 */
export function calculateStorageCosts(sizeInBytes: bigint, prices: ServicePriceResult): CalculateStorageCostsResult {
  const { pricePerTiBPerMonthNoCDN, pricePerTiBCdnEgress, pricePerTiBCacheMissEgress, minimumPricePerMonth } = prices

  // Calculate base storage cost per month for the given size
  const storagePerMonth = (pricePerTiBPerMonthNoCDN * sizeInBytes) / SIZE_CONSTANTS.TiB

  return {
    storagePerMonth,
    cdnEgressPerTiB: pricePerTiBCdnEgress,
    cacheMissEgressPerTiB: pricePerTiBCacheMissEgress,
    minimumPerMonth: minimumPricePerMonth,
  }
}
