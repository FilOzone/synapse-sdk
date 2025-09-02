/**
 * SubgraphRetriever - Uses a SubgraphService to find and retrieve pieces.
 */

import type { PieceCID, PieceRetriever, ProviderInfo, SubgraphRetrievalService } from '../types.js'
import { createError } from '../utils/errors.js'
import { fetchPiecesFromProviders } from './utils.js'

export class SubgraphRetriever implements PieceRetriever {
  constructor(
    private readonly subgraphService: SubgraphRetrievalService,
    private readonly childRetriever?: PieceRetriever
  ) {}

  /**
   * Find providers that can serve pieces for a client
   * @param pieceCid - The piece commitment (PieceCID) to search for.
   * @param providerAddress - Optional specific provider to use
   * @returns List of approved provider info
   */
  async findProviders(pieceCid: PieceCID, providerAddress?: string): Promise<ProviderInfo[]> {
    if (providerAddress != null) {
      const provider = await this.subgraphService.getProviderByAddress(providerAddress)
      return provider !== null ? [provider] : []
    }
    return await this.subgraphService.getApprovedProvidersForPieceCID(pieceCid)
  }

  async fetchPiece(
    pieceCid: PieceCID,
    client: string,
    options?: { providerAddress?: string; signal?: AbortSignal }
  ): Promise<Response> {
    // Helper function to try child retriever or throw error
    const tryChildOrThrow = async (reason: string): Promise<Response> => {
      if (this.childRetriever !== undefined) {
        return await this.childRetriever.fetchPiece(pieceCid, client, options)
      }
      throw createError('SubgraphRetriever', 'fetchPiece', `Failed to retrieve piece ${pieceCid.toString()}: ${reason}`)
    }

    // Step 1: Find providers
    let providersToTry: ProviderInfo[] = []
    try {
      providersToTry = await this.findProviders(pieceCid, options?.providerAddress)
    } catch {
      // Provider discovery failed - this is a critical error
      return await tryChildOrThrow('Provider discovery failed and no additional retriever method was configured')
    }

    // Step 2: If no providers found, try child retriever
    if (providersToTry.length === 0) {
      return await tryChildOrThrow('No providers found and no additional retriever method was configured')
    }

    // Step 3: Try to fetch from providers
    try {
      return await fetchPiecesFromProviders(providersToTry, pieceCid, 'SubgraphRetriever', options?.signal)
    } catch {
      // All provider attempts failed
      return await tryChildOrThrow(
        'All provider retrieval attempts failed and no additional retriever method was configured'
      )
    }
  }
}
