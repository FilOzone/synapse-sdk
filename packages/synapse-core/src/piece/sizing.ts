/**
 * Sizing helpers that do not require hashing the data.
 *
 * Useful for cost estimation, padding calculations, and planning uploads
 * before the data has been read.
 */

import { IN_BYTES_PER_QUAD, MAX_HEIGHT as INTERNAL_MAX_HEIGHT, MIN_PAYLOAD_SIZE } from './internal/constants.ts'
import { MAX_PAYLOAD_SIZE as INTERNAL_MAX_PAYLOAD_SIZE } from './internal/digest.ts'
import { expandedFromHeight, unpaddedToHeight } from './internal/size.ts'

/**
 * Padded piece size in bytes that a raw payload of `rawSize` will produce.
 *
 * Returns the canonical Filecoin padded size (`2^height × 32`), always a power
 * of 2 × 32.
 */
export function paddedSizeFor(rawSize: number | bigint): bigint {
  return expandedFromHeight(unpaddedToHeight(BigInt(rawSize)))
}

/**
 * Tree height that a raw payload of `rawSize` will produce.
 */
export function heightFor(rawSize: number | bigint): number {
  return unpaddedToHeight(BigInt(rawSize))
}

/**
 * Padded piece size in bytes for a given tree height.
 */
export function paddedSizeAtHeight(height: number): bigint {
  return expandedFromHeight(height)
}

/**
 * Minimum payload size for which PieceCID is defined (smaller inputs are
 * zero-padded up to this floor).
 */
export const MIN_SIZE: number = MIN_PAYLOAD_SIZE

/**
 * Maximum payload size that a single PieceCID can represent (limited by the
 * 1-byte tree height field).
 */
export const MAX_SIZE: bigint = INTERNAL_MAX_PAYLOAD_SIZE

/** Maximum tree height (255). */
export const MAX_HEIGHT: number = INTERNAL_MAX_HEIGHT

/** Source bytes per FR32 quad (127). */
export const BYTES_PER_QUAD: number = IN_BYTES_PER_QUAD
