/**
 * CommP (Piece Commitment) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 */

import { CID } from 'multiformats/cid'
import * as Digest from 'multiformats/hashes/digest'
import * as Hasher from '@web3-storage/data-segment/multihash'
import type { CommP } from './types.js'

// Filecoin-specific constants
export const FIL_COMMITMENT_UNSEALED = 0xf101
export const SHA2_256_TRUNC254_PADDED = 0x1012

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
