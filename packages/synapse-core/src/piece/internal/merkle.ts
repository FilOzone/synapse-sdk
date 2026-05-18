/**
 * Merkle tree primitives over 32-byte nodes using SHA-256 with the top two
 * bits truncated (SHA254), matching Filecoin piece tree construction.
 */

import * as SHA256 from 'sync-multihash-sha2/sha256'
import { NODE_SIZE } from './constants.ts'

export type Node = Uint8Array

/**
 * Truncate a 32-byte node by zeroing the top two bits of the last byte.
 * Mutates the input in place; returns it for chaining.
 */
export function truncate(node: Node): Node {
  node[NODE_SIZE - 1] &= 0b00111111
  return node
}

/**
 * Compute a parent node from two children: SHA-256 of (left || right),
 * then top-two-bits truncated.
 */
export function computeNode(left: Node, right: Node): Node {
  const payload = new Uint8Array(left.length + right.length)
  payload.set(left, 0)
  payload.set(right, left.length)
  const { digest } = SHA256.digest(payload)
  return truncate(digest)
}

/**
 * Split FR32-expanded bytes into 32-byte merkle leaves.
 */
export function split(source: Uint8Array): Node[] {
  const count = source.length / NODE_SIZE
  const chunks = new Array<Node>(count)
  for (let n = 0; n < count; n++) {
    const offset = n * NODE_SIZE
    chunks[n] = source.subarray(offset, offset + NODE_SIZE)
  }
  return chunks
}

/** Returns a frozen all-zeros 32-byte node. */
export function emptyNode(): Node {
  return EMPTY
}

const EMPTY: Node = (() => {
  const node = new Uint8Array(NODE_SIZE)
  Object.freeze(node.buffer)
  return node
})()
