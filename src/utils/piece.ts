/**
 * Piece URL construction utilities
 *
 * These utilities help construct URLs for interacting with PDP servers
 * for piece discovery and retrieval operations.
 */

import type { PieceLink } from '../types.js'
import { toHex } from 'multiformats/bytes'

export const PIECE_LINK_MULTIHASH_NAME = 'fr32-sha256-trunc254-padbintree'

/**
 * Construct a piece retrieval URL
 * @param retrievalEndpoint - The base retrieval endpoint URL
 * @param pieceLink - The PieceLink identifier
 * @returns Full URL for retrieving the piece
 */
export function constructPieceUrl (retrievalEndpoint: string, pieceLink: PieceLink): string {
  const endpoint = retrievalEndpoint.replace(/\/$/, '')
  return `${endpoint}/piece/${pieceLink.toString()}`
}

/**
 * Construct a piece discovery (findPiece) URL
 * @param apiEndpoint - The base API endpoint URL
 * @param pieceLink - The PieceLink identifier
 * @param size - Optional size parameter (defaults to 0, as size is typically ignored for PieceLink in Curio)
 * @returns Full URL for finding the piece
 */
export function constructFindPieceUrl (apiEndpoint: string, pieceLink: PieceLink, size = 0): string {
  const endpoint = apiEndpoint.replace(/\/$/, '')
  const hashBytes = pieceLink.multihash.digest
  const hashHex = toHex(hashBytes)

  const params = new URLSearchParams({
    name: PIECE_LINK_MULTIHASH_NAME,
    hash: hashHex,
    size: size.toString()
  })

  return `${endpoint}/pdp/piece?${params.toString()}`
}
