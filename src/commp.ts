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
 * @returns The parsed and validated CommP CID
 * @throws If the CID is not a valid CommP
 */
export function parseCommP(commpString: string): CommP {
  const cid = CID.parse(commpString)

  // Validate it's a proper CommP
  if (cid.code !== FIL_COMMITMENT_UNSEALED) {
    throw new Error(`Invalid CommP codec: expected ${FIL_COMMITMENT_UNSEALED}, got ${cid.code}`)
  }

  if (cid.multihash.code !== SHA2_256_TRUNC254_PADDED) {
    throw new Error(`Invalid CommP hash: expected ${SHA2_256_TRUNC254_PADDED}, got ${cid.multihash.code}`)
  }

  return cid as CommP
}

/**
 * Validate if a CID is a valid CommP
 * @param cid - The CID to validate
 * @returns True if it's a valid CommP
 */
export function isValidCommP(cid: CID): cid is CommP {
  return cid.code === FIL_COMMITMENT_UNSEALED &&
         cid.multihash.code === SHA2_256_TRUNC254_PADDED
}

/**
 * Normalize a CommP input (string or CID) to a validated CID
 * This is the main function to use when accepting CommP inputs
 * @param commpInput - CommP as either a CID object or string
 * @returns The validated CommP CID
 * @throws If the input is not a valid CommP
 */
export function normalizeCommP(commpInput: CID | string): CommP {
  if (typeof commpInput === 'string') {
    return parseCommP(commpInput)
  }

  if (commpInput && typeof commpInput === 'object' && CID.asCID(commpInput) != null) {
    // It's already a CID, validate it
    if (!isValidCommP(commpInput)) {
      throw new Error(`Invalid CommP: codec=${commpInput.code}, hash=${commpInput.multihash.code}`)
    }
    return commpInput as CommP
  }

  throw new Error('CommP must be a CID object or string')
}