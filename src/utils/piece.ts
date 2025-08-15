/**
 * Piece URL construction utilities
 *
 * These utilities help construct URLs for interacting with PDP servers
 * for piece discovery and retrieval operations.
 */

import type { PieceCID } from '../types.js'
import { toHex } from 'multiformats/bytes'

export const PIECE_LINK_MULTIHASH_NAME = 'fr32-sha256-trunc254-padbintree'

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
 * @param size - Optional size parameter (defaults to 0, as size is typically ignored for PieceCID in Curio)
 * @returns Full URL for finding the piece
 */
export function constructFindPieceUrl (apiEndpoint: string, pieceCid: PieceCID, size = 0): string {
  const endpoint = apiEndpoint.replace(/\/$/, '')
  const hashBytes = pieceCid.multihash.digest
  const hashHex = toHex(hashBytes)

  const params = new URLSearchParams({
    name: PIECE_LINK_MULTIHASH_NAME,
    hash: hashHex,
    size: size.toString()
  })

  return `${endpoint}/pdp/piece?${params.toString()}`
}
