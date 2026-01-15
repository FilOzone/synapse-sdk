/**
 * Piece utilities
 *
 * Provides URL construction utilities for PDP servers and a unified
 * PieceCID calculation function that handles both Uint8Array and
 * AsyncIterable inputs.
 */

import { calculateFromIterable, calculate as calculateSync, type PieceCID } from '@filoz/synapse-core/piece'

/**
 * Construct a piece retrieval URL
 * @param retrievalEndpoint - The base retrieval endpoint URL
 * @param pieceCid - The PieceCID identifier
 * @returns Full URL for retrieving the piece
 */
export function constructPieceUrl(retrievalEndpoint: string, pieceCid: PieceCID): string {
  const endpoint = retrievalEndpoint.replace(/\/$/, '')
  return `${endpoint}/piece/${pieceCid.toString()}`
}

/**
 * Construct a piece discovery (findPiece) URL
 * @param apiEndpoint - The base API endpoint URL
 * @param pieceCid - The PieceCID identifier
 * @returns Full URL for finding the piece
 */
export function constructFindPieceUrl(apiEndpoint: string, pieceCid: PieceCID): string {
  const endpoint = apiEndpoint.replace(/\/$/, '')
  const params = new URLSearchParams({ pieceCid: pieceCid.toString() })
  return `${endpoint}/pdp/piece?${params.toString()}`
}

/**
 * Calculate the PieceCID for the given Piece payload.
 *
 * - For small data that fits in memory, pass a `Uint8Array`.
 * - For large data or streaming scenarios, pass an `AsyncIterable<Uint8Array>`.
 *
 * @returns Promise resolving to the calculated PieceCID
 *
 * @example
 * ```typescript
 * import { calculatePieceCID } from '@filoz/synapse-sdk'
 *
 * // From Uint8Array
 * const data = new Uint8Array([1, 2, 3, 4])
 * const pieceCid = await calculatePieceCID(data)
 *
 * // From async generator
 * async function* generateChunks() {
 *   yield new Uint8Array([1, 2])
 *   yield new Uint8Array([3, 4])
 * }
 * const pieceCid = await calculatePieceCID(generateChunks())
 * ```
 */
export async function calculatePieceCID(data: Uint8Array | AsyncIterable<Uint8Array>): Promise<PieceCID> {
  // Check for Uint8Array first (before async iterable, since Uint8Array has Symbol.iterator)
  if (data instanceof Uint8Array) {
    return calculateSync(data)
  }

  if (isAsyncIterable<Uint8Array>(data)) {
    return calculateFromIterable(data)
  }

  throw new Error(
    `calculatePieceCID: Invalid input type. Expected Uint8Array or AsyncIterable<Uint8Array>, got ${getTypeName(data)}`
  )
}

/**
 * Type guard to check if a value implements the AsyncIterable protocol
 */
function isAsyncIterable<T>(data: unknown): data is AsyncIterable<T> {
  return (
    data != null &&
    typeof data === 'object' &&
    Symbol.asyncIterator in data &&
    typeof (data as AsyncIterable<T>)[Symbol.asyncIterator] === 'function'
  )
}

/**
 * Get a descriptive type name for error messages
 */
function getTypeName(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'

  const type = typeof value
  if (type !== 'object') return type

  // At this point we know it's a non-null object without Symbol.asyncIterator
  return 'object (missing Symbol.asyncIterator)'
}
