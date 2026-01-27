/**
 * FilBeamRetriever - CDN optimization wrapper for piece retrieval
 *
 * This intercepts piece requests and attempts CDN retrieval before falling back
 * to the base retriever.
 */

import type { Chain } from '@filoz/synapse-core/chains'
import type { Address } from 'viem'
import type { PieceCID, PieceRetriever } from '../types.ts'

export class FilBeamRetriever implements PieceRetriever {
  private readonly baseRetriever: PieceRetriever
  private readonly chain: Chain

  constructor(baseRetriever: PieceRetriever, chain: Chain) {
    this.baseRetriever = baseRetriever
    this.chain = chain
  }

  hostname(): string {
    return this.chain.filbeam.retrievalDomain
  }

  async fetchPiece(
    pieceCid: PieceCID,
    client: Address,
    options?: {
      providerAddress?: Address
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
      console.log('Falling back to direct retrieval')
    }

    return await this.baseRetriever.fetchPiece(pieceCid, client, options)
  }
}
