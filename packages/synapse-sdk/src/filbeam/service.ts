import type { FilecoinNetworkType } from '../types.ts'
import { createError } from '../utils/errors.ts'

/**
 * Data set statistics from FilBeam
 */
export interface DataSetStats {
  cdnEgressQuota: bigint
  cacheMissEgressQuota: bigint
}

/**
 * Service for interacting with FilBeam stats API
 */
export class FilBeamService {
  private readonly _network: FilecoinNetworkType
  private readonly _fetch: typeof fetch

  constructor(network: FilecoinNetworkType, fetchImpl: typeof fetch = globalThis.fetch) {
    this._network = network
    this._fetch = fetchImpl
  }

  /**
   * Creates a new FilBeamService instance
   */
  static create(network: FilecoinNetworkType, fetchImpl?: typeof fetch): FilBeamService {
    return new FilBeamService(network, fetchImpl)
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
   * Get stats for a data set from FilBeam
   * @param dataSetId The data set ID to get stats for
   * @returns The data set statistics with quotas as bigints
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
