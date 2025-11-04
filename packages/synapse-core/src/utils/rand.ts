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
