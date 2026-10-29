import type { PieceCID } from '../piece/piece-cid.ts'

/**
 * An input removed by {@link dedupePieces} because an earlier input has the same PieceCID.
 */
export type DroppedPiece = {
  /** Index of the removed input in the original array. */
  index: number
  /** Index of the earlier input with the same PieceCID, which was kept. */
  duplicateOf: number
  /** The duplicated PieceCID. */
  pieceCid: PieceCID
}

export namespace dedupePieces {
  export type ReturnType<T> = {
    /** The first input for each PieceCID, in input order. */
    pieces: T[]
    /** Inputs removed because an earlier input had the same PieceCID. */
    dropped: DroppedPiece[]
  }
}

/**
 * Remove inputs whose PieceCID already appeared earlier in the array.
 *
 * The first input for each PieceCID wins, including its metadata and source URL.
 *
 * @param pieces - Inputs to dedupe.
 * @returns The kept inputs and the removed ones. {@link dedupePieces.ReturnType}
 */
export function dedupePieces<T extends { pieceCid: PieceCID }>(pieces: T[]): dedupePieces.ReturnType<T> {
  const firstIndex = new Map<string, number>()
  const kept: T[] = []
  const dropped: DroppedPiece[] = []
  for (const [index, piece] of pieces.entries()) {
    const key = piece.pieceCid.toString()
    const first = firstIndex.get(key)
    if (first === undefined) {
      firstIndex.set(key, index)
      kept.push(piece)
    } else {
      dropped.push({ index, duplicateOf: first, pieceCid: piece.pieceCid })
    }
  }
  return { pieces: kept, dropped }
}
