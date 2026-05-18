/**
 * FR32 expansion primitives (`Piece.fr32` namespace).
 *
 * FR32 inserts 2 zero bits per 254 source bits to fit BLS12-381 field element
 * boundaries: 127 source bytes expand to 128 output bytes. Distinct from
 * zero-padding, which fills a payload up to a pow2-aligned size.
 *
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 * const expanded = Piece.fr32.expand(rawBytes)
 * const raw = Piece.fr32.reduce(expanded)
 * ```
 */

export { expand, reduce } from './internal/fr32.ts'
