/**
 * ChainRetriever - Queries on-chain data to find and retrieve pieces
 *
 * This retriever uses the Pandora service to find storage providers
 * that have the requested piece, then attempts to download from them.
 */

import type { PandoraService } from '../pandora/index.js'
import type { CommP, PieceRetriever, ApprovedProviderInfo } from '../types.js'
import { constructPieceUrl, constructFindPieceUrl, createError } from '../utils/index.js'

export class ChainRetriever implements PieceRetriever {
  constructor (
    private readonly pandoraService: PandoraService
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

  /**
   * Attempt to fetch a piece from multiple providers in parallel
   * @param providers - List of providers to try
   * @param commp - The piece to fetch
   * @param signal - Optional abort signal
   * @returns The first successful response
   */
  private async fetchFromProviders (
    providers: ApprovedProviderInfo[],
    commp: CommP,
    signal?: AbortSignal
  ): Promise<Response> {
    // Track failures for error reporting
    const failures: Array<{ provider: string, error: string }> = []

    // Create individual abort controllers for each provider
    const abortControllers: AbortController[] = []

    const providerAttempts = providers.map(async (provider, index) => {
      // Create a dedicated controller for this provider
      const controller = new AbortController()
      abortControllers[index] = controller

      // If parent signal is provided, propagate abort to this controller
      if (signal != null) {
        signal.addEventListener('abort', () => {
          controller.abort(signal.reason)
        }, { once: true })

        // If parent is already aborted, abort immediately
        if (signal.aborted) {
          controller.abort(signal.reason)
        }
      }

      try {
        // Phase 1: Check if provider has the piece
        const findUrl = constructFindPieceUrl(provider.pdpUrl, commp)
        const findResponse = await fetch(findUrl, { signal: controller.signal })

        if (!findResponse.ok) {
          // Provider doesn't have the piece
          failures.push({ provider: provider.owner, error: `findPiece returned ${findResponse.status}` })
          throw new Error('Provider does not have piece')
        }

        // Phase 2: Provider has piece, download it
        const downloadUrl = constructPieceUrl(provider.pieceRetrievalUrl, commp)
        const response = await fetch(downloadUrl, { signal: controller.signal })

        if (response.ok) {
          // Don't cancel here! Let Promise.race decide the winner
          return { response, index }
        }

        // Download failed
        failures.push({ provider: provider.owner, error: `download returned ${response.status}` })
        throw new Error(`Download failed with status ${response.status}`)
      } catch (error: any) {
        // Log actual failures
        const errorMsg = error.message ?? 'Unknown error'
        if (!failures.some(f => f.provider === provider.owner)) {
          failures.push({ provider: provider.owner, error: errorMsg })
        }
        // TODO: remove this at some point, it might get noisy
        console.warn(`Failed to fetch from provider ${provider.owner}:`, errorMsg)
        throw error
      }
    })

    try {
      // Race all provider attempts - first successful response wins
      const { response, index: winnerIndex } = await Promise.race(providerAttempts)

      // Now that we have a winner, cancel all other requests
      abortControllers.forEach((ctrl, i) => {
        if (i !== winnerIndex) {
          ctrl.abort()
        }
      })

      return response
    } catch (error) {
      // All providers failed
      const failureDetails = failures.map(f => `${f.provider}: ${f.error}`).join('; ')
      throw createError(
        'ChainRetriever',
        'fetchFromProviders',
        `All providers failed to serve piece ${commp.toString()}. Details: ${failureDetails}`
      )
    }
  }

  async fetchPiece (
    commp: CommP,
    client: string,
    options?: {
      providerAddress?: string
      withCDN?: boolean
      signal?: AbortSignal
    }
  ): Promise<Response> {
    // Find providers that can serve this client
    const providerInfos = await this.findProviders(client, options?.providerAddress)

    // Attempt to fetch from the providers
    return await this.fetchFromProviders(providerInfos, commp, options?.signal)
  }
}
