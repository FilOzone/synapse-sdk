/**
 * Universal PieceCID parsing and validation.
 *
 * Accepts a PieceCID, plain CID, CID string, full CID bytes, or hex-encoded
 * CID bytes (as returned by FOC contracts).
 */

import { CID } from 'multiformats/cid'
import { type Hex, hexToBytes, isHex } from 'viem'
import { PIECE_CID_TAG, PieceCID } from './piece-cid.ts'

/**
 * Inputs accepted by {@link from} and {@link tryFrom}.
 *
 * - `PieceCID`: returned as-is.
 * - `CID`: validated and upgraded.
 * - `string`: parsed as CID text, then validated.
 * - `Hex` / `0x...`: decoded as full CID bytes (e.g. PDPVerifier contract returns).
 * - `Uint8Array`: decoded as full CID bytes.
 */
export type PieceCIDInput = PieceCID | CID | string | Hex | Uint8Array

/**
 * Construct a {@link PieceCID} from any supported input.
 * @throws RangeError on invalid input or non-PieceCID shape.
 */
export function from(input: PieceCIDInput): PieceCID {
  if (input instanceof PieceCID) {
    return input
  }
  if (input instanceof Uint8Array) {
    return PieceCID._fromCID(CID.decode(input))
  }
  if (typeof input === 'string') {
    if (isHex(input)) {
      return PieceCID._fromCID(CID.decode(hexToBytes(input)))
    }
    return PieceCID._fromCID(CID.parse(input).toV1())
  }
  // Anything else is treated as a CID-like (duck-typed via CID.asCID).
  const cid = CID.asCID(input)
  if (cid == null) {
    throw new RangeError('Input is not a CID')
  }
  return PieceCID._fromCID(cid)
}

/**
 * Construct a {@link PieceCID} from any supported input, or `null` if the
 * input is null/undefined or fails validation.
 */
export function tryFrom(input: PieceCIDInput | null | undefined): PieceCID | null {
  if (input == null) return null
  try {
    return from(input)
  } catch {
    return null
  }
}

/**
 * Type guard for {@link PieceCID} instances. Plain CIDs need {@link tryFrom}
 * to gain accessors. Cross-realm/bundle safe via {@link PIECE_CID_TAG}.
 */
export function is(input: unknown): input is PieceCID {
  return typeof input === 'object' && input !== null && (input as Record<symbol, unknown>)[PIECE_CID_TAG] === true
}

/**
 * Compare two PieceCID inputs for equality. Invalid inputs return `false`.
 */
export function equals(a: PieceCIDInput | null | undefined, b: PieceCIDInput | null | undefined): boolean {
  const pa = tryFrom(a)
  const pb = tryFrom(b)
  if (pa == null || pb == null) return false
  return pa.equals(pb)
}
