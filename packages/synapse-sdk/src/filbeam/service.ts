/**
 * @module FilBeamService
 * @description FilBeam service integration for Filecoin's pay-per-byte infrastructure.
 *
 * This module provides integration with FilBeam's services, including querying egress quotas
 * and managing pay-per-byte data delivery metrics.
 *
 * @see {@link https://docs.filbeam.com | FilBeam Documentation} - Official FilBeam documentation
 */

import type { FilecoinNetworkType } from '../types.ts'
import { createError } from '../utils/errors.ts'

/**
 * Data set statistics from FilBeam.
 *
 * These quotas represent the remaining pay-per-byte allocation available for data retrieval
 * through FilBeam's trusted measurement layer. The values decrease as data is served and
 * represent how many bytes can still be retrieved before needing to add more credits.
 *
 * @interface DataSetStats
 * @property {bigint} cdnEgressQuota - The remaining CDN egress quota for cache hits (data served directly from FilBeam's cache) in bytes
 * @property {bigint} cacheMissEgressQuota - The remaining egress quota for cache misses (data retrieved from storage providers) in bytes
 */
export interface DataSetStats {
  cdnEgressQuota: bigint
  cacheMissEgressQuota: bigint
}

/**
 * Service for interacting with FilBeam infrastructure and APIs.
 *
 * @example
 * ```typescript
 * // Create service with network detection
 * const synapse = await Synapse.create({ privateKey, rpcURL })
 * const stats = await synapse.filbeam.getDataSetStats(12345)
 *
 * // Monitor remaining pay-per-byte quotas
 * const service = new FilBeamService('mainnet')
 * const stats = await service.getDataSetStats(12345)
 * console.log('Remaining CDN Egress (cache hits):', stats.cdnEgressQuota)
 * console.log('Remaining Cache Miss Egress:', stats.cacheMissEgressQuota)
 * ```
 *
 * @remarks
 * All quota values are returned as BigInt for precision when handling large byte values.
 *
 * @see {@link https://docs.filbeam.com | FilBeam Documentation} for detailed API specifications and usage guides
 */
export class FilBeamService {
  private readonly _network: FilecoinNetworkType
  private readonly _fetch: typeof fetch

  constructor(network: FilecoinNetworkType, fetchImpl: typeof fetch = globalThis.fetch) {
    this._validateNetworkType(network)
    this._network = network
    this._fetch = fetchImpl
  }

  private _validateNetworkType(network: FilecoinNetworkType) {
    if (network === 'mainnet' || network === 'calibration') return

    throw createError(
      'FilBeamService',
      'validateNetworkType',
      'Unsupported network type: Only Filecoin mainnet and calibration networks are supported.'
    )
  }

  /**
   * Get the base stats URL for the current network
   */
  private _getStatsBaseUrl(): string {
    return this._network === 'mainnet' ? 'https://stats.filbeam.io' : 'https://calibration.stats.filbeam.io'
  }

  /**
   * Validates the response from FilBeam stats API
   */
  private _validateStatsResponse(data: unknown): { cdnEgressQuota: string; cacheMissEgressQuota: string } {
    if (typeof data !== 'object' || data === null) {
      throw createError('FilBeamService', 'validateStatsResponse', 'Response is not an object')
    }

    const response = data as Record<string, unknown>

    if (typeof response.cdnEgressQuota !== 'string') {
      throw createError('FilBeamService', 'validateStatsResponse', 'cdnEgressQuota must be a string')
    }

    if (typeof response.cacheMissEgressQuota !== 'string') {
      throw createError('FilBeamService', 'validateStatsResponse', 'cacheMissEgressQuota must be a string')
    }

    return {
      cdnEgressQuota: response.cdnEgressQuota,
      cacheMissEgressQuota: response.cacheMissEgressQuota,
    }
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
   * Both types of egress are billed based on volume. Query current pricing via
   * {@link WarmStorageService.getServicePrice} or see https://docs.filbeam.com for rates.
   *
   * @param dataSetId - The unique identifier of the data set to query
   * @returns A promise that resolves to the data set statistics with remaining quotas as BigInt values
   *
   * @throws {Error} Throws an error if:
   * - The data set is not found (404)
   * - The API returns an invalid response format
   * - Network or other HTTP errors occur
   *
   * @example
   * ```typescript
   * try {
   *   const stats = await service.getDataSetStats('my-dataset-123')
   *
   *   // Display remaining quotas
   *   console.log(`Remaining CDN Egress: ${stats.cdnEgressQuota} bytes`)
   *   console.log(`Remaining Cache Miss: ${stats.cacheMissEgressQuota} bytes`)
   * } catch (error) {
   *   console.error('Failed to get stats:', error.message)
   * }
   * ```
   */
  async getDataSetStats(dataSetId: string | number): Promise<DataSetStats> {
    const baseUrl = this._getStatsBaseUrl()
    const url = `${baseUrl}/data-set/${dataSetId}`

    const response = await this._fetch(url, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    })

    if (response.status === 404) {
      throw createError('FilBeamService', 'getDataSetStats', `Data set not found: ${dataSetId}`)
    }

    if (response.status !== 200) {
      const errorText = await response.text().catch(() => 'Unknown error')
      throw createError(
        'FilBeamService',
        'getDataSetStats',
        `HTTP ${response.status} ${response.statusText}: ${errorText}`
      )
    }

    const data = await response.json()
    const validated = this._validateStatsResponse(data)

    return {
      cdnEgressQuota: BigInt(validated.cdnEgressQuota),
      cacheMissEgressQuota: BigInt(validated.cacheMissEgressQuota),
    }
  }
}
