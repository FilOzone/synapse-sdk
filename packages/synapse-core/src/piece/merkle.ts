/**
 * Merkle tree primitives (`Piece.merkle` namespace).
 *
 * Building blocks for verifying PDP proofs, walking merkle paths, and
 * synthesizing zero-padded subtrees.
 *
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 * const parent = Piece.merkle.computeNode(left, right)
 * const zeroAtLevel5 = Piece.merkle.zeroRoot(5)
 * ```
 */

export { computeNode, truncate } from './internal/merkle.ts'
export { fromLevel as zeroRoot } from './internal/zero-comm.ts'
