/**
 * Size math for PieceCID trees.
 *
 * Three coordinate systems, all interconvertible:
 * - Unpadded: raw payload bytes (what the user has)
 * - Padded:   bytes after FR32 expansion would fit into the tree
 * - Expanded: tree node bytes (32 × leaf count)
 */

import { EXPANDED_BYTES_PER_NODE, PADDED_BYTES_PER_QUAD } from './constants.ts'

// === Unpadded ===

/**
 * Size of original payload from a piece's height and padding fields.
 */
export function unpaddedFromPiece(height: number, padding: bigint): bigint {
  return paddedFromHeight(height) - padding
}

// === Padded ===

/**
 * Padded size from tree height.
 */
function paddedFromHeight(height: number): bigint {
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
