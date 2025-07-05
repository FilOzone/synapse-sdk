/**
 * SubgraphRetriever - Uses a SubgraphService to find and retrieve pieces.
 */

import type {
  CommP,
  PieceRetriever,
  ApprovedProviderInfo,
  SubgraphRetrievalService
} from '../types.js'
import { fetchPiecesFromProviders } from './utils.js'
import { createError } from '../utils/errors.js'

export class SubgraphRetriever implements PieceRetriever {
  constructor (
    private readonly subgraphService: SubgraphRetrievalService,
    private readonly childRetriever?: PieceRetriever
  ) {}

  /**
   * Find providers that can serve pieces for a client
   * @param commp - The piece commitment (CommP) to search for.
   * @param providerAddress - Optional specific provider to use
   * @returns List of approved provider info
   */
  async findProviders (commp: CommP, providerAddress?: string): Promise<ApprovedProviderInfo[]> {
    if (providerAddress != null) {
      const provider = await this.subgraphService.getProviderByAddress(providerAddress)
      return provider !== null ? [provider] : []
    }
    return await this.subgraphService.getApprovedProvidersForCommP(commp)
  }

  async fetchPiece (
    commp: CommP,
    client: string,
    options?: { providerAddress?: string, signal?: AbortSignal }
  ): Promise<Response> {
    // Helper function to try child retriever or throw error
    const tryChildOrThrow = async (reason: string): Promise<Response> => {
      if (this.childRetriever !== undefined) {
        return await this.childRetriever.fetchPiece(commp, client, options)
      }
      throw createError(
        'SubgraphRetriever',
        'fetchPiece',
        `Failed to retrieve piece ${commp.toString()}: ${reason}`
      )
    }

    // Step 1: Find providers
    let providersToTry: ApprovedProviderInfo[] = []
    try {
      providersToTry = await this.findProviders(commp, options?.providerAddress)
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
        'SubgraphRetriever',
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
