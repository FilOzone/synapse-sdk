/**
 * ChainRetriever - Queries on-chain data to find and retrieve pieces
 *
 * This retriever uses the Pandora service to find storage providers
 * that have the requested piece, then attempts to download from them.
 */

import type { PandoraService } from '../pandora/index.js'
import type { CommP, PieceRetriever, ApprovedProviderInfo } from '../types.js'
import { fetchPiecesFromProviders } from './utils.js'
import { createError } from '../utils/index.js'

export class ChainRetriever implements PieceRetriever {
  constructor (
    private readonly pandoraService: PandoraService,
    private readonly childRetriever?: PieceRetriever
  ) {}

  /**
   * Find providers that can serve pieces for a client
   * @param client - The client address
   * @param providerAddress - Optional specific provider to use
   * @returns List of approved provider info
   */
  private async findProviders (
    client: string,
    providerAddress?: string
  ): Promise<ApprovedProviderInfo[]> {
    if (providerAddress != null) {
      // Direct provider case - skip proof set lookup entirely
      const providerId = await this.pandoraService.getProviderIdByAddress(providerAddress)
      if (providerId === 0) {
        throw createError(
          'ChainRetriever',
          'findProviders',
          `Provider ${providerAddress} not found or not approved`
        )
      }
      const provider = await this.pandoraService.getApprovedProvider(providerId)
      return [provider]
    }

    // Multiple provider case - need proof sets to find providers
    // 1. Get client's proof sets with details
    const proofSets = await this.pandoraService.getClientProofSetsWithDetails(client)

    // 2. Filter for live proof sets with roots
    const validProofSets = proofSets.filter(ps =>
      ps.isLive &&
      ps.currentRootCount > 0
    )

    if (validProofSets.length === 0) {
      throw createError(
        'ChainRetriever',
        'findProviders',
        `No active proof sets with data found for client ${client}`
      )
    }

    // 3. Get unique providers and fetch info
    const uniqueProviders = [...new Set(validProofSets.map(ps => ps.payee))]
    const providerInfos = await Promise.all(
      uniqueProviders.map(async (addr) => {
        const id = await this.pandoraService.getProviderIdByAddress(addr)
        return await this.pandoraService.getApprovedProvider(id)
      })
    )

    return providerInfos
  }

  async fetchPiece (
    commp: CommP,
    client: string,
    options?: { providerAddress?: string, withCDN?: boolean, signal?: AbortSignal }
  ): Promise<Response> {
    // Helper function to try child retriever or throw error
    const tryChildOrThrow = async (reason: string): Promise<Response> => {
      if (this.childRetriever !== undefined) {
        return await this.childRetriever.fetchPiece(commp, client, options)
      }
      throw createError(
        'ChainRetriever',
        'fetchPiece',
        `Failed to retrieve piece ${commp.toString()}: ${reason}`
      )
    }

    // Step 1: Find providers
    let providersToTry: ApprovedProviderInfo[] = []
    try {
      providersToTry = await this.findProviders(client, options?.providerAddress)
    } catch (error) {
      // Provider discovery failed - this is a critical error
      return await tryChildOrThrow(
        'Provider discovery failed and no additional retriever method was configured'
      )
    }

    // Step 2: If no providers found, try child retriever
    if (providersToTry.length === 0) {
      return await tryChildOrThrow('No providers found and no additional retriever method was configured')
    }

    // Step 3: Try to fetch from providers
    try {
      return await fetchPiecesFromProviders(
        providersToTry,
        commp,
        'ChainRetriever',
        options?.signal
      )
    } catch (fetchError) {
      // All provider attempts failed
      return await tryChildOrThrow(
        'All provider retrieval attempts failed and no additional retriever method was configured'
      )
    }
  }
}
