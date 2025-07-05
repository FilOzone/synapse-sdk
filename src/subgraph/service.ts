/**
 * SubgraphService - A service for querying a subgraph to find storage providers for a given piece.
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
 * const providers = await subgraphService.getApprovedProvidersForCommP('baga6ea4seaq...');
 * console.log(providers);
 * ```
 */

import { toHex, fromHex } from 'multiformats/bytes'
import { CID } from 'multiformats/cid'
import { asCommP } from '../commp/commp.js'
import type {
  CommP,
  ApprovedProviderInfo,
  SubgraphRetrievalService,
  SubgraphConfig
} from '../types.js'
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
  totalFaultedRoots: number
  totalProofSets: number
  totalRoots: number
  totalDataSize: number
  createdAt: number
  updatedAt: number
}

/**
 * Basic proof set information from subgraph
 */
export interface SubgraphProofSetInfo {
  id: string
  setId: number
  isActive: boolean
  leafCount: number
  totalDataSize: number
  totalRoots: number
  totalProofs: number
  totalProvedRoots: number
  totalFaultedRoots: number
  createdAt: number
  updatedAt: number
}

/**
 * Detailed proof set information from subgraph with additional metadata
 */
export interface DetailedSubgraphProofSetInfo extends SubgraphProofSetInfo {
  listener: string
  clientAddr: string
  withCDN: boolean
  challengeRange: number
  lastProvenEpoch: number
  nextChallengeEpoch: number
  totalFaultedPeriods: number
  metadata: string
  owner: ApprovedProviderInfo
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
 * Root/piece information with proof set context
 */
export interface RootInfo {
  id: string
  setId: number
  rootId: number
  rawSize: number
  leafCount: number
  cid: CommP | null
  removed: boolean
  totalProofsSubmitted: number
  totalPeriodsFaulted: number
  lastProvenEpoch: number
  lastProvenAt: number
  lastFaultedEpoch: number
  lastFaultedAt: number
  createdAt: number
  metadata: string
  proofSet: {
    id: string
    setId: number
    isActive: boolean
    owner: ApprovedProviderInfo
  }
}

/**
 * Fault record information
 */
export interface FaultRecord {
  id: string
  proofSetId: number
  rootIds: number[]
  currentChallengeEpoch: number
  nextChallengeEpoch: number
  periodsFaulted: number
  deadline: number
  createdAt: number
  proofSet: {
    id: string
    setId: number
    owner: ApprovedProviderInfo
  }
}

export class SubgraphService implements SubgraphRetrievalService {
  private readonly endpoint: string
  private readonly headers: Record<string, string>

  constructor (subgraphConfig: SubgraphConfig) {
    this.endpoint = this.resolveEndpoint(subgraphConfig)
    this.headers = this.buildHeaders(subgraphConfig.apiKey)
  }

  /**
   * Resolves the GraphQL endpoint from configuration
   */
  private resolveEndpoint (config: SubgraphConfig): string {
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
  private buildGoldskyEndpoint (goldsky: NonNullable<SubgraphConfig['goldsky']>): string {
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
  private buildHeaders (apiKey?: string): Record<string, string> {
    const headers = { 'Content-Type': 'application/json' }

    if (apiKey != null && apiKey !== '') {
      return { ...headers, Authorization: `Bearer ${apiKey}` }
    }

    return headers
  }

  /**
   * Normalizes query options with defaults
   */
  private normalizeQueryOptions (options: QueryOptions = {}): QueryOptions {
    return {
      where: {},
      first: 10,
      skip: 0,
      orderBy: 'createdAt',
      orderDirection: 'desc',
      ...options
    } as const
  }

  /**
   * Executes a GraphQL query
   */
  private async executeQuery<T>(
    query: string,
    variables: Record<string, any>,
    operation: string
  ): Promise<T> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables })
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

      throw createError(
        'SubgraphService',
        operation,
        `Query execution failed: ${(error as Error).message}`,
        { cause: error }
      )
    }
  }

  /**
   * Transforms provider data to ApprovedProviderInfo
   */
  private transformProviderData (data: any): ApprovedProviderInfo {
    return {
      owner: data.address != null && data.address !== '' ? data.address : data.id,
      pdpUrl: data.pdpUrl,
      pieceRetrievalUrl: data.pieceRetrievalUrl,
      registeredAt: this.parseTimestamp(data.registeredAt),
      approvedAt: this.parseTimestamp(data.approvedAt)
    }
  }

  /**
   * Safely parses timestamp values
   */
  private parseTimestamp (value?: number | string): number {
    if (value == null) return 0
    const parsed = Number(value)
    return isNaN(parsed) ? 0 : parsed
  }

  /**
   * Safely converts a hex format CID to CommP format
   * @param hexCid - The CID in hex format
   * @returns The CID in CommP format or null if conversion fails
   */
  private safeConvertHexToCid (hexCid: string): CommP | null {
    try {
      const cleanHex = hexCid.startsWith('0x') ? hexCid.slice(2) : hexCid
      const cidBytes = fromHex(cleanHex)
      const cid = CID.decode(cidBytes)
      const commp = asCommP(cid)

      if (commp == null) {
        throw new Error(`Failed to convert CID to CommP format: ${hexCid}`)
      }

      return commp
    } catch (error) {
      console.warn(
        `SubgraphService: queryProviders: Failed to convert CID to CommP format: ${
          error instanceof Error ? error.message : 'Unknown error'
        }`
      )
      return null
    }
  }

  /**
   * Validates provider data completeness
   */
  private isValidProviderData (data: any): boolean {
    return (
      data?.id != null &&
      data.id.trim() !== '' &&
      data?.pdpUrl != null &&
      data.pdpUrl.trim() !== '' &&
      data?.pieceRetrievalUrl != null &&
      data.pieceRetrievalUrl.trim() !== ''
    )
  }

  /**
   * Queries the subgraph to find approved storage providers that have a specific piece (CommP).
   *
   * It sends a GraphQL query to the configured endpoint and parses the response to extract
   * a list of providers, including their addresses and retrieval URLs.
   *
   * @param commp - The piece commitment (CommP) to search for.
   * @returns A promise that resolves to an array of `ApprovedProviderInfo` objects.
   *          Returns an empty array if no providers are found or if an error occurs during the fetch.
   */
  async getApprovedProvidersForCommP (commP: CommP): Promise<ApprovedProviderInfo[]> {
    const commPParsed = asCommP(commP)
    if (commPParsed == null) {
      throw createError('SubgraphService', 'getApprovedProvidersForCommP', 'Invalid CommP')
    }
    const hexCommP = toHex(commPParsed.bytes)

    const data = await this.executeQuery<{ roots: any[] }>(
      QUERIES.GET_APPROVED_PROVIDERS_FOR_COMMP,
      { cid: hexCommP },
      'getApprovedProvidersForCommP'
    )

    if (data?.roots == null || data.roots.length === 0) {
      console.log(`SubgraphService: No providers found for CommP: ${commPParsed.toString()}`)
      return []
    }

    const uniqueProviderMap = data.roots.reduce((acc: Map<string, any>, root: any) => {
      const provider = root.proofSet.owner
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

    return Array.from(uniqueProviderMap.values()).map((provider) =>
      this.transformProviderData(provider)
    )
  }

  /**
   * Queries the subgraph to find a specific approved storage provider by their address.
   *
   * @param address - The wallet address of the provider to search for.
   * @returns A promise that resolves to an `ApprovedProviderInfo` object if the provider is found, or `null` otherwise.
   */
  async getProviderByAddress (address: string): Promise<ApprovedProviderInfo | null> {
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
   * // Get providers with minimum proof sets
   * const activeProviders = await service.queryProviders({
   *   where: { totalProofSets_gte: "5" },
   *   first: 20
   * });
   * ```
   */
  async queryProviders (options: QueryOptions = {}): Promise<ApprovedProviderInfo[]> {
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
   * Generic method to query proof sets with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `DetailedSubgraphProofSetInfo` objects
   *
   * @example
   * ```typescript
   * // Get active proof sets
   * const activeProofSets = await service.queryProofSets({
   *   where: { isActive: true },
   *   first: 50,
   *   orderBy: "createdAt",
   *   orderDirection: "desc"
   * });
   *
   * // Get proof sets by owner with minimum data size
   * const largeProofSets = await service.queryProofSets({
   *   where: {
   *     owner: "0x123...",
   *     totalDataSize_gte: "1000000000"
   *   }
   * });
   * ```
   */
  async queryProofSets (options: QueryOptions = {}): Promise<DetailedSubgraphProofSetInfo[]> {
    const data = await this.executeQuery<{ proofSets: any[] }>(
      QUERIES.GET_PROOF_SETS_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryProofSets'
    )

    if (data?.proofSets == null || data?.proofSets?.length === 0) {
      console.log('SubgraphService: No proof sets found for the given criteria')
      return []
    }

    return data.proofSets.map((proofSet: any) => ({
      id: proofSet.id,
      setId: this.parseTimestamp(proofSet.setId),
      listener: proofSet.listener ?? '',
      clientAddr: proofSet.clientAddr ?? '',
      withCDN: proofSet.withCDN ?? false,
      isActive: proofSet.isActive,
      leafCount: this.parseTimestamp(proofSet.leafCount),
      challengeRange: this.parseTimestamp(proofSet.challengeRange),
      lastProvenEpoch: this.parseTimestamp(proofSet.lastProvenEpoch),
      nextChallengeEpoch: this.parseTimestamp(proofSet.nextChallengeEpoch),
      totalRoots: this.parseTimestamp(proofSet.totalRoots),
      totalDataSize: this.parseTimestamp(proofSet.totalDataSize),
      totalProofs: this.parseTimestamp(proofSet.totalProofs),
      totalProvedRoots: this.parseTimestamp(proofSet.totalProvedRoots),
      totalFaultedPeriods: this.parseTimestamp(proofSet.totalFaultedPeriods),
      totalFaultedRoots: this.parseTimestamp(proofSet.totalFaultedRoots),
      metadata: proofSet.metadata ?? '',
      createdAt: this.parseTimestamp(proofSet.createdAt),
      updatedAt: this.parseTimestamp(proofSet.updatedAt),
      owner:
        proofSet.owner != null
          ? this.transformProviderData(proofSet.owner)
          : {
              owner: '',
              pdpUrl: '',
              pieceRetrievalUrl: '',
              registeredAt: 0,
              approvedAt: 0
            },
      rail:
        proofSet.rail != null
          ? {
              id: proofSet.rail.id,
              railId: this.parseTimestamp(proofSet.rail.railId),
              token: proofSet.rail.token,
              paymentRate: this.parseTimestamp(proofSet.rail.paymentRate),
              lockupPeriod: this.parseTimestamp(proofSet.rail.lockupPeriod),
              settledUpto: this.parseTimestamp(proofSet.rail.settledUpto),
              endEpoch: this.parseTimestamp(proofSet.rail.endEpoch)
            }
          : undefined
    }))
  }

  /**
   * Generic method to query roots with flexible where clauses
   *
   * @param options - Query options including where clause, pagination, and ordering
   * @returns A promise that resolves to an array of `RootInfo` objects
   *
   * @example
   * ```typescript
   * // Get roots by proof set
   * const proofSetRoots = await service.queryRoots({
   *   where: { proofSet: "0x123..." },
   *   first: 100,
   *   orderBy: "createdAt"
   * });
   *
   * // Get non-removed roots with minimum size
   * const largeRoots = await service.queryRoots({
   *   where: {
   *     removed: false,
   *     rawSize_gte: "1000000"
   *   }
   * });
   * ```
   */
  async queryRoots (options: QueryOptions = {}): Promise<RootInfo[]> {
    const data = await this.executeQuery<{ roots: any[] }>(
      QUERIES.GET_ROOTS_FLEXIBLE,
      this.normalizeQueryOptions(options),
      'queryRoots'
    )

    if (data?.roots == null || data?.roots?.length === 0) {
      console.log('SubgraphService: No roots found for the given criteria')
      return []
    }

    return data.roots.map((root) => ({
      id: root.id,
      setId: this.parseTimestamp(root.setId),
      rootId: this.parseTimestamp(root.rootId),
      rawSize: this.parseTimestamp(root.rawSize),
      leafCount: this.parseTimestamp(root.leafCount),
      cid: this.safeConvertHexToCid(root.cid),
      removed: root.removed,
      totalProofsSubmitted: this.parseTimestamp(root.totalProofsSubmitted),
      totalPeriodsFaulted: this.parseTimestamp(root.totalPeriodsFaulted),
      lastProvenEpoch: this.parseTimestamp(root.lastProvenEpoch),
      lastProvenAt: this.parseTimestamp(root.lastProvenAt),
      lastFaultedEpoch: this.parseTimestamp(root.lastFaultedEpoch),
      lastFaultedAt: this.parseTimestamp(root.lastFaultedAt),
      createdAt: this.parseTimestamp(root.createdAt),
      metadata: root.metadata ?? '',
      proofSet: {
        id: root.proofSet.id,
        setId: this.parseTimestamp(root.proofSet.setId),
        isActive: root.proofSet.isActive,
        owner: this.transformProviderData(root.proofSet.owner)
      }
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
   * // Get fault records for specific proof set
   * const proofSetFaults = await service.queryFaultRecords({
   *   where: { proofSetId: "123" }
   * });
   * ```
   */
  async queryFaultRecords (options: QueryOptions = {}): Promise<FaultRecord[]> {
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
      proofSetId: this.parseTimestamp(fault.proofSetId),
      rootIds: fault.rootIds.map((id: any) => this.parseTimestamp(id)),
      currentChallengeEpoch: this.parseTimestamp(fault.currentChallengeEpoch),
      nextChallengeEpoch: this.parseTimestamp(fault.nextChallengeEpoch),
      periodsFaulted: this.parseTimestamp(fault.periodsFaulted),
      deadline: this.parseTimestamp(fault.deadline),
      createdAt: this.parseTimestamp(fault.createdAt),
      proofSet: {
        id: fault.proofSet.id,
        setId: this.parseTimestamp(fault.proofSet.setId),
        owner: this.transformProviderData(fault.proofSet.owner)
      }
    }))
  }
}
