/**
 * FilBeamRetriever - CDN optimization wrapper for piece retrieval
 *
 * This intercepts piece requests and attempts CDN retrieval before falling back
 * to the base retriever.
 */

import { asChain, type Chain } from '@filoz/synapse-core/chains'
import type { PieceFetchOptions, PieceRetriever } from '../types.ts'

export interface FilBeamRetrieverConstructorOptions {
  baseRetriever: PieceRetriever
  chain: Chain
}

export class FilBeamRetriever implements PieceRetriever {
  private readonly baseRetriever: PieceRetriever
  private readonly chain: Chain

  /**
   * @param options - Constructor options
   * @param options.baseRetriever - Base retriever used as fallback
   * @param options.chain - Chain configuration for CDN resolution
   */
  constructor(options: FilBeamRetrieverConstructorOptions) {
    this.baseRetriever = options.baseRetriever
    this.chain = asChain(options.chain)
  }

  async fetchPiece(options: PieceFetchOptions): Promise<Response> {
    const { pieceCid, client, withCDN, signal } = options

    if (withCDN === true && this.chain.filbeam != null) {
      const cdnUrl = `https://${client}.${this.chain.filbeam.retrievalDomain}/${pieceCid.toString()}`
      try {
        const cdnResponse = await fetch(cdnUrl, { signal })
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

    return await this.baseRetriever.fetchPiece(options)
  }
}
