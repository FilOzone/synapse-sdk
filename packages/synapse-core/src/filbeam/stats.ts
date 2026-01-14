/**
 * FilBeam Stats API
 *
 * @example
 * ```ts
 * import { getDataSetStats } from '@filoz/synapse-core/filbeam'
 * ```
 *
 * @module filbeam
 */

import { HttpError, request } from 'iso-web/http'
import { GetDataSetStatsError } from '../errors/filbeam.ts'

/**
 * Data set statistics from FilBeam.
 *
 * These quotas represent the remaining pay-per-byte allocation available for data retrieval
 * through FilBeam's trusted measurement layer. The values decrease as data is served and
 * represent how many bytes can still be retrieved before needing to add more credits.
 */
export interface DataSetStats {
  /** The remaining CDN egress quota for cache hits (data served directly from FilBeam's cache) in bytes */
  cdnEgressQuota: bigint
  /** The remaining egress quota for cache misses (data retrieved from storage providers) in bytes */
  cacheMissEgressQuota: bigint
}

/**
 * Get the base stats URL for a given chain ID
 */
export function getStatsBaseUrl(chainId: number): string {
  return chainId === 314 ? 'https://stats.filbeam.com' : 'https://calibration.stats.filbeam.com'
}

/**
 * Validates that a string can be converted to a valid BigInt
 */
function parseBigInt(value: string, fieldName: string): bigint {
  // Check if the string is a valid integer format (optional minus sign followed by digits)
  if (!/^-?\d+$/.test(value)) {
    throw new GetDataSetStatsError('Invalid response format', `${fieldName} is not a valid integer: "${value}"`)
  }
  return BigInt(value)
}

/**
 * Validates the response from FilBeam stats API and returns DataSetStats
 */
export function validateStatsResponse(data: unknown): DataSetStats {
  if (typeof data !== 'object' || data === null) {
    throw new GetDataSetStatsError('Invalid response format', 'Response is not an object')
  }

  const response = data as Record<string, unknown>

  if (typeof response.cdnEgressQuota !== 'string') {
    throw new GetDataSetStatsError('Invalid response format', 'cdnEgressQuota must be a string')
  }

  if (typeof response.cacheMissEgressQuota !== 'string') {
    throw new GetDataSetStatsError('Invalid response format', 'cacheMissEgressQuota must be a string')
  }

  return {
    cdnEgressQuota: parseBigInt(response.cdnEgressQuota, 'cdnEgressQuota'),
    cacheMissEgressQuota: parseBigInt(response.cacheMissEgressQuota, 'cacheMissEgressQuota'),
  }
}

export interface GetDataSetStatsOptions {
  /** The chain ID (314 for mainnet, 314159 for calibration) */
  chainId: number
  /** The data set ID to query */
  dataSetId: bigint | number | string
}

/**
 * Retrieves remaining pay-per-byte statistics for a specific data set from FilBeam.
 *
 * Fetches the remaining CDN and cache miss egress quotas for a data set. These quotas
 * track how many bytes can still be retrieved through FilBeam's trusted measurement layer
 * before needing to add more credits:
 *
 * - **CDN Egress Quota**: Remaining bytes that can be served from FilBeam's cache (fast, direct delivery)
 * - **Cache Miss Egress Quota**: Remaining bytes that can be retrieved from storage providers (triggers caching)
 *
 * @param options - The options for fetching data set stats
 * @returns A promise that resolves to the data set statistics with remaining quotas as BigInt values
 *
 * @throws {GetDataSetStatsError} If the data set is not found, the API returns an invalid response, or network errors occur
 *
 * @example
 * ```typescript
 * const stats = await getDataSetStats({ chainId: 314, dataSetId: 12345n })
 * console.log(`Remaining CDN Egress: ${stats.cdnEgressQuota} bytes`)
 * console.log(`Remaining Cache Miss: ${stats.cacheMissEgressQuota} bytes`)
 * ```
 */
export async function getDataSetStats(options: GetDataSetStatsOptions): Promise<DataSetStats> {
  const baseUrl = getStatsBaseUrl(options.chainId)
  const url = `${baseUrl}/data-set/${options.dataSetId}`

  const response = await request.json.get<unknown>(url)

  if (response.error) {
    if (HttpError.is(response.error)) {
      const status = response.error.response.status
      if (status === 404) {
        throw new GetDataSetStatsError(`Data set not found: ${options.dataSetId}`)
      }
      const errorText = await response.error.response.text().catch(() => 'Unknown error')
      throw new GetDataSetStatsError(
        `Failed to fetch data set stats`,
        `HTTP ${status} ${response.error.response.statusText}: ${errorText}`
      )
    }
    throw response.error
  }

  return validateStatsResponse(response.result)
}
