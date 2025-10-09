export function randU256(): bigint {
  //TODO
  return BigInt(0)
}

/**
 * Returns a random index into an array of supplied length (0 <= index < length)
 *
 */
export function randIndex(length: number): number {
  // Try crypto.getRandomValues if available (HTTPS contexts)
  if (typeof globalThis.crypto !== 'undefined' && globalThis.crypto.getRandomValues != null) {
    const randomBytes = new Uint32Array(1)
    globalThis.crypto.getRandomValues(randomBytes)
    return randomBytes[0] % length
  } else {
    // Fallback for HTTP contexts - use multiple entropy sources
    return Math.floor(Math.random() * length)
  }
}
