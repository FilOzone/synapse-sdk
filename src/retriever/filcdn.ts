/**
 * FilCdnRetriever - CDN optimization wrapper for piece retrieval
 *
 * This intercepts piece requests and attempts CDN retrieval before falling back
 * to the base retriever.
 */

import type { CommP, CommPv2, FilecoinNetworkType, PieceRetriever } from '../types.js'

export class FilCdnRetriever implements PieceRetriever {
  constructor (
    private readonly baseRetriever: PieceRetriever,
    private readonly network: FilecoinNetworkType
  ) {}

  hostname (): string {
    return this.network === 'mainnet'
      ? 'filcdn.io'
      : 'calibration.filcdn.io'
  }

  async fetchPiece (
    commp: CommP | CommPv2,
    client: string,
    options?: {
      providerAddress?: string
      withCDN?: boolean
      signal?: AbortSignal
    }
  ): Promise<Response> {
    if (options?.withCDN === true) {
      const cdnUrl = `https://${client}.${this.hostname()}/${commp.toString()}`
      try {
        const cdnResponse = await fetch(cdnUrl, { signal: options?.signal })
        if (cdnResponse.ok) {
          return cdnResponse
        } else if (cdnResponse.status === 402) {
          console.warn('CDN requires payment. Please initialise Synapse SDK with the option `withCDN: true` and re-upload your files.')
        } else {
          console.warn('CDN fetch failed with status:', cdnResponse.status)
        }
      } catch (error) {
        console.warn('CDN fetch failed:', error)
      }
    }

    console.log('Falling back to direct retrieval')
    return await this.baseRetriever.fetchPiece(commp, client, options)
  }
}
