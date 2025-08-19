/**
 * Piece URL construction utilities
 *
 * These utilities help construct URLs for interacting with PDP servers
 * for piece discovery and retrieval operations.
 */

import type { PieceCID } from '../types.js'

/**
 * Construct a piece retrieval URL
 * @param retrievalEndpoint - The base retrieval endpoint URL
 * @param pieceCid - The PieceCID identifier
 * @returns Full URL for retrieving the piece
 */
export function constructPieceUrl (retrievalEndpoint: string, pieceCid: PieceCID): string {
  const endpoint = retrievalEndpoint.replace(/\/$/, '')
  return `${endpoint}/piece/${pieceCid.toString()}`
}

/**
 * Construct a piece discovery (findPiece) URL
 * @param apiEndpoint - The base API endpoint URL
 * @param pieceCid - The PieceCID identifier
 * @returns Full URL for finding the piece
 */
export function constructFindPieceUrl (apiEndpoint: string, pieceCid: PieceCID): string {
  const endpoint = apiEndpoint.replace(/\/$/, '')
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })
  return `${endpoint}/pdp/piece?${params.toString()}`
}
