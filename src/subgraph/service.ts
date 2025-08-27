/**
 * SubgraphService - A service for querying a subgraph to find service providers for a given piece.
 *
 * This service abstracts the logic for connecting to and querying a GraphQL endpoint,
 * which can be a direct URL or a Goldsky-hosted subgraph.
 *
 * @example
 * ```typescript
 * import { SubgraphService } from '@filoz/synapse-sdk/subgraph'
 *
 * // Using a direct endpoint
 * const subgraphService = new SubgraphService({ endpoint: 'https://your-subgraph-endpoint.com/query' });
 *
 * // Using Goldsky configuration
 * const goldskyService = new SubgraphService({
 *   goldsky: {
 *     projectId: 'your-project-id',
 *     subgraphName: 'your-subgraph-name',
 *     version: 'v1.0.0'
 *   }
 * });
 *
 * const providers = await subgraphService.getApprovedProvidersForPieceCID('bafkzcib...');
 * console.log(providers);
 * ```
 */

import { fromHex, toHex } from 'multiformats/bytes'
import { CID } from 'multiformats/cid'
import { asPieceCID } from '../piece/index.js'
import type { ApprovedProviderInfo, PieceCID, SubgraphConfig, SubgraphRetrievalService } from '../types.js'
import { createError } from '../utils/errors.js'
import { QUERIES } from './queries.js'

// Simplified response types
interface GraphQLResponse<T = any> {
  data?: T
  errors?: Array<{ message: string }>
}

/**
 * Options for pagination in subgraph queries
 */
export interface PaginationOptions {
  first?: number
  skip?: number
}

/**
 * Options for flexible subgraph queries with custom where clauses
 */
export interface QueryOptions extends PaginationOptions {
  where?: Record<string, any>
  orderBy?: string
  orderDirection?: 'asc' | 'desc'
}

/**
 * Options for nested entity queries in subgraphs
 */
export interface NestedQueryOptions extends QueryOptions {
  nestedWhere?: Record<string, any>
}

/**
 * Extended provider statistics including fault information
 */
export interface ProviderStats extends ApprovedProviderInfo {
  status: string
  totalFaultedPeriods: number
  totalFaultedPieces: number
  totalDataSets: number
  totalPieces: number
  totalDataSize: number
  createdAt: number
  updatedAt: number
}

/**
 * Basic data set information from subgraph
 */
export interface SubgraphDataSetInfo {
  id: string
  setId: number
  isActive: boolean
  leafCount: number
  totalDataSize: number
  totalPieces: number
  totalProofs: number
  totalProvedPieces: number
  totalFaultedPieces: number
  createdAt: number
  updatedAt: number
}

/**
 * Detailed data set information from subgraph with additional metadata
 */
export interface DetailedSubgraphDataSetInfo extends SubgraphDataSetInfo {
  listener: string
  clientAddr: string
  withCDN: boolean
  challengeRange: number
  lastProvenEpoch: number
  nextChallengeEpoch: number
  totalFaultedPeriods: number
  metadata: string
  serviceProvider: ApprovedProviderInfo
  rail?: {
    id: string
    railId: number
    token: string
    paymentRate: number
    lockupPeriod: number
    settledUpto: number
    endEpoch: number
  }
}

/**
 * Piece information with data set context
 */
export interface PieceInfo {
  id: string
  setId: number
  pieceId: number
  rawSize: number
  leafCount: number
  cid: PieceCID | null
  removed: boolean
  totalProofsSubmitted: number
  totalPeriodsFaulted: number
  lastProvenEpoch: number
  lastProvenAt: number
  lastFaultedEpoch: number
  lastFaultedAt: number
  createdAt: number
  metadata: string
  dataSet: {
    id: string
    setId: number
    isActive: boolean
    serviceProvider: ApprovedProviderInfo
  }
}

/**
 * Fault record information
 */
export interface FaultRecord {
  id: string
  dataSetId: number
  pieceIds: number[]
  currentChallengeEpoch: number
  nextChallengeEpoch: number
  periodsFaulted: number
  deadline: number
  createdAt: number
  dataSet: {
    id: string
    setId: number
    serviceProvider: ApprovedProviderInfo
  }
}

export class SubgraphService implements SubgraphRetrievalService {
  private readonly endpoint: string
  private readonly headers: Record<string, string>

  constructor(subgraphConfig: SubgraphConfig) {
    this.endpoint = this.resolveEndpoint(subgraphConfig)
    this.headers = this.buildHeaders(subgraphConfig.apiKey)
  }

  /**
   * Resolves the GraphQL endpoint from configuration
   */
  private resolveEndpoint(config: SubgraphConfig): string {
    if (config.endpoint != null && config.endpoint.trim() !== '') {
      return config.endpoint.trim()
    }

    if (config.goldsky != null) {
      return this.buildGoldskyEndpoint(config.goldsky)
    }

    throw createError(
      'SubgraphService',
      'constructor',
      'Invalid configuration: provide either endpoint or complete goldsky config'
    )
  }

  /**
   * Builds Goldsky endpoint URL
   */
  private buildGoldskyEndpoint(goldsky: NonNullable<SubgraphConfig['goldsky']>): string {
    const { projectId, subgraphName, version } = goldsky

    if (
      projectId?.trim() == null ||
      projectId?.trim() === '' ||
      subgraphName?.trim() == null ||
      subgraphName?.trim() === '' ||
      version?.trim() == null ||
      version?.trim() === ''
    ) {
      throw createError(
        'SubgraphService',
        'constructor',
        'Incomplete Goldsky config: projectId, subgraphName, and version required'
      )
    }

    return `https://api.goldsky.com/api/public/${projectId}/subgraphs/${subgraphName}/${version}/gn`
  }

  /**
   * Builds HTTP headers for requests
   */
  private buildHeaders(apiKey?: string): Record<string, string> {
    const headers = { 'Content-Type': 'application/json' }

    if (apiKey != null && apiKey !== '') {
      return { ...headers, Authorization: `Bearer ${apiKey}` }
    }

    return headers
  }

  /**
   * Normalizes query options with defaults
   */
  private normalizeQueryOptions(options: QueryOptions = {}): QueryOptions {
    return {
      where: {},
      first: 10,
      skip: 0,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      ...options,
    } as const
  }

  /**
   * Executes a GraphQL query
   */
  private async executeQuery<T>(query: string, variables: Record<string, any>, operation: string): Promise<T> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        throw createError('SubgraphService', operation, `HTTP ${response.status}: ${errorText}`)
      }

      const result = (await response.json()) as GraphQLResponse<T>

      if (result.errors != null && result.errors.length > 0) {
        const errorMsg = result.errors.map((e) => e.message).join('; ')
        throw createError('SubgraphService', operation, `GraphQL errors: ${errorMsg}`)
      }

      return result.data as T
    } catch (error) {
      if (error instanceof Error && error.name === 'SynapseError') {
        throw error
      }

      throw createError('SubgraphService', operation, `Query execution failed: ${(error as Error).message}`, {
        cause: error,
      })
    }
  }

  /**
   * Transforms provider data to ApprovedProviderInfo
   */
  private transformProviderData(data: any): ApprovedProviderInfo {
    return {
      serviceProvider: data.serviceProvider ?? data.address ?? data.id,
      serviceURL: data.serviceURL ?? data.pdpUrl,
      peerId: data.peerId ?? '',
      registeredAt: this.parseTimestamp(data.registeredAt),
      approvedAt: this.parseTimestamp(data.approvedAt),
    }
  }

  /**
   * Safely parses timestamp values
   */
  private parseTimestamp(value?: number | string): number {
    if (value == null) return 0
    const parsed = Number(value)
    return isNaN(parsed) ? 0 : parsed
  }

  /**
   * Safely converts a hex format CID to PieceCID format
   * @param hexCid - The CID in hex format
   * @returns The CID in PieceCID format or null if conversion fails
   */
  private safeConvertHexToCid(hexCid: string): PieceCID | null {
    try {
      const cleanHex = hexCid.startsWith('0x') ? hexCid.slice(2) : hexCid
      const cidBytes = fromHex(cleanHex)
      const cid = CID.decode(cidBytes)
      const pieceCid = asPieceCID(cid)

      if (pieceCid == null) {
        throw new Error(`Failed to convert CID to PieceCID format: ${hexCid}`)
      }

      return pieceCid
    } catch (error) {
      console.warn(
        `SubgraphService: queryProviders: Failed to convert CID to PieceCID format: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
      return null
    }
  }

  /**
   * Validates provider data completeness
   */
  private isValidProviderData(data: any): boolean {
    return data?.id != null && data.id.trim() !== '' && data?.serviceURL != null && data.serviceURL.trim() !== ''
  }

  /**
   * Queries the subgraph to find approved service providers that have a specific piece (PieceCID).
   *
   * It sends a GraphQL query to the configured endpoint and parses the response to extract
   * a list of providers, including their addresses and retrieval URLs.
   *
   * @param pieceCid - The piece commitment (PieceCID) to search for.
   * @returns A promise that resolves to an array of `ApprovedProviderInfo` objects.
   *          Returns an empty array if no providers are found or if an error occurs during the fetch.
   */
  async getApprovedProvidersForPieceCID(pieceCid: PieceCID): Promise<ApprovedProviderInfo[]> {
    const pieceCidParsed = asPieceCID(pieceCid)
    if (pieceCidParsed == null) {
      throw createError('SubgraphService', 'getApprovedProvidersForPieceCID', 'Invalid PieceCID')
    }
    const hexPieceCid = toHex(pieceCidParsed.bytes)

    const data = await this.executeQuery<{ pieces: any[] }>(
      QUERIES.GET_APPROVED_PROVIDERS_FOR_PIECE_LINK,
      { cid: hexPieceCid },
      'getApprovedProvidersForPieceCID'
    )

    if (data?.pieces == null || data.pieces.length === 0) {
      console.log(`SubgraphService: No providers found for PieceCID: ${pieceCidParsed.toString()}`)
      return []
    }

    const uniqueProviderMap = data.pieces.reduce((acc: Map<string, any>, piece: any) => {
      const provider = piece.dataSet.serviceProvider
      const address = provider?.address?.toLowerCase() as string

      if (provider?.status !== 'Approved' || address == null || address === '' || acc.has(address)) {
        return acc
      }

      if (!this.isValidProviderData(provider)) {
        console.warn('SubgraphService: Skipping incomplete provider data for approved provider:', provider)
        return acc
      }

      acc.set(address, provider)

      return acc
    }, new Map<string, any>())

    return Array.from(uniqueProviderMap.values()).map((provider) => this.transformProviderData(provider))
  }

  /**
   * Queries the subgraph to find a specific approved service provider by their address.
   *
   * @param address - The wallet address of the provider to search for.
   * @returns A promise that resolves to an `ApprovedProviderInfo` object if the provider is found, or `null` otherwise.
   */
  async getProviderByAddress(address: string): Promise<ApprovedProviderInfo | null> {
    const data = await this.executeQuery<{ provider: any | null }>(
      QUERIES.GET_PROVIDER_BY_ADDRESS,
      { providerId: address },
      'getProviderByAddress'
    )

    if (data?.provider == null) {
      console.log(`SubgraphService: No provider found for address: ${address}`)
      return null
    }

    return this.transformProviderData(data.provider)
  }

  /**
   * Generic method to query providers with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `ApprovedProviderInfo` objects
   *
   * @example
   * ```typescript
   * // Get providers with specific status
   * const approvedProviders = await service.queryProviders({
   *   where: { status: "APPROVED" },
   *   first: 10,
   *   orderBy: "approvedAt",
   *   orderDirection: "desc"
   * });
   *
   * // Get providers with minimum data sets
   * const activeProviders = await service.queryProviders({
   *   where: { totalDataSets_gte: "5" },
   *   first: 20
   * });
   * ```
   */
  async queryProviders(options: QueryOptions = {}): Promise<ApprovedProviderInfo[]> {
    const data = await this.executeQuery<{ providers: any[] }>(
      QUERIES.GET_PROVIDERS_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryProviders'
    )

    if (data?.providers == null || data?.providers?.length === 0) {
      console.log('SubgraphService: No providers found for the given criteria')
      return []
    }

    return data.providers
      .filter((provider) => this.isValidProviderData(provider))
      .map((provider) => this.transformProviderData(provider))
  }

  /**
   * Generic method to query data sets with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `DetailedSubgraphDataSetInfo` objects
   *
   * @example
   * ```typescript
   * // Get active data sets
   * const activeDataSets = await service.queryDataSets({
   *   where: { isActive: true },
   *   first: 50,
   *   orderBy: "createdAt",
   *   orderDirection: "desc"
   * });
   *
   * // Get data sets by owner with minimum data size
   * const largeDataSets = await service.queryDataSets({
   *   where: {
   *     owner: "0x123...",
   *     totalDataSize_gte: "1000000000"
   *   }
   * });
   * ```
   */
  async queryDataSets(options: QueryOptions = {}): Promise<DetailedSubgraphDataSetInfo[]> {
    const data = await this.executeQuery<{ dataSets: any[] }>(
      QUERIES.GET_DATA_SETS_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryDataSets'
    )

    if (data?.dataSets == null || data?.dataSets?.length === 0) {
      console.log('SubgraphService: No data sets found for the given criteria')
      return []
    }

    return data.dataSets.map((dataSet: any) => ({
      id: dataSet.id,
      setId: this.parseTimestamp(dataSet.setId),
      listener: dataSet.listener ?? '',
      clientAddr: dataSet.clientAddr ?? '',
      withCDN: dataSet.withCDN ?? false,
      isActive: dataSet.isActive,
      leafCount: this.parseTimestamp(dataSet.leafCount),
      challengeRange: this.parseTimestamp(dataSet.challengeRange),
      lastProvenEpoch: this.parseTimestamp(dataSet.lastProvenEpoch),
      nextChallengeEpoch: this.parseTimestamp(dataSet.nextChallengeEpoch),
      totalPieces: this.parseTimestamp(dataSet.totalPieces),
      totalDataSize: this.parseTimestamp(dataSet.totalDataSize),
      totalProofs: this.parseTimestamp(dataSet.totalProofs),
      totalProvedPieces: this.parseTimestamp(dataSet.totalProvedPieces),
      totalFaultedPeriods: this.parseTimestamp(dataSet.totalFaultedPeriods),
      totalFaultedPieces: this.parseTimestamp(dataSet.totalFaultedPieces),
      metadata: dataSet.metadata ?? '',
      createdAt: this.parseTimestamp(dataSet.createdAt),
      updatedAt: this.parseTimestamp(dataSet.updatedAt),
      owner:
        dataSet.owner != null
          ? this.transformProviderData(dataSet.owner)
          : {
              serviceProvider: '',
              serviceURL: '',
              peerId: '',
              registeredAt: 0,
              approvedAt: 0,
            },
      serviceProvider:
        dataSet.serviceProvider != null
          ? this.transformProviderData(dataSet.serviceProvider)
          : {
              serviceProvider: '',
              serviceURL: '',
              peerId: '',
              registeredAt: 0,
              approvedAt: 0,
            },
      rail:
        dataSet.rail != null
          ? {
              id: dataSet.rail.id,
              railId: this.parseTimestamp(dataSet.rail.railId),
              token: dataSet.rail.token,
              paymentRate: this.parseTimestamp(dataSet.rail.paymentRate),
              lockupPeriod: this.parseTimestamp(dataSet.rail.lockupPeriod),
              settledUpto: this.parseTimestamp(dataSet.rail.settledUpto),
              endEpoch: this.parseTimestamp(dataSet.rail.endEpoch),
            }
          : undefined,
    }))
  }

  /**
   * Generic method to query pieces with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `PieceInfo` objects
   *
   * @example
   * ```typescript
   * // Get pieces by data set
   * const dataSetPieces = await service.queryPieces({
   *   where: { dataSet: "0x123..." },
   *   first: 100,
   *   orderBy: "createdAt"
   * });
   *
   * // Get non-removed pieces with minimum size
   * const largePieces = await service.queryPieces({
   *   where: {
   *     removed: false,
   *     rawSize_gte: "1000000"
   *   }
   * });
   * ```
   */
  async queryPieces(options: QueryOptions = {}): Promise<PieceInfo[]> {
    const data = await this.executeQuery<{ pieces: any[] }>(
      QUERIES.GET_PIECES_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryPieces'
    )

    if (data?.pieces == null || data?.pieces?.length === 0) {
      console.log('SubgraphService: No pieces found for the given criteria')
      return []
    }

    return data.pieces.map((piece) => ({
      id: piece.id,
      setId: this.parseTimestamp(piece.setId),
      pieceId: this.parseTimestamp(piece.pieceId),
      rawSize: this.parseTimestamp(piece.rawSize),
      leafCount: this.parseTimestamp(piece.leafCount),
      cid: this.safeConvertHexToCid(piece.cid),
      removed: piece.removed,
      totalProofsSubmitted: this.parseTimestamp(piece.totalProofsSubmitted),
      totalPeriodsFaulted: this.parseTimestamp(piece.totalPeriodsFaulted),
      lastProvenEpoch: this.parseTimestamp(piece.lastProvenEpoch),
      lastProvenAt: this.parseTimestamp(piece.lastProvenAt),
      lastFaultedEpoch: this.parseTimestamp(piece.lastFaultedEpoch),
      lastFaultedAt: this.parseTimestamp(piece.lastFaultedAt),
      createdAt: this.parseTimestamp(piece.createdAt),
      metadata: piece.metadata ?? '',
      dataSet: {
        id: piece.dataSet.id,
        setId: this.parseTimestamp(piece.dataSet.setId),
        isActive: piece.dataSet.isActive,
        serviceProvider: this.transformProviderData(piece.dataSet.serviceProvider),
      },
    }))
  }

  /**
   * Generic method to query fault records with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `FaultRecord` objects
   *
   * @example
   * ```typescript
   * // Get recent fault records
   * const recentFaults = await service.queryFaultRecords({
   *   where: { createdAt_gte: "1640995200" },
   *   first: 20,
   *   orderBy: "createdAt",
   *   orderDirection: "desc"
   * });
   *
   * // Get fault records for specific data set
   * const dataSetFaults = await service.queryFaultRecords({
   *   where: { dataSetId: "123" }
   * });
   * ```
   */
  async queryFaultRecords(options: QueryOptions = {}): Promise<FaultRecord[]> {
    const data = await this.executeQuery<{ faultRecords: any[] }>(
      QUERIES.GET_FAULT_RECORDS_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryFaultRecords'
    )

    if (data?.faultRecords == null || data?.faultRecords?.length === 0) {
      console.log('SubgraphService: No fault records found for the given criteria')
      return []
    }

    return data.faultRecords.map((fault) => ({
      id: fault.id,
      dataSetId: this.parseTimestamp(fault.dataSetId),
      pieceIds: fault.pieceIds.map((id: any) => this.parseTimestamp(id)),
      currentChallengeEpoch: this.parseTimestamp(fault.currentChallengeEpoch),
      nextChallengeEpoch: this.parseTimestamp(fault.nextChallengeEpoch),
      periodsFaulted: this.parseTimestamp(fault.periodsFaulted),
      deadline: this.parseTimestamp(fault.deadline),
      createdAt: this.parseTimestamp(fault.createdAt),
      dataSet: {
        id: fault.dataSet.id,
        setId: this.parseTimestamp(fault.dataSet.setId),
        serviceProvider: this.transformProviderData(fault.dataSet.serviceProvider),
      },
    }))
  }
}
