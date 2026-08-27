import { ValidationError } from '../errors/base.ts'
import { SIZE_CONSTANTS } from './constants.ts'

/**
 * Convert a PDP data-bearing leaf count to the byte size used by FWSS pricing.
 *
 * This mirrors PDP's `Cids.leafCountToRawSize()`. It is an aggregate
 * approximation: because PDP records only data-bearing leaves, the result can
 * exceed the exact raw payload size by up to 31 bytes per piece. FWSS applies
 * this conversion once to the total data-set leaf count before calculating the
 * storage rate.
 *
 * @param leafCount - Number of 32-byte leaves reported by PDP Verifier
 * @returns Aggregate byte size used by FWSS storage pricing
 */
export function leafCountToRawSize(leafCount: bigint): bigint {
  return (leafCount * SIZE_CONSTANTS.BYTES_PER_LEAF * 127n) / 128n
}

/**
 * Calculate the PDP data-bearing leaf count for a known raw piece size.
 *
 * PieceCID construction expands 127 raw bytes into four 32-byte leaves. PDP
 * excludes leaves that contain only zero padding, so a partially occupied leaf
 * is counted in full. The result depends only on the raw size, not the piece
 * contents.
 *
 * @param rawSize - Exact raw payload size for one piece, in bytes
 * @returns Number of data-bearing 32-byte leaves PDP records for the piece
 */
export function rawSizeToLeafCount(rawSize: bigint): bigint {
  return (rawSize * 4n + 126n) / 127n
}

/**
 * Validate known raw piece sizes.
 *
 * @param pieceSizes - Raw payload size of every piece, in bytes
 * @throws {@link ValidationError} when the list is empty or contains a non-positive size
 */
export function validatePieceSizes(pieceSizes: readonly bigint[]): void {
  if (pieceSizes.length === 0) {
    throw new ValidationError('pieceSizes must contain at least one piece')
  }
  for (const size of pieceSizes) {
    if (size <= 0n) {
      throw new ValidationError('pieceSizes must contain only positive byte sizes')
    }
  }
}

/**
 * Sum the PDP data-bearing leaves produced by known raw piece sizes.
 *
 * Leaf rounding is applied independently to each piece, matching PDPVerifier.
 *
 * @param pieceSizes - Raw payload size of every piece, in bytes
 * @returns Aggregate data-bearing leaf count added by the pieces
 * @throws {@link ValidationError} when the piece sizes are invalid
 */
export function pieceSizesToLeafCount(pieceSizes: readonly bigint[]): bigint {
  validatePieceSizes(pieceSizes)
  return pieceSizes.reduce((total, size) => total + rawSizeToLeafCount(size), 0n)
}
