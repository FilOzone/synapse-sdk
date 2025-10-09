const crypto = globalThis.crypto

export function fallbackRandU256(): bigint {
  let result = 0n
  for (let i = 0; i < 32; i++) {
    result <<= 8n
    result |= BigInt(fallbackRandIndex(256))
  }
  return result
}

/**
 * @returns a random unsigned big integer between `0` and `2**256-1` inclusive
 */
export function randU256(): bigint {
  if (crypto?.getRandomValues != null) {
    const randU64s = new BigUint64Array(4)
    crypto.getRandomValues(randU64s)
    let result = 0n
    randU64s.forEach((randU64) => {
      result <<= 64n
      result |= randU64
    })
    return result
  } else {
    return fallbackRandU256()
  }
}

export function fallbackRandIndex(length: number): number {
  return Math.floor(Math.random() * length)
}

/**
 * Provides a random index into an array of supplied length (0 <= index < length)
 * @param length - exclusive upper boundary
 * @returns a valid index
 */
export function randIndex(length: number): number {
  if (crypto?.getRandomValues != null) {
    const randomBytes = new Uint32Array(1)
    crypto.getRandomValues(randomBytes)
    return randomBytes[0] % length
  } else {
    return fallbackRandIndex(length)
  }
}
