/**
 * PieceCID: a CID constrained to Filecoin piece commitments.
 *
 * Extends `multiformats` CID so it's accepted anywhere a CID is, with eager
 * accessors for the fields contracts and SP APIs care about (root, height,
 * padding, size).
 *
 * The multihash uses `fr32-sha2-256-trunc254-padded-binary-tree` (0x1011)
 * over the `raw` codec (0x55), with version 1.
 *
 * Reference: FRC-0069
 * https://github.com/filecoin-project/FIPs/blob/master/FRCs/frc-0069.md
 */

import { CID, type MultihashDigest } from 'multiformats/cid'
import { bytesToHex, type Hex } from 'viem'
import { CODEC_CODE, MULTIHASH_CODE } from './internal/constants.ts'
import * as Digest from './internal/digest.ts'
import { expandedFromHeight, unpaddedFromPiece } from './internal/size.ts'

// PieceDigest's literal code (0x1011) doesn't unify with multiformats' typed
// generic Alg parameter even though it's structurally compatible. One cast
// here, anchored in the class shape, keeps the rest of the file clean.
const asMultihash = (digest: Digest.PieceDigest): MultihashDigest<typeof MULTIHASH_CODE> =>
  digest as unknown as MultihashDigest<typeof MULTIHASH_CODE>

export class PieceCID extends CID<unknown, typeof CODEC_CODE, typeof MULTIHASH_CODE, 1> {
  private readonly _pieceDigest: Digest.PieceDigest

  private constructor(bytes: Uint8Array, digest: Digest.PieceDigest) {
    super(1, CODEC_CODE, asMultihash(digest), bytes)
    this._pieceDigest = digest
  }

  /**
   * Construct a PieceCID from a plain CID, validating it has PieceCID shape.
   * @throws RangeError when the CID is not a valid PieceCID.
   * @internal Used by `Piece.from()`. Most callers should use `Piece.from()`.
   */
  static _fromCID(cid: CID): PieceCID {
    if (cid instanceof PieceCID) return cid
    if (cid.version !== 1) {
      throw new RangeError(`PieceCID must be v1, got v${cid.version}`)
    }
    if (cid.code !== CODEC_CODE) {
      throw new RangeError(`PieceCID must use raw codec (0x${CODEC_CODE.toString(16)}), got 0x${cid.code.toString(16)}`)
    }
    if (cid.multihash.code !== MULTIHASH_CODE) {
      throw new RangeError(
        `PieceCID must use multihash 0x${MULTIHASH_CODE.toString(16)}, got 0x${cid.multihash.code.toString(16)}`
      )
    }
    const digest = new Digest.PieceDigest(cid.multihash.bytes)
    return new PieceCID(cid.bytes, digest)
  }

  /**
   * Construct from a freshly-computed digest. Used by hasher/calculate paths.
   * @internal
   */
  static _fromDigest(digest: Digest.PieceDigest): PieceCID {
    const cid = CID.createV1(CODEC_CODE, asMultihash(digest))
    return new PieceCID(cid.bytes, digest)
  }

  /** The 32-byte merkle root (what FOC contracts encode). */
  get root(): Uint8Array {
    return this._pieceDigest.root
  }

  /** Tree height. */
  get height(): number {
    return this._pieceDigest.height
  }

  /** Zero-padding bytes added to the raw payload before FR32 expansion. */
  get padding(): bigint {
    return this._pieceDigest.padding
  }

  /**
   * Raw (unpadded) payload size in bytes.
   * @throws when the size exceeds Number.MAX_SAFE_INTEGER.
   */
  get size(): number {
    const raw = unpaddedFromPiece(this._pieceDigest.height, this._pieceDigest.padding)
    if (raw > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new RangeError(`Raw size ${raw} exceeds Number.MAX_SAFE_INTEGER`)
    }
    return Number(raw)
  }

  /**
   * Padded piece size in bytes (`2^height × 32`).
   *
   * This is the canonical Filecoin "padded piece size" that contracts and the
   * Filecoin protocol use, also called the "expanded" size: the total tree
   * leaf count multiplied by node size. Always a power of 2 × 32.
   */
  get paddedSize(): bigint {
    return expandedFromHeight(this._pieceDigest.height)
  }

  /** The full multihash digest as a `0x...` hex string (e.g. for contract calls). */
  toHex(): Hex {
    return bytesToHex(this.bytes)
  }
}

/** Brand for cross-realm / cross-bundle identification via {@link is}. */
export const PIECE_CID_TAG: unique symbol = Symbol.for('@filoz/synapse-core/piece-cid') as never
Object.defineProperty(PieceCID.prototype, PIECE_CID_TAG, { value: true })
