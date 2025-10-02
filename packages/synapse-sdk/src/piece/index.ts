/**
 * Exports the PieceCID types and utility functions
 *
 * @packageDocumentation
 * @module Piece
 * @example
 * ```ts
 * import { asPieceCID } from '@filoz/synapse-sdk/piece'
 * ```
 */

export {
  downloadAndValidate,
  downloadAndValidateFromUrl,
} from './download.ts'
export {
  asLegacyPieceCID,
  asPieceCID,
  calculate,
  createPieceCIDStream,
  type LegacyPieceCID,
  type PieceCID,
} from './piece.ts'
