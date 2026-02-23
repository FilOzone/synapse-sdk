/**
 * PieceCID (Piece Commitment CID) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 *
 * @example
 * ```ts
 * import * as Piece from '@filoz/synapse-core/piece'
 * ```
 *
 * @module piece
 */

import type { PieceLink as PieceCIDType } from '@web3-storage/data-segment'
import * as Hasher from '@web3-storage/data-segment/multihash'
import { Unpadded } from '@web3-storage/data-segment/piece/size'
import { CID } from 'multiformats/cid'
import * as Raw from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'
import { type Hex, hexToBytes } from 'viem'

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
export type PieceCID = PieceCIDType

/**
 * Convert a PieceCID input (string or CID) to a validated CID
 * This is the main function to use when accepting PieceCID inputs
 * @param pieceCidInput - PieceCID as either a CID object or string
 * @returns The validated PieceCID CID or null if not a valid PieceCID
 */
export function asPieceCID(pieceCidInput: PieceCID | CID | string | null | undefined): PieceCID | null {
  if (pieceCidInput === null || pieceCidInput === undefined) {
    return null
  }

  if (typeof pieceCidInput === 'string') {
    try {
      return parse(pieceCidInput)
    } catch {
      return null
    }
  }

  if (isPieceCID(pieceCidInput)) {
    return pieceCidInput
  }

  return null
}

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

/**
 * Extract the raw (unpadded) size from a PieceCIDv2
 *
 * Accepts PieceCID as string, CID object, or PieceCID type
 *
 * @param pieceCidInput - PieceCID as either a CID object or string
 * @returns The raw size in bytes
 * @throws {Error} If the input is not a valid PieceCIDv2
 */
export function getSizeFromPieceCID(pieceCidInput: PieceCID | CID | string): number {
  const pieceCid = asPieceCID(pieceCidInput)
  if (pieceCid == null) {
    throw new Error('Invalid PieceCID: input must be a valid PieceCIDv2')
  }
  return getSize(pieceCid)
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
 * Check if a CID is a valid PieceCIDv2
 * @param cid - The CID to check
 * @returns True if it's a valid PieceCIDv2
 */
export function isPieceCID(cid: Link.Link | CID): cid is PieceCID {
  return (
    typeof cid === 'object' &&
    CID.asCID(cid) != null &&
    cid.code === Raw.code &&
    cid.multihash.code === Hasher.code &&
    cid.version === 1
  )
}

/**
 * Calculate the PieceCID (Piece Commitment) for a given data blob
 *
 * @param data - The binary data to calculate the PieceCID for
 * @returns The calculated PieceCID CID
 */
export function calculate(data: Uint8Array): PieceCID {
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

/**
 * Calculate PieceCID from an async iterable of Uint8Array chunks.
 *
 * @param data - AsyncIterable yielding Uint8Array chunks
 * @returns Calculated PieceCID
 *
 * @example
 * const pieceCid = await calculateFromIterable(asyncIterableData)
 */
export async function calculateFromIterable(data: AsyncIterable<Uint8Array>): Promise<PieceCID> {
  const hasher = Hasher.create()

  for await (const chunk of data) {
    hasher.write(chunk)
  }

  const digest = hasher.digest()
  return Link.create(Raw.code, digest) as PieceCID
}

/**
 * Create a TransformStream that calculates PieceCID while streaming data through it
 * This allows calculating PieceCID without buffering the entire data in memory
 *
 * @returns An object with the TransformStream and a getPieceCID function to retrieve the result
 *
 * @example
 * const { stream, getPieceCID } = createPieceCIDStream()
 * await fetch(url, {
 *   method: 'PUT',
 *   body: dataStream.pipeThrough(stream)
 * })
 * const pieceCid = getPieceCID() // Available after stream completes
 */
export function createPieceCIDStream(): {
  stream: TransformStream<Uint8Array, Uint8Array>
  getPieceCID: () => PieceCID | null
} {
  const hasher = Hasher.create()
  let finished = false
  let pieceCid: PieceCID | null = null

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      // Write chunk to hasher for CommP calculation
      hasher.write(chunk)
      // Pass chunk through unchanged to continue upload
      controller.enqueue(chunk)
    },

    flush() {
      // Calculate final PieceCID when stream ends
      const digest = hasher.digest()
      pieceCid = Link.create(Raw.code, digest) as PieceCID
      finished = true
    },
  })

  return {
    stream,
    getPieceCID: () => {
      if (!finished) {
        return null
      }
      return pieceCid
    },
  }
}

/**
 * Convert a hex representation of a PieceCID to a PieceCID object
 *
 * The contract stores the full PieceCID multihash digest (including height and padding)
 * The data comes as a hex string, we need to decode it as bytes then as a CID to get the PieceCID object
 *
 * @param pieceCidHex - The hex representation of the PieceCID
 * @returns {PieceCID} The PieceCID object
 */
export function hexToPieceCID(pieceCidHex: Hex | string): PieceCID {
  const pieceDataBytes = hexToBytes(pieceCidHex as Hex)
  const possiblePieceCID = CID.decode(pieceDataBytes)
  const isValid = isPieceCID(possiblePieceCID)
  if (!isValid) {
    throw new Error(`Hex string '${pieceCidHex}' is a valid CID but not a valid PieceCID`)
  }
  return possiblePieceCID as PieceCID
}
