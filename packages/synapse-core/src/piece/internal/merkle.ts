/**
 * Merkle tree primitives over 32-byte nodes using SHA-256 with the top two
 * bits truncated (SHA254), matching Filecoin piece tree construction.
 */

import { Hash } from 'ox'
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
  return truncate(Hash.sha256(payload))
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
