/**
 * Size math for PieceCID trees.
 *
 * Three coordinate systems, all interconvertible:
 * - Unpadded: raw payload bytes (what the user has)
 * - Padded:   bytes after FR32 expansion would fit into the tree
 * - Expanded: tree node bytes (32 × leaf count)
 */

import { EXPANDED_BYTES_PER_NODE, EXPANDED_BYTES_PER_QUAD, LEAFS_PER_QUAD, PADDED_BYTES_PER_QUAD } from './constants.ts'
import { log2Ceil } from './uint64.ts'

// === Unpadded ===

/**
 * Size of original payload from a piece's height and padding fields.
 */
export function unpaddedFromPiece(height: number, padding: bigint): bigint {
  return paddedFromHeight(height) - padding
}

/**
 * Padding bytes required to round a payload up to the next valid padded size.
 */
export function unpaddedToPadding(size: bigint): bigint {
  return unpaddedToPadded(size) - size
}

/**
 * Padded size that a raw payload will round up to.
 */
export function unpaddedToPadded(size: bigint): bigint {
  return unpaddedToQuads(size) * PADDED_BYTES_PER_QUAD
}

/**
 * Expanded (tree) size that a raw payload will round up to.
 */
export function unpaddedToExpanded(size: bigint): bigint {
  return unpaddedToQuads(size) * EXPANDED_BYTES_PER_QUAD
}

/**
 * Tree height that will be required to represent a raw payload.
 */
export function unpaddedToHeight(size: bigint): number {
  return log2Ceil(unpaddedToQuads(size) * LEAFS_PER_QUAD)
}

function unpaddedToQuads(size: bigint): bigint {
  // Round up to nearest quad.
  const quadCount = (size + PADDED_BYTES_PER_QUAD - 1n) / PADDED_BYTES_PER_QUAD
  // Next power of 2.
  return 2n ** BigInt(log2Ceil(quadCount))
}

// === Padded ===

/**
 * Padded size from tree height.
 */
export function paddedFromHeight(height: number): bigint {
  // Second-layer node count = quad count (each quad → 4 leaves → 1 second-layer node).
  const quads = 2n ** BigInt(height - 2)
  return quads * PADDED_BYTES_PER_QUAD
}

// === Expanded ===

/**
 * Expanded (tree) size from height.
 */
export function expandedFromHeight(height: number): bigint {
  return 2n ** BigInt(height) * EXPANDED_BYTES_PER_NODE
}
