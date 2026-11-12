import { FindPieceError } from '../errors/pdp.ts'
import { findPiece } from './find-piece.ts'

export namespace hasPiece {
  export type OptionsType = Pick<findPiece.OptionsType, 'serviceURL' | 'pieceCid' | 'signal' | 'timeout'>
  export type OutputType = boolean
  export type ErrorType = findPiece.ErrorType
}

/**
 * Check whether a provider has a piece.
 *
 * GET /pdp/piece?pieceCid={pieceCid}
 *
 * A single {@link findPiece} lookup, without polling, that returns `false` instead of throwing when
 * the provider answers that it does not have the piece (404) or is still processing it (202).
 * Other failures, such as a 5xx response or a timeout, still throw, as does an abort.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * import * as Piece from '@filoz/synapse-core/piece'
 *
 * const found = await SP.hasPiece({
 *   serviceURL: 'https://pdp.example.com',
 *   pieceCid: Piece.from('bafkzcib...'),
 * })
 * ```
 *
 * @param options - {@link hasPiece.OptionsType}
 * @returns Whether the provider has the piece {@link hasPiece.OutputType}
 * @throws Errors {@link hasPiece.ErrorType}
 */
export async function hasPiece(options: hasPiece.OptionsType): Promise<hasPiece.OutputType> {
  try {
    await findPiece({ ...options, poll: false })
    return true
  } catch (error) {
    if (FindPieceError.is(error) && error.notFound) {
      return false
    }
    throw error
  }
}
