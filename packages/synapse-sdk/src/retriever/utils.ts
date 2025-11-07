/**
 * Utility to attempt fetching a piece from multiple providers in parallel.
 */

import type { PieceCID, ProviderInfo } from '../types.ts'
import { createError } from '../utils/errors.ts'
import { constructFindPieceUrl, constructPieceUrl } from '../utils/piece.ts'

// Define the type for provider attempt results (internal to this function)
interface ProviderAttemptResult {
  response: Response
  index: number
}

/**
 * Attempt to fetch a piece from multiple providers in parallel
 * @param providers - List of providers to try
 * @param pieceCid - The piece to fetch
 * @param retrieverName - Name of the calling retriever for error reporting
 * @param signal - Optional abort signal
 * @returns The first successful response
 */
export async function fetchPiecesFromProviders(
  providers: ProviderInfo[],
  pieceCid: PieceCID,
  retrieverName: string,
  signal?: AbortSignal
): Promise<Response> {
  // Track failures for error reporting
  const failures: Array<{ provider: string; error: string }> = []

  // Create individual abort controllers for each provider
  const abortControllers: AbortController[] = []

  const providerAttempts: Array<Promise<ProviderAttemptResult>> = providers.map(async (provider, index) => {
    // Create a dedicated controller for this provider
    const controller = new AbortController()
    abortControllers[index] = controller

    // If parent signal is provided, propagate abort to this controller
    if (signal != null) {
      signal.addEventListener(
        'abort',
        () => {
          controller.abort(signal.reason)
        },
        { once: true }
      )

      // If parent is already aborted, abort immediately
      if (signal.aborted) {
        controller.abort(signal.reason)
      }
    }

    try {
      // Phase 1: Check if provider has the piece
      if (!provider.products.PDP?.data.serviceURL) {
        throw new Error(`Provider ${provider.id} does not have PDP product with serviceURL`)
      }
      const findUrl = constructFindPieceUrl(provider.products.PDP.data.serviceURL, pieceCid)
      const findResponse = await fetch(findUrl, {
        signal: controller.signal,
      })

      if (!findResponse.ok) {
        // Provider doesn't have the piece
        failures.push({
          provider: provider.serviceProvider,
          error: `findPiece returned ${findResponse.status}`,
        })
        throw new Error('Provider does not have piece')
      }

      // Phase 2: Provider has piece, download it
      const downloadUrl = constructPieceUrl(provider.products.PDP.data.serviceURL, pieceCid)
      const response = await fetch(downloadUrl, {
        signal: controller.signal,
      })

      if (response.ok) {
        // Don't cancel here! Let Promise.race decide the winner
        return { response, index }
      }

      // Download failed
      failures.push({
        provider: provider.serviceProvider,
        error: `download returned ${response.status}`,
      })
      throw new Error(`Download failed with status ${response.status}`)
    } catch (error: any) {
      // Log actual failures
      const errorMsg = error.message ?? 'Unknown error'
      if (!failures.some((f) => f.provider === provider.serviceProvider)) {
        failures.push({ provider: provider.serviceProvider, error: errorMsg })
      }
      if (errorMsg !== 'This operation was aborted') {
        // TODO: remove this at some point, it might get noisy
        console.warn(`Failed to fetch from provider ${provider.serviceProvider}:`, errorMsg)
      }
      throw error
    }
  })

  try {
    // Use Promise.any to get the first successful response
    const { response, index: winnerIndex } = await Promise.any(providerAttempts)

    // Now that we have a winner, cancel all other requests
    abortControllers.forEach((ctrl, i) => {
      if (i !== winnerIndex) {
        ctrl.abort()
      }
    })

    return response
  } catch (error) {
    // Promise.any throws AggregateError when all promises reject
    if (error instanceof AggregateError) {
      // All providers failed
      const failureDetails = failures.map((f) => `${f.provider}: ${f.error}`).join('; ')
      throw createError(
        retrieverName,
        'fetchPiecesFromProviders',
        `All providers failed to serve piece ${pieceCid.toString()}. Details: ${failureDetails}`
      )
    }
    // Re-throw unexpected errors
    throw error
  }
}
