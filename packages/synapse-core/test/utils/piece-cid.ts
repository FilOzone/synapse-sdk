import * as Digest from '../../src/piece/internal/digest.ts'
import { PieceCID } from '../../src/piece/piece-cid.ts'

/** Build a PieceCID that reports `rawSize` without hashing any data (the root is all zeros). */
export function pieceCidWithRawSize(rawSize: number): PieceCID {
  // Smallest tree that fits: 127 raw bytes per 4 leaves, so height 2 holds 127 bytes.
  let height = 2
  let capacity = 127
  while (capacity < rawSize) {
    height++
    capacity *= 2
  }
  return PieceCID._fromDigest(
    Digest.fromFields({ padding: BigInt(capacity - rawSize), height, root: new Uint8Array(32) })
  )
}
