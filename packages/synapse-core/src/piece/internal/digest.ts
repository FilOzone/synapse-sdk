/**
 * PieceCID multihash digest encoding.
 *
 * Digest layout: [padding (varint)][height (1 byte)][root (32 bytes)]
 */

import { varint } from 'multiformats'
import * as SHA256 from 'sync-multihash-sha2/sha256'
import { IN_BITS_FR, MULTIHASH_CODE, MULTIHASH_NAME, OUT_BITS_FR } from './constants.ts'
import { expandedFromHeight } from './size.ts'

export const code = MULTIHASH_CODE
export const name = MULTIHASH_NAME

/** Varint max for the tree-height byte. */
const MAX_PADDING_SIZE = 9
export const HEIGHT_SIZE = 1
export const ROOT_SIZE = SHA256.size

export const MAX_DIGEST_SIZE = MAX_PADDING_SIZE + HEIGHT_SIZE + SHA256.size
export const TAG_SIZE = varint.encodingLength(code)
export const MAX_SIZE = TAG_SIZE + varint.encodingLength(MAX_DIGEST_SIZE) + MAX_DIGEST_SIZE

export const MAX_HEIGHT = 255

/**
 * Max payload size derivable from the maximum-height tree.
 */
export const MAX_PAYLOAD_SIZE = (expandedFromHeight(MAX_HEIGHT) * BigInt(IN_BITS_FR)) / BigInt(OUT_BITS_FR)

/**
 * Multihash digest of a PieceCID payload. Exposes the parsed fields
 * (`padding`, `height`, `root`) without copying.
 */
export class PieceDigest {
  readonly code = code
  readonly name = name
  readonly bytes: Uint8Array
  readonly digest: Uint8Array

  constructor(bytes: Uint8Array) {
    this.bytes = bytes
    const [tag] = varint.decode(bytes)
    if (tag !== code) {
      throw new RangeError(`Expected multihash with code ${code}`)
    }

    let offset = TAG_SIZE
    const [size, length] = varint.decode(bytes, offset)
    offset += length
    const digest = bytes.subarray(offset)
    if (digest.length !== size) {
      throw new RangeError(`Invalid multihash size: expected ${offset + size} bytes, got ${bytes.length}`)
    }

    // Digest shape per FRC-0069: [padding varint][height byte][32-byte root].
    const [, paddingLength] = varint.decode(digest)
    if (digest.length !== paddingLength + HEIGHT_SIZE + ROOT_SIZE) {
      throw new RangeError(
        `Invalid PieceCID digest shape: expected ${paddingLength + HEIGHT_SIZE + ROOT_SIZE} bytes (padding varint + 1 height + 32 root), got ${digest.length}`
      )
    }

    this.digest = digest
  }

  get size(): number {
    return this.digest.length
  }

  get padding(): bigint {
    const [padding] = varint.decode(this.digest)
    return BigInt(padding)
  }

  get height(): number {
    const [, offset] = varint.decode(this.digest)
    return this.digest[offset]
  }

  get root(): Uint8Array {
    const [, offset] = varint.decode(this.digest)
    return this.digest.subarray(offset + HEIGHT_SIZE, offset + HEIGHT_SIZE + SHA256.size)
  }
}

export function fromBytes(bytes: Uint8Array): PieceDigest {
  return new PieceDigest(bytes)
}

export function fromFields(input: { padding: bigint; height: number; root: Uint8Array }): PieceDigest {
  const { padding, height, root } = input
  const paddingLength = varint.encodingLength(Number(padding))
  const size = paddingLength + HEIGHT_SIZE + ROOT_SIZE
  const sizeLength = varint.encodingLength(size)
  const multihashLength = TAG_SIZE + sizeLength + size

  const bytes = new Uint8Array(multihashLength)
  let offset = 0
  varint.encodeTo(code, bytes, offset)
  offset += TAG_SIZE
  varint.encodeTo(size, bytes, offset)
  offset += sizeLength
  varint.encodeTo(Number(padding), bytes, offset)
  offset += paddingLength
  bytes[offset] = height
  offset += HEIGHT_SIZE
  bytes.set(root, offset)

  return new PieceDigest(bytes)
}
