/**
 * @module FilBeamService
 * @description FilBeam service integration for Filecoin's pay-per-byte infrastructure.
 *
 * This module provides integration with FilBeam's services, including querying egress quotas
 * and managing pay-per-byte data delivery metrics.
 *
 * @see {@link https://docs.filbeam.com | FilBeam Documentation} - Official FilBeam documentation
 */

import { getDataSetStats as coreGetDataSetStats, type DataSetStats } from '@filoz/synapse-core/filbeam'
import type { request } from 'iso-web/http'
import type { FilecoinNetworkType } from '../types.ts'
import { CHAIN_IDS } from '../utils/constants.ts'
import { createError } from '../utils/errors.ts'

export type { DataSetStats }

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
 * console.log('Remaining CDN Egress:', stats.cdnEgressQuota)
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
  private readonly _requestGetJson: typeof request.json.get | undefined

  constructor(network: FilecoinNetworkType, requestGetJson?: typeof request.json.get) {
    this._validateNetworkType(network)
    this._network = network
    this._requestGetJson = requestGetJson
  }

  private _validateNetworkType(network: FilecoinNetworkType) {
    if (network === 'mainnet' || network === 'calibration' || network === 'devnet') return

    throw createError(
      'FilBeamService',
      'validateNetworkType',
      'Unsupported network type: Only Filecoin mainnet, calibration, and devnet networks are supported.'
    )
  }

  /**
   * Retrieves remaining pay-per-byte statistics for a specific data set from FilBeam.
   *
   * Fetches the remaining CDN and cache miss egress quotas for a data set. These quotas
   * track how many bytes can still be retrieved through FilBeam's trusted measurement layer
   * before needing to add more credits:
   *
   * - **CDN Egress Quota**: Remaining bytes that can be served by FilBeam (both cache-hit and cache-miss requests)
   * - **Cache Miss Egress Quota**: Remaining bytes that can be retrieved from storage providers (cache-miss requests to origin)
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
    const chainId = CHAIN_IDS[this._network]
    return coreGetDataSetStats({
      chainId,
      dataSetId,
      requestGetJson: this._requestGetJson,
    })
  }
}
