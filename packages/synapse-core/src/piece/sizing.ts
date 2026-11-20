/**
 * Sizing helpers that do not require hashing the data.
 *
 * Useful for cost estimation, padding calculations, and planning uploads
 * before the data has been read.
 */

import { MAX_PAYLOAD_SIZE } from '@hugomrdias/commp-wasm'
import { IN_BYTES_PER_QUAD, MIN_PAYLOAD_SIZE } from './internal/constants.ts'
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
 * Maximum payload size `calculate` accepts: 127 × 2^47 bytes (~15.9 PiB).
 *
 * The 1-byte height field allows larger trees, but past this size the
 * padding and piece size no longer fit exactly in a JS number. Matches the
 * limit enforced by the hasher.
 */
export const MAX_SIZE: bigint = MAX_PAYLOAD_SIZE

/** Tree height of a {@link MAX_SIZE} payload (49). */
export const MAX_HEIGHT: number = unpaddedToHeight(MAX_PAYLOAD_SIZE)

/** Source bytes per FR32 quad (127). */
export const BYTES_PER_QUAD: number = IN_BYTES_PER_QUAD
