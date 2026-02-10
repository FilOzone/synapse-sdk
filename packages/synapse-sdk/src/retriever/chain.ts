/**
 * ChainRetriever - Queries on-chain data to find and retrieve pieces
 *
 * This retriever uses the Warm Storage service to find service providers
 * that have the requested piece, then attempts to download from them.
 */

import type { PDPProvider } from '@filoz/synapse-core/sp-registry'
import type { Address } from 'viem'
import type { SPRegistryService } from '../sp-registry/index.ts'
import type { PieceFetchOptions, PieceRetriever } from '../types.ts'
import { createError } from '../utils/index.ts'
import type { WarmStorageService } from '../warm-storage/index.ts'
import { fetchPiecesFromProviders } from './utils.ts'

export interface ChainRetrieverConstructorOptions {
  warmStorageService: WarmStorageService
  spRegistry: SPRegistryService
  childRetriever?: PieceRetriever
}

interface FindProvidersOptions {
  client: Address
  providerAddress?: Address
}

export class ChainRetriever implements PieceRetriever {
  private readonly warmStorageService: WarmStorageService
  private readonly childRetriever?: PieceRetriever
  private readonly spRegistry: SPRegistryService

  /**
   * @param options - Constructor options
   * @param options.warmStorageService - Warm storage service instance
   * @param options.spRegistry - Service provider registry instance
   * @param options.childRetriever - Optional fallback retriever
   */
  constructor(options: ChainRetrieverConstructorOptions) {
    this.warmStorageService = options.warmStorageService
    this.spRegistry = options.spRegistry
    this.childRetriever = options.childRetriever
  }

  /**
   * Find providers that can serve pieces for a client
   * @param options - Provider discovery options
   * @param options.client - The client address
   * @param options.providerAddress - Optional specific provider to use
   * @returns List of provider info
   */
  private async findProviders(options: FindProvidersOptions): Promise<PDPProvider[]> {
    const { client, providerAddress } = options

    if (providerAddress != null) {
      // Direct provider case - skip data set lookup entirely
      const provider = await this.spRegistry.getProviderByAddress({ address: providerAddress })
      if (provider == null) {
        throw createError('ChainRetriever', 'findProviders', `Provider ${providerAddress} not found in registry`)
      }
      return [provider]
    }

    // Multiple provider case - need data sets to find providers

    // Get client's data sets with details
    const dataSets = await this.warmStorageService.getClientDataSetsWithDetails({ address: client })

    // Filter for live data sets with pieces
    const validDataSets = dataSets.filter((ds) => ds.isLive && ds.activePieceCount > 0)

    if (validDataSets.length === 0) {
      throw createError('ChainRetriever', 'findProviders', `No active data sets with data found for client ${client}`)
    }

    // Get unique provider IDs from data sets (much more reliable than using payee addresses)
    const uniqueProviderIds = [...new Set(validDataSets.map((ds) => ds.providerId))]

    // Batch fetch provider info for all unique provider IDs
    const providerInfos = await this.spRegistry.getProviders({ providerIds: uniqueProviderIds })

    // Filter out null values (providers not found in registry)
    const validProviderInfos = providerInfos.filter((info): info is PDPProvider => info != null)

    if (validProviderInfos.length === 0) {
      throw createError(
        'ChainRetriever',
        'findProviders',
        'No valid providers found (all providers may have been removed from registry or are inactive)'
      )
    }

    return validProviderInfos
  }

  /**
   * Fetch a piece from on-chain discovered providers.
   * @param options - Piece retrieval options
   * @param options.pieceCid - The piece identifier
   * @param options.client - The client address requesting the piece
   * @param options.providerAddress - Optional provider address override
   * @param options.withCDN - Optional CDN hint passed to child retrievers
   * @param options.signal - Optional AbortSignal for request cancellation
   * @returns A response containing the piece data
   */
  async fetchPiece(options: PieceFetchOptions): Promise<Response> {
    const { pieceCid, client, providerAddress, withCDN, signal } = options

    // Helper function to try child retriever or throw error
    const tryChildOrThrow = async (reason: string, cause?: unknown): Promise<Response> => {
      if (this.childRetriever !== undefined) {
        return await this.childRetriever.fetchPiece({ pieceCid, client, providerAddress, withCDN, signal })
      }
      throw createError(
        'ChainRetriever',
        'fetchPiece',
        `Failed to retrieve piece ${pieceCid.toString()}: ${reason}`,
        cause
      )
    }

    // Find providers
    let providersToTry: PDPProvider[] = []
    try {
      providersToTry = await this.findProviders({ client, providerAddress })
    } catch (error) {
      // Provider discovery failed - this is a critical error
      const message = error instanceof Error ? error.message : 'Provider discovery failed'
      return await tryChildOrThrow(message, error)
    }

    // If no providers found, try child retriever
    if (providersToTry.length === 0) {
      return await tryChildOrThrow('No providers found and no additional retriever method was configured')
    }

    // Try to fetch from providers
    try {
      return await fetchPiecesFromProviders(providersToTry, pieceCid, 'ChainRetriever', signal)
    } catch (error) {
      // All provider attempts failed
      return await tryChildOrThrow(
        'All provider retrieval attempts failed and no additional retriever method was configured',
        error
      )
    }
  }
}
