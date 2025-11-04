import type { PieceLink } from '@web3-storage/data-segment'
import * as Hasher from '@web3-storage/data-segment/multihash'
import { Unpadded } from '@web3-storage/data-segment/piece/size'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'

/**
 * PieceCID - A constrained CID type for Piece Commitments.
 * This is implemented as a Link type which is made concrete by a CID. A
 * PieceCID uses the raw codec (0x55) and the fr32-sha256-trunc254-padbintree
 * multihash function (0x1011) which encodes the base content length (as
 * padding) of the original piece, and the height of the merkle tree used to
 * hash it.
 *
 * See https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 * for more information.
 */
export type PieceCID = PieceLink

/**
 * Extract the raw (unpadded) size from a PieceCIDv2
 *
 * PieceCIDv2 encodes the original data size in its multihash digest through
 * the tree height and padding values. This function decodes those values to
 * calculate the original raw data size.
 *
 * @param pieceCid - PieceCID
 * @returns The raw size in bytes
 * @throws {Error} If the input is not a valid PieceCIDv2
 */
export function getSize(pieceCid: PieceCID): number {
  // The multihash digest contains: [padding (varint)][height (1 byte)][root (32 bytes)]
  const digest = Hasher.Digest.fromBytes(pieceCid.multihash.bytes)
  const height = digest.height
  const padding = digest.padding

  // rawSize = paddedSize - padding
  // where paddedSize = 2^(height-2) * 127 (fr32 expansion)
  const rawSize = Unpadded.fromPiece({ height, padding })

  // This should be safe for all practical file sizes
  if (rawSize > Number.MAX_SAFE_INTEGER) {
    throw new Error(`Raw size ${rawSize} exceeds maximum safe integer`)
  }

  return Number(rawSize)
}

export function parse(pieceCid: string): PieceCID {
  try {
    const cid = CID.parse(pieceCid).toV1()
    if (!isPieceCID(cid)) {
      throw new Error('Invalid PieceCID: input must be a valid PieceCIDv2')
    }
    return cid
  } catch {
    throw new Error(`Invalid CID string: ${pieceCid}`)
  }
}

/**
 * Check if a CID is a valid PieceCID
 * @param cid - The CID to check
 * @returns True if it's a valid PieceCID
 */
export function isPieceCID(cid: Link.Link): cid is PieceCID {
  return (
    typeof cid === 'object' && CID.asCID(cid) != null && cid.code === Raw.code && cid.multihash.code === Hasher.code
  )
}

/**
 * Calculate the PieceCID (Piece Commitment) for a given data blob
 *
 * @param data - The binary data to calculate the PieceCID for
 * @returns The calculated PieceCID CID
 */
export function calculate(data: Uint8Array) {
  // TODO: consider https://github.com/storacha/fr32-sha2-256-trunc254-padded-binary-tree-multihash
  // for more efficient PieceCID calculation in WASM
  const hasher = Hasher.create()
  // We'll get slightly better performance by writing in chunks to let the
  // hasher do its work incrementally
  const chunkSize = 2048
  for (let i = 0; i < data.length; i += chunkSize) {
    hasher.write(data.subarray(i, i + chunkSize))
  }
  const digest = hasher.digest()
  return Link.create(Raw.code, digest) as PieceCID
}
