/**
 * FilCdnRetriever - CDN optimization wrapper for piece retrieval
 *
 * This is a stub implementation that wraps a base retriever to demonstrate
 * CDN optimization patterns. When CDN services become available, this will
 * intercept piece requests and attempt CDN retrieval before falling back
 * to the base retriever.
 */

import type { CommP, FilecoinNetworkType, PieceRetriever } from '../types.js'

export class FilCdnRetriever implements PieceRetriever {
  constructor (
    private readonly baseRetriever: PieceRetriever,
    private readonly network: FilecoinNetworkType
  ) {}

  async fetchPiece (
    commp: CommP,
    client: string,
    options?: {
      providerAddress?: string
      withCDN?: boolean
      signal?: AbortSignal
    }
  ): Promise<Response> {
    // STUB IMPLEMENTATION - Pass through to base retriever
    // TODO: When CDN service is available:
    // 1. Check if options.withCDN is true
    // 2. Construct CDN URL: https://${this._network}.filcdn.io/${commp.toString()}
    // 3. Add auth headers if needed (e.g., client signature)
    // 4. Attempt CDN fetch first
    // 5. On 402 Payment Required: fall back to baseRetriever
    // 6. On other errors: optionally fall back or propagate
    //
    // Example future implementation:
    // if (options?.withCDN) {
    //   const cdnUrl = `https://${this.network}.filcdn.io/${commp.toString()}`
    //   try {
    //     const cdnResponse = await fetch(cdnUrl, { signal: options.signal })
    //     if (cdnResponse.ok) return cdnResponse
    //     if (cdnResponse.status === 402) {
    //       // Payment required - fall back to chain retrieval
    //       console.log('CDN requires payment, falling back to direct retrieval')
    //     }
    //   } catch (error) {
    //     console.warn('CDN fetch failed:', error)
    //   }
    // }

    return await this.baseRetriever.fetchPiece(commp, client, options)
  }
}
