const crypto = globalThis.crypto

export function fallbackRandU256(): bigint {
  // TODO
  return BigInt(0)
}

export function randU256(): bigint {
  if (crypto?.getRandomValues != null) {
    return BigInt(0)
  } else {
    return fallbackRandU256()
  }
}

export function fallbackRandIndex(length: number): number {
  return Math.floor(Math.random() * length)
}

/**
 * Returns a random index into an array of supplied length (0 <= index < length)
 *
 */
export function randIndex(length: number): number {
  // Try crypto.getRandomValues if available
  if (crypto?.getRandomValues != null) {
    const randomBytes = new Uint32Array(1)
    crypto.getRandomValues(randomBytes)
    return randomBytes[0] % length
  } else {
    return fallbackRandIndex(length)
  }
}
