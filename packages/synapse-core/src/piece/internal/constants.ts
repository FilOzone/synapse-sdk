/**
 * Internal constants for PieceCID math.
 *
 * Reference: FRC-0069
 * https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

const BITS_PER_BYTE = 8

export const FRS_PER_QUAD = 4
export const LEAFS_PER_QUAD = BigInt(FRS_PER_QUAD)

/** Bits in an Fr element before FR32 expansion. */
export const IN_BITS_FR = 254
/** Bits in an Fr element after FR32 expansion. */
export const OUT_BITS_FR = 256

/** Source bytes per quad (4 × 254 bits / 8). */
export const IN_BYTES_PER_QUAD = (FRS_PER_QUAD * IN_BITS_FR) / BITS_PER_BYTE
/** Padded bytes per quad (4 × 256 bits / 8). */
export const OUT_BYTES_PER_QUAD = (FRS_PER_QUAD * OUT_BITS_FR) / BITS_PER_BYTE

export const PADDED_BYTES_PER_QUAD = BigInt(IN_BYTES_PER_QUAD)
export const EXPANDED_BYTES_PER_QUAD = BigInt(OUT_BYTES_PER_QUAD)

export const BYTES_PER_FR = OUT_BYTES_PER_QUAD / FRS_PER_QUAD
export const FR_RATIO = IN_BITS_FR / OUT_BITS_FR

/** Merkle tree node size in bytes. */
export const NODE_SIZE = OUT_BYTES_PER_QUAD / FRS_PER_QUAD
export const EXPANDED_BYTES_PER_NODE = BigInt(NODE_SIZE)

/**
 * Smallest payload size for which FR32 expansion has a defined result.
 * Silently upgrading 2 leaves to 4 would break the symmetry so we require
 * an extra byte; the rest is zero-padded up to 4 leaves before expansion.
 */
export const MIN_PAYLOAD_SIZE = 2 * NODE_SIZE + 1

/** Maximum tree height (one byte). */
export const MAX_HEIGHT = 255

/** PieceCID multihash code (fr32-sha2-256-trunc254-padded-binary-tree). */
export const MULTIHASH_CODE = 0x1011
/** PieceCID multihash name. */
export const MULTIHASH_NAME = 'fr32-sha2-256-trunc254-padded-binary-tree'
/** PieceCID codec (raw). */
export const CODEC_CODE = 0x55
