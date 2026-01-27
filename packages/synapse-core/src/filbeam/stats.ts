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
  /** The remaining quota for all requests served by FilBeam (both cache-hit and cache-miss) in bytes */
  cdnEgressQuota: bigint
  /** The remaining quota for cache-miss requests served by the Storage Provider in bytes */
  cacheMissEgressQuota: bigint
}

export interface GetDataSetStatsOptions {
  /** The chain ID (314 for mainnet, 314159 for calibration) */
  chainId: number
  /** The data set ID to query */
  dataSetId: bigint | number | string
  /** Optional override for request.json.get (for testing) */
  requestGetJson?: typeof request.json.get
}

/**
 * Retrieves remaining pay-per-byte statistics for a specific data set from FilBeam.
 *
 * Fetches the remaining CDN and cache miss egress quotas for a data set. These quotas
 * track how many bytes can still be retrieved through FilBeam's trusted measurement layer
 * before needing to add more credits:
 *
 * - **CDN Egress Quota**: Remaining bytes for all requests served by FilBeam (both cache-hit and cache-miss)
 * - **Cache Miss Egress Quota**: Remaining bytes for cache-miss requests served by the Storage Provider
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
  const requestGetJson = options.requestGetJson ?? request.json.get

  const response = await requestGetJson<unknown>(url)

  if (response.error) {
    if (HttpError.is(response.error)) {
      const status = response.error.response.status
      if (status === 404) {
        throw new GetDataSetStatsError(`Data set not found: ${options.dataSetId}`, {
          cause: response.error,
        })
      }
      const errorText = await response.error.response.text().catch(() => 'Unknown error')
      throw new GetDataSetStatsError(`Failed to fetch data set stats`, {
        details: `HTTP ${status} ${response.error.response.statusText}: ${errorText}`,
        cause: response.error,
      })
    }
    throw new GetDataSetStatsError('Unexpected error', { cause: response.error })
  }

  return validateStatsResponse(response.result)
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
    throw new GetDataSetStatsError('Invalid response format', {
      details: `${fieldName} is not a valid integer: "${value}"`,
    })
  }
  return BigInt(value)
}

/**
 * Validates the response from FilBeam stats API and returns DataSetStats
 */
export function validateStatsResponse(data: unknown): DataSetStats {
  if (typeof data !== 'object' || data === null) {
    throw new GetDataSetStatsError('Invalid response format', {
      details: 'Response is not an object',
    })
  }

  const response = data as Record<string, unknown>

  if (typeof response.cdnEgressQuota !== 'string') {
    throw new GetDataSetStatsError('Invalid response format', {
      details: 'cdnEgressQuota must be a string',
    })
  }

  if (typeof response.cacheMissEgressQuota !== 'string') {
    throw new GetDataSetStatsError('Invalid response format', {
      details: 'cacheMissEgressQuota must be a string',
    })
  }

  return {
    cdnEgressQuota: parseBigInt(response.cdnEgressQuota, 'cdnEgressQuota'),
    cacheMissEgressQuota: parseBigInt(response.cacheMissEgressQuota, 'cacheMissEgressQuota'),
  }
}
