/**
 * Internal constants for PieceCID math.
 *
 * Reference: FRC-0069
 * https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

const BITS_PER_BYTE = 8

const FRS_PER_QUAD = 4

/** Bits in an Fr element before FR32 expansion. */
const IN_BITS_FR = 254
/** Bits in an Fr element after FR32 expansion. */
const OUT_BITS_FR = 256

/** Source bytes per quad (4 × 254 bits / 8). */
const IN_BYTES_PER_QUAD = (FRS_PER_QUAD * IN_BITS_FR) / BITS_PER_BYTE
/** Padded bytes per quad (4 × 256 bits / 8). */
const OUT_BYTES_PER_QUAD = (FRS_PER_QUAD * OUT_BITS_FR) / BITS_PER_BYTE

export const PADDED_BYTES_PER_QUAD = BigInt(IN_BYTES_PER_QUAD)

/** Merkle tree node size in bytes. */
const NODE_SIZE = OUT_BYTES_PER_QUAD / FRS_PER_QUAD
export const EXPANDED_BYTES_PER_NODE = BigInt(NODE_SIZE)

/** PieceCID multihash code (fr32-sha2-256-trunc254-padded-binary-tree). */
export const MULTIHASH_CODE = 0x1011
/** PieceCID multihash name. */
export const MULTIHASH_NAME = 'fr32-sha2-256-trunc254-padded-binary-tree'
/** PieceCID codec (raw). */
export const CODEC_CODE = 0x55
