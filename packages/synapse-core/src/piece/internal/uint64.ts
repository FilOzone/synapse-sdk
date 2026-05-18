export function log2Floor(n: bigint): number {
  let result = 0n
  let value = n
  // biome-ignore lint/suspicious/noAssignInExpressions: tight loop, idiomatic
  while ((value >>= 1n)) result++
  return Number(result)
}

export function log2Ceil(n: bigint): number {
  return n <= 1n ? 0 : log2Floor(n - 1n) + 1
}

export function trailingZeros64(n: bigint): number {
  if (n === 0n) return 64
  let value = n
  let count = 0
  while ((value & 1n) === 0n) {
    value >>= 1n
    count++
  }
  return count
}

export function onesCount64(value: bigint): number {
  let count = 0
  for (let i = 0n; i < 64n; i++) {
    if ((value & (1n << i)) !== 0n) count++
  }
  return count
}
