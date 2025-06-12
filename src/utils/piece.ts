/**
 * Piece URL construction utilities
 *
 * These utilities help construct URLs for interacting with PDP servers
 * for piece discovery and retrieval operations.
 */

import type { CommP } from '../types.js'
import { toHex } from 'multiformats/bytes'
import { MULTIHASH_CODES } from './index.js'

/**
 * Construct a piece retrieval URL
 * @param retrievalEndpoint - The base retrieval endpoint URL
 * @param commp - The CommP identifier
 * @returns Full URL for retrieving the piece
 */
export function constructPieceUrl (retrievalEndpoint: string, commp: CommP): string {
  const endpoint = retrievalEndpoint.replace(/\/$/, '')
  return `${endpoint}/piece/${commp.toString()}`
}

/**
 * Construct a piece discovery (findPiece) URL
 * @param apiEndpoint - The base API endpoint URL
 * @param commp - The CommP identifier
 * @returns Full URL for finding the piece
 */
export function constructFindPieceUrl (apiEndpoint: string, commp: CommP): string {
  const endpoint = apiEndpoint.replace(/\/$/, '')
  const hashBytes = commp.multihash.digest
  const hashHex = toHex(hashBytes)

  const params = new URLSearchParams({
    name: MULTIHASH_CODES.SHA2_256_TRUNC254_PADDED,
    hash: hashHex,
    size: '0' // Size is ignored for CommP in Curio
  })

  return `${endpoint}/pdp/piece?${params.toString()}`
}
