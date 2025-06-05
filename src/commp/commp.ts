/**
 * CommP (Piece Commitment) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 */

import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import { LegacyPieceLink, PieceDigest, Fr32 } from '@web3-storage/data-segment'
import * as Hasher from '@web3-storage/data-segment/multihash'

// Filecoin-specific constants
export const FIL_COMMITMENT_UNSEALED = 0xf101
export const SHA2_256_TRUNC254_PADDED = 0x1012

/**
 * CommP - A constrained CID type for Piece Commitments
 * This is implemented as a Link type which is made concrete by a CID. A CommP
 * uses the fil-commitment-unsealed codec (0xf101) and
 * sha2-256-trunc254-padded multihash function (0x1012). This will eventually be
 * replaced by a CommPv2 which uses the raw codec (0x55) and the
 * fr32-sha256-trunc254-padbintree multihash function (0x1011), which is a
 * specialised form of sha2-256-trunc254-padded multihash that also encodes the
 * content length and the height of the merkle tree.
 */
export type CommP = LegacyPieceLink

/**
 * Determine the additional bytes of zeroed padding to append to the
 * end of a resource of `size` length in order to fit within a pow2 piece while
 * leaving enough room for Fr32 padding (2 bits per 254).
 *
 * @param {number} payloadSize - The size of the payload.
 * @returns {number}
 */
export function toZeroPaddedSize (payloadSize: number): number {
  return Fr32.toZeroPaddedSize(payloadSize)
}

/**
 * Parse a CommP string into a CID and validate it
 * @param commpString - The CommP as a string (base32 or other multibase encoding)
 * @returns The parsed and validated CommP CID or null if invalid
 */
function parseCommP (commpString: string): CommP | null {
  try {
    const cid = CID.parse(commpString)

    // Validate it's a proper CommP
    if (cid.code !== FIL_COMMITMENT_UNSEALED) {
      return null
    }

    if (cid.multihash.code !== SHA2_256_TRUNC254_PADDED) {
      return null
    }

    return cid as CommP
  } catch {
    return null
  }
}

/**
 * Check if a CID is a valid CommP
 * @param cid - The CID to check
 * @returns True if it's a valid CommP
 */
function isValidCommP (cid: CommP | CID): cid is CommP {
  return cid.code === FIL_COMMITMENT_UNSEALED &&
         cid.multihash.code === SHA2_256_TRUNC254_PADDED
}

/**
 * Convert a CommP input (string or CID) to a validated CID
 * This is the main function to use when accepting CommP inputs
 * @param commpInput - CommP as either a CID object or string
 * @returns The validated CommP CID or null if not a valid CommP
 */
export function asCommP (commpInput: CommP | CID | string): CommP | null {
  if (typeof commpInput === 'string') {
    return parseCommP(commpInput)
  }

  if (typeof commpInput === 'object' && CID.asCID(commpInput) !== null) {
    // It's already a CID, validate it
    if (!isValidCommP(commpInput)) {
      return null
    }
    return commpInput
  }

  return null
}

/**
 * Convert a CommPv2 multihash digest to a CommPv1 CID
 * @param digest - The CommPv2 digest from the hasher
 * @returns The legacy CommPv1 CID
 */
function commPv2ToCommPv1 (digest: PieceDigest): CommP {
  // CommPv2 is `uvarint padding | uint8 height | 32 byte root data`
  // For now we are operating with CommPv1 which just uses the 32 byte digest at
  // the end, so we'll down-convert since @web3-storage/data-segment is designed
  // to work with CommPv2.
  const legacyDigest = Digest.create(
    SHA2_256_TRUNC254_PADDED,
    digest.bytes.subarray(digest.bytes.length - Hasher.Digest.ROOT_SIZE)
  )
  return CID.create(1, FIL_COMMITMENT_UNSEALED, legacyDigest)
}

/**
 * Calculate the CommP (Piece Commitment) for a given data blob
 * @param data - The binary data to calculate the CommP for
 * @returns The calculated CommP CID
 */
export function calculate (data: Uint8Array): CommP {
  // TODO: consider https://github.com/storacha/fr32-sha2-256-trunc254-padded-binary-tree-multihash
  // for more efficient CommP calculation in WASM
  const hasher = Hasher.create()
  // We'll get slightly better performance by writing in chunks to let the
  // hasher do its work incrementally
  const chunkSize = 2048
  for (let i = 0; i < data.length; i += chunkSize) {
    hasher.write(data.subarray(i, i + chunkSize))
  }
  const digest = hasher.digest()
  return commPv2ToCommPv1(digest)
}

/**
 * Create a TransformStream that calculates CommP while streaming data through it
 * This allows calculating CommP without buffering the entire data in memory
 *
 * @returns An object with the TransformStream and a getCommP function to retrieve the result
 */
export function createCommPStream (): { stream: TransformStream<Uint8Array, Uint8Array>, getCommP: () => CommP | null } {
  const hasher = Hasher.create()
  let finished = false
  let commp: CommP | null = null

  const stream = new TransformStream<Uint8Array, Uint8Array>({
    transform (chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      // Write chunk to hasher
      hasher.write(chunk)
      // Pass chunk through unchanged
      controller.enqueue(chunk)
    },

    flush () {
      // Calculate final CommP when stream ends
      const digest = hasher.digest()
      commp = commPv2ToCommPv1(digest)
      finished = true
    }
  })

  return {
    stream,
    getCommP: () => {
      if (!finished) {
        return null
      }
      return commp
    }
  }
}
