/**
 * Streaming FR32-SHA254 binary tree hasher.
 *
 * Accumulates bytes into 127-byte quads, FR32-expands each quad into
 * 4 × 32-byte leaves, and combines pairs upward into a merkle tree as new
 * quads arrive. Each tree layer holds 0 or 1 unpaired nodes between writes.
 * On `digest()`, empty slots are filled with zero-piece roots at the
 * appropriate level.
 */

import { varint } from 'multiformats'
import { IN_BYTES_PER_QUAD } from './constants.ts'
import * as Digest from './digest.ts'
import { expand as fr32Expand } from './fr32.ts'
import { computeNode, type Node, split } from './merkle.ts'
import { unpaddedToPadding } from './size.ts'
import * as ZeroPad from './zero-comm.ts'

type Layers = [Node[], ...Node[][]]

export class Hasher {
  private bytesWritten: bigint = 0n
  private readonly buffer: Uint8Array = new Uint8Array(IN_BYTES_PER_QUAD)
  private offset: number = 0
  private layers: Layers = [[]]

  /** Total bytes written so far. */
  count(): bigint {
    return this.bytesWritten
  }

  /**
   * Compute the digest of all data written so far. Idempotent: does not
   * mutate hasher state, so writing more data and calling `digest()` again is valid.
   */
  digest(): Digest.PieceDigest {
    const bytes = new Uint8Array(Digest.MAX_SIZE)
    const count = this.digestInto(bytes, 0, true)
    return Digest.fromBytes(bytes.subarray(0, count))
  }

  /** Append bytes to the hasher. */
  write(bytes: Uint8Array): this {
    const { buffer, offset, layers } = this
    const leaves = layers[0]
    const { length } = bytes

    if (length === 0) return this
    if (this.bytesWritten + BigInt(length) > Digest.MAX_PAYLOAD_SIZE) {
      throw new RangeError(`Writing ${length} bytes exceeds max payload size of ${Digest.MAX_PAYLOAD_SIZE}`)
    }

    // Not enough for a quad yet: stash in the buffer.
    if (offset + length < buffer.length) {
      buffer.set(bytes, offset)
      this.offset += length
      this.bytesWritten += BigInt(length)
      return this
    }

    // Fill the buffer to complete a quad, then process whole quads from `bytes`.
    const bytesRequired = buffer.length - offset
    buffer.set(bytes.subarray(0, bytesRequired), offset)
    leaves.push(...split(fr32Expand(buffer)))

    let readOffset = bytesRequired
    while (readOffset + IN_BYTES_PER_QUAD < length) {
      const quad = bytes.subarray(readOffset, readOffset + IN_BYTES_PER_QUAD)
      leaves.push(...split(fr32Expand(quad)))
      readOffset += IN_BYTES_PER_QUAD
    }

    this.buffer.set(bytes.subarray(readOffset), 0)
    this.offset = length - readOffset
    this.bytesWritten += BigInt(length)

    prune(this.layers)
    return this
  }

  /** Reset hasher to initial state for reuse. */
  reset(): this {
    this.offset = 0
    this.bytesWritten = 0n
    this.layers.length = 1
    this.layers[0].length = 0
    return this
  }

  private digestInto(output: Uint8Array, byteOffset: number, asMultihash: boolean): number {
    const { buffer, layers, offset, bytesWritten } = this

    // Snapshot the layers so we don't mutate hasher state.
    let [leaves, ...nodes] = layers

    // If there's a partial quad in the buffer, zero-pad and absorb it.
    if (offset > 0 || bytesWritten === 0n) {
      leaves = [...leaves, ...split(fr32Expand(buffer.fill(0, offset)))]
    }

    const tree = build([leaves, ...nodes])
    const height = tree.length - 1
    const [root] = tree[height]
    const padding = Number(unpaddedToPadding(this.bytesWritten))

    const paddingLength = varint.encodingLength(padding)

    let endOffset = byteOffset
    if (asMultihash) {
      varint.encodeTo(Digest.code, output, endOffset)
      endOffset += Digest.TAG_SIZE

      const size = paddingLength + Digest.HEIGHT_SIZE + Digest.ROOT_SIZE
      const sizeLength = varint.encodingLength(size)
      varint.encodeTo(size, output, endOffset)
      endOffset += sizeLength
    }

    varint.encodeTo(padding, output, endOffset)
    endOffset += paddingLength
    output[endOffset] = height
    endOffset += 1
    output.set(root, endOffset)
    endOffset += root.length

    return endOffset - byteOffset
  }
}

/** Combine pairs of nodes upward, leaving each layer with ≤1 unpaired node. */
function prune(layers: Layers): void {
  flush(layers, false)
}

/**
 * Walk all layers up to the root, padding partial layers with the appropriate
 * zero-piece node at each level. Used at digest time.
 */
function build(layers: Layers): Layers {
  return flush([...layers] as Layers, true)
}

function flush(layers: Layers, finalize: boolean): Layers {
  let level = 0
  while (level < layers.length) {
    let next = layers[level + 1]
    const layer = layers[level]

    if (finalize && layer.length % 2 > 0 && next) {
      layer.push(ZeroPad.fromLevel(level))
    }

    level += 1
    next = next ? (finalize ? [...next] : next) : []

    let index = 0
    while (index + 1 < layer.length) {
      const node = computeNode(layer[index], layer[index + 1])
      delete layer[index]
      delete layer[index + 1]
      next.push(node)
      index += 2
    }

    if (next.length) {
      layers[level] = next
    }
    layer.splice(0, index)
  }

  return layers
}
