/**
 * PieceLink (Piece Commitment CID / PieceLink) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 */

import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import * as Raw from 'multiformats/codecs/raw'
import * as Link from 'multiformats/link'
import { PieceLink as PieceLinkType, LegacyPieceLink as LegacyPieceLinkType } from '@web3-storage/data-segment'
import * as Hasher from '@web3-storage/data-segment/multihash'

const FIL_COMMITMENT_UNSEALED = 0xf101
const SHA2_256_TRUNC254_PADDED = 0x1012

/**
 * PieceLink - A constrained CID type for Piece Commitments.
 * This is implemented as a Link type which is made concrete by a CID. A
 * PieceLink uses the raw codec (0x55) and the fr32-sha256-trunc254-padbintree
 * multihash function (0x1011) which encodes the base content length (as
 * padding) of the original piece, and the height of the merkle tree used to
 * hash it.
 *
 * See https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 * for more information.
 */
export type PieceLink = PieceLinkType

/**
 * LegacyPieceLink - A constrained CID type for Legacy Piece Commitments.
 * This is implemented as a Link type which is made concrete by a CID. A
 * LegacyPieceLink uses the fil-commitment-unsealed codec (0xf101) and the
 * sha2-256-trunc254-padded (0x1012) multihash function.
 * This 32 bytes of the hash digest in a LegacyPieceLink is the same as the
 * equivalent PieceLink, but a LegacyPieceLink does not encode the length or
 * tree height of the original raw piece. A PieceLink can be converted to a
 * LegacyPieceLink, but not vice versa.
 * LegacyPieceLink is commonly known as "CommP" or simply "Piece Commitment"
 * in Filecoin.
 */
export type LegacyPieceLink = LegacyPieceLinkType

/**
 * Parse a PieceLink string into a CID and validate it
 * @param pieceLinkString - The PieceLink as a string (base32 or other multibase encoding)
 * @returns The parsed and validated PieceLink CID or null if invalid
 */
function parsePieceLink (pieceLinkString: string): PieceLink | null {
  try {
    const cid = CID.parse(pieceLinkString)
    if (isValidPieceLink(cid)) {
      return cid as PieceLink
    }
  } catch {
  }
  return null
}

/**
 * Parse a LegacyPieceLink string into a CID and validate it
 * @param pieceLinkString - The LegacyPieceLink as a string (base32 or other multibase encoding)
 * @returns The parsed and validated LegacyPieceLink CID or null if invalid
 */
function parseLegacyPieceLink (pieceLinkString: string): LegacyPieceLink | null {
  try {
    const cid = CID.parse(pieceLinkString)
    if (isValidLegacyPieceLink(cid)) {
      return cid as LegacyPieceLink
    }
  } catch {
  }
  return null
}

/**
 * Check if a CID is a valid PieceLink
 * @param cid - The CID to check
 * @returns True if it's a valid PieceLink
 */
function isValidPieceLink (cid: PieceLink | CID): cid is PieceLink {
  return cid.code === Raw.code && cid.multihash.code === Hasher.code
}

/**
 * Check if a CID is a valid LegacyPieceLink
 * @param cid - The CID to check
 * @returns True if it's a valid LegacyPieceLink
 */
function isValidLegacyPieceLink (cid: LegacyPieceLink | CID): cid is LegacyPieceLink {
  return cid.code === FIL_COMMITMENT_UNSEALED && cid.multihash.code === SHA2_256_TRUNC254_PADDED
}

/**
 * Convert a PieceLink input (string or CID) to a validated CID
 * This is the main function to use when accepting PieceLink inputs
 * @param pieceLinkInput - PieceLink as either a CID object or string
 * @returns The validated PieceLink CID or null if not a valid PieceLink
 */
export function asPieceLink (pieceLinkInput: PieceLink | CID | string): PieceLink | null {
  if (typeof pieceLinkInput === 'string') {
    return parsePieceLink(pieceLinkInput)
  }

  if (typeof pieceLinkInput === 'object' && CID.asCID(pieceLinkInput as CID) !== null) {
    // It's already a CID, validate it
    if (isValidPieceLink(pieceLinkInput as CID)) {
      return pieceLinkInput as PieceLink
    }
  }

  // Nope
  return null
}

/**
 * Convert a LegacyPieceLink input (string or CID) to a validated CID
 * This function can be used to parse a LegacyPieceLink (CommPv1) or to downgrade a PieceLink
 * (CommPv2) to a LegacyPieceLink.
 * @param pieceLinkInput - LegacyPieceLink as either a CID object or string
 * @returns The validated LegacyPieceLink CID or null if not a valid LegacyPieceLink
 */
export function asLegacyPieceLink (pieceLinkInput: PieceLink | LegacyPieceLink | CID | string): LegacyPieceLink | null {
  const pieceLink = asPieceLink(pieceLinkInput as (CID | string))
  if (pieceLink != null) {
    // downgrade to LegacyPieceLink
    const digest = Digest.create(SHA2_256_TRUNC254_PADDED, pieceLink.multihash.digest.subarray(-32))
    return Link.create(FIL_COMMITMENT_UNSEALED, digest) as LegacyPieceLink
  }

  if (typeof pieceLinkInput === 'string') {
    return parseLegacyPieceLink(pieceLinkInput)
  }

  if (typeof pieceLinkInput === 'object' && CID.asCID(pieceLinkInput as CID) !== null) {
    // It's already a CID, validate it
    if (isValidLegacyPieceLink(pieceLinkInput as CID)) {
      return pieceLinkInput as LegacyPieceLink
    }
  }

  // Nope
  return null
}

/**
 * Calculate the PieceLink (Piece Commitment) for a given data blob
 * @param data - The binary data to calculate the PieceLink for
 * @returns The calculated PieceLink CID
 */
export function calculate (data: Uint8Array): PieceLink {
  // TODO: consider https://github.com/storacha/fr32-sha2-256-trunc254-padded-binary-tree-multihash
  // for more efficient PieceLink calculation in WASM
  const hasher = Hasher.create()
  // We'll get slightly better performance by writing in chunks to let the
  // hasher do its work incrementally
  const chunkSize = 2048
  for (let i = 0; i < data.length; i += chunkSize) {
    hasher.write(data.subarray(i, i + chunkSize))
  }
  const digest = hasher.digest()
  return Link.create(Raw.code, digest)
}

/**
 * Create a TransformStream that calculates PieceLink while streaming data through it
 * This allows calculating PieceLink without buffering the entire data in memory
 *
 * @returns An object with the TransformStream and a getPieceLink function to retrieve the result
 */
export function createPieceLinkStream (): { stream: TransformStream<Uint8Array, Uint8Array>, getPieceLink: () => PieceLink | null } {
  const hasher = Hasher.create()
  let finished = false
  let pieceLink: PieceLink | null = null

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      // Write chunk to hasher
      hasher.write(chunk)
      // Pass chunk through unchanged
      controller.enqueue(chunk)
    },

    flush () {
      // Calculate final PieceLink when stream ends
      const digest = hasher.digest()
      pieceLink = Link.create(Raw.code, digest)
      finished = true
    }
  })

  return {
    stream,
    getPieceLink: () => {
      if (!finished) {
        return null
      }
      return pieceLink
    }
  }
}
