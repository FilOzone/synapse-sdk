/**
 * FilCdnRetriever - CDN optimization wrapper for piece retrieval
 *
 * This intercepts piece requests and attempts CDN retrieval before falling back
 * to the base retriever.
 */

import type { FilecoinNetworkType, PieceCID, PieceRetriever } from '../types.ts'

export class FilCdnRetriever implements PieceRetriever {
  private readonly baseRetriever: PieceRetriever
  private readonly network: FilecoinNetworkType

  constructor(baseRetriever: PieceRetriever, network: FilecoinNetworkType) {
    this.baseRetriever = baseRetriever
    this.network = network
  }

  hostname(): string {
    return this.network === 'mainnet' ? 'filcdn.io' : 'calibration.filcdn.io'
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
    if (options?.withCDN === true) {
      const cdnUrl = `https://${client}.${this.hostname()}/${pieceCid.toString()}`
      try {
        const cdnResponse = await fetch(cdnUrl, { signal: options?.signal })
        if (cdnResponse.ok) {
          return cdnResponse
        } else if (cdnResponse.status === 402) {
          console.warn(
            'CDN requires payment. Please initialise Synapse SDK with the option `withCDN: true` and re-upload your files.'
          )
        } else {
          console.warn('CDN fetch failed with status:', cdnResponse.status)
        }
      } catch (error) {
        console.warn('CDN fetch failed:', error)
      }
    }

    console.log('Falling back to direct retrieval')
    return await this.baseRetriever.fetchPiece(pieceCid, client, options)
  }
}
