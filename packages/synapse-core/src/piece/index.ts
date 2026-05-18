/**
 * PieceCID utilities for Filecoin Onchain Cloud.
 *
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 *
 * // Compute
 * const piece = await Piece.calculate(bytes)
 * piece.root    // 32-byte merkle root (for contract calls)
 * piece.size    // raw bytes
 * piece.height  // tree height
 *
 * // Parse / validate
 * const piece = Piece.from('bafkz...')     // throws on invalid
 * const piece = Piece.tryFrom(maybeInput)  // null on invalid
 * Piece.is(value)                          // type guard
 *
 * // Streaming
 * const { transform, result } = Piece.transformStream()
 * await source.pipeThrough(transform).pipeTo(sink)
 * const piece = await result
 *
 * // Lower-level primitives
 * Piece.fr32.expand(rawBytes)
 * Piece.merkle.computeNode(left, right)
 * ```
 *
 * Reference: FRC-0069
 * https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 *
 * Core primitives (FR32, merkle, streaming hasher, size math) are derived
 * from [`@web3-storage/data-segment`](https://github.com/web3-storage/data-segment).
 * See the package README for full attribution.
 *
 * @module piece
 */

export * from '../utils/piece-url.ts'
export type { CalculateInput, PieceCIDTransform, PieceHasher } from './calculate.ts'
export { calculate, hasher, transformStream } from './calculate.ts'
export * from './download.ts'
export * as fr32 from './fr32.ts'
export { CODEC_CODE, MULTIHASH_CODE, MULTIHASH_NAME } from './internal/constants.ts'
export * as merkle from './merkle.ts'
export type { PieceCIDInput } from './parse.ts'
export { equals, from, is, tryFrom } from './parse.ts'
export { PieceCID } from './piece-cid.ts'
export * from './resolve-piece-url.ts'
export {
  BYTES_PER_QUAD,
  heightFor,
  MAX_HEIGHT,
  MAX_SIZE,
  MIN_SIZE,
  paddedSizeAtHeight,
  paddedSizeFor,
} from './sizing.ts'
