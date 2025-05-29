/**
 * CommP (Piece Commitment) utilities
 *
 * Helper functions for working with Filecoin Piece CIDs
 */

import { CID } from 'multiformats/cid'
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
function isValidCommP (cid: CID): cid is CommP {
  return cid.code === FIL_COMMITMENT_UNSEALED &&
         cid.multihash.code === SHA2_256_TRUNC254_PADDED
}

/**
 * Convert a CommP input (string or CID) to a validated CID
 * This is the main function to use when accepting CommP inputs
 * @param commpInput - CommP as either a CID object or string
 * @returns The validated CommP CID or null if not a valid CommP
 */
export function asCommP (commpInput: CID | string): CommP | null {
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
