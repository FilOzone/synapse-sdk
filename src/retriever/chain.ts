/**
 * ChainRetriever - Queries on-chain data to find and retrieve pieces
 *
 * This retriever uses the Warm Storage service to find service providers
 * that have the requested piece, then attempts to download from them.
 */

import type { SPRegistryService } from '../sp-registry/index.js'
import type { PieceCID, PieceRetriever, ProviderInfo } from '../types.js'
import { createError } from '../utils/index.js'
import { ProviderResolver } from '../utils/provider-resolver.js'
import type { WarmStorageService } from '../warm-storage/index.js'
import { fetchPiecesFromProviders } from './utils.js'

export class ChainRetriever implements PieceRetriever {
  constructor(
    private readonly warmStorageService: WarmStorageService,
    private readonly spRegistry: SPRegistryService,
    private readonly childRetriever?: PieceRetriever
  ) {}

  /**
   * Find providers that can serve pieces for a client
   * @param client - The client address
   * @param providerAddress - Optional specific provider to use
   * @returns List of approved provider info
   */
  private async findProviders(client: string, providerAddress?: string): Promise<ProviderInfo[]> {
    // Create ProviderResolver using injected SPRegistryService
    const resolver = new ProviderResolver(this.warmStorageService, this.spRegistry)

    if (providerAddress != null) {
      // Direct provider case - skip data set lookup entirely
      const provider = await resolver.getApprovedProviderByAddress(providerAddress)
      if (provider == null) {
        throw createError('ChainRetriever', 'findProviders', `Provider ${providerAddress} not found or not approved`)
      }
      return [provider]
    }

    // Multiple provider case - need data sets to find providers
    // 1. Get client's data sets with details
    const dataSets = await this.warmStorageService.getClientDataSetsWithDetails(client)

    // 2. Filter for live data sets with pieces
    const validDataSets = dataSets.filter((ds) => ds.isLive && ds.currentPieceCount > 0)

    if (validDataSets.length === 0) {
      throw createError('ChainRetriever', 'findProviders', `No active data sets with data found for client ${client}`)
    }

    // 3. Get unique provider IDs from data sets (much more reliable than using payee addresses)
    const uniqueProviderIds = [...new Set(validDataSets.map((ds) => ds.providerId))]

    // 4. Batch fetch provider info for all unique provider IDs efficiently
    const providerInfos = await resolver.getApprovedProvidersByIds(uniqueProviderIds)

    // Filter out null values (unapproved/inactive providers)
    const validProviderInfos = providerInfos.filter((info): info is ProviderInfo => info != null)

    if (validProviderInfos.length === 0) {
      throw createError(
        'ChainRetriever',
        'findProviders',
        'No valid providers found (all providers may have been removed or are inactive)'
      )
    }

    return validProviderInfos
  }

  async fetchPiece(
    pieceCid: PieceCID,
    client: string,
    options?: {
      providerAddress?: string
      withCDN?: boolean
      signal?: AbortSignal
    }
  ): Promise<Response> {
    // Helper function to try child retriever or throw error
    const tryChildOrThrow = async (reason: string): Promise<Response> => {
      if (this.childRetriever !== undefined) {
        return await this.childRetriever.fetchPiece(pieceCid, client, options)
      }
      throw createError('ChainRetriever', 'fetchPiece', `Failed to retrieve piece ${pieceCid.toString()}: ${reason}`)
    }

    // Step 1: Find providers
    let providersToTry: ProviderInfo[] = []
    try {
      providersToTry = await this.findProviders(client, options?.providerAddress)
    } catch (error) {
      // Provider discovery failed - this is a critical error
      const message = error instanceof Error ? error.message : 'Provider discovery failed'
      return await tryChildOrThrow(message)
    }

    // Step 2: If no providers found, try child retriever
    if (providersToTry.length === 0) {
      return await tryChildOrThrow('No providers found and no additional retriever method was configured')
    }

    // Step 3: Try to fetch from providers
    try {
      return await fetchPiecesFromProviders(providersToTry, pieceCid, 'ChainRetriever', options?.signal)
    } catch {
      // All provider attempts failed
      return await tryChildOrThrow(
        'All provider retrieval attempts failed and no additional retriever method was configured'
      )
    }
  }
}
