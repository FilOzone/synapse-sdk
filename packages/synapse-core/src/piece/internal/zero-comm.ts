/**
 * Zero-piece merkle roots at each tree level, computed lazily.
 *
 * level 0 is a 32-byte all-zero node; level N is `computeNode(level N-1, level N-1)`.
 * Used when balancing partially-filled layers in the streaming hasher.
 */

import { NODE_SIZE } from './constants.ts'
import { computeNode, emptyNode, type Node } from './merkle.ts'

const MAX_LEVEL = 64

class ZeroComm {
  readonly bytes: Uint8Array
  private node: Node
  private length: number

  constructor() {
    this.bytes = new Uint8Array(MAX_LEVEL * NODE_SIZE)
    this.bytes.set(emptyNode(), 0)
    this.node = emptyNode()
    this.length = NODE_SIZE
  }

  slice(start: number, end: number): Uint8Array {
    while (this.length < end) {
      this.node = computeNode(this.node, this.node)
      this.bytes.set(this.node, this.length)
      this.length += NODE_SIZE
    }
    return this.bytes.subarray(start, end)
  }
}

const ZERO_COMM = new ZeroComm()

/**
 * Zero-piece merkle root at the given tree level.
 *
 * @throws RangeError for levels outside `[0, 63]`.
 */
export function fromLevel(level: number): Node {
  if (level < 0 || level >= MAX_LEVEL) {
    throw new RangeError(`Only levels between 0 and ${MAX_LEVEL - 1} inclusive are available`)
  }
  return ZERO_COMM.slice(NODE_SIZE * level, NODE_SIZE * (level + 1))
}
