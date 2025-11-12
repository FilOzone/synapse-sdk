import type { Provider } from 'ethers'
import type { FilecoinNetworkType } from '../types.ts'
import { createError } from '../utils/errors.ts'
import { getFilecoinNetworkType } from '../utils/network.ts'

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
  static async create(provider: Provider, fetchImpl?: typeof fetch): Promise<FilBeamService> {
    const network = await getFilecoinNetworkType(provider)
    return new FilBeamService(network, fetchImpl)
  }

  /**
   * Get the base stats URL for the current network
   */
  private _getStatsBaseUrl(): string {
    return this._network === 'mainnet' ? 'https://stats.filbeam.io' : 'https://calibration.stats.filbeam.io'
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

    const data = (await response.json()) as { cdnEgressQuota: string; cacheMissEgressQuota: string }

    return {
      cdnEgressQuota: BigInt(data.cdnEgressQuota),
      cacheMissEgressQuota: BigInt(data.cacheMissEgressQuota),
    }
  }
}
