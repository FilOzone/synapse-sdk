function log2Floor(n: bigint): number {
  let result = 0n
  let value = n
  // biome-ignore lint/suspicious/noAssignInExpressions: tight loop, idiomatic
  while ((value >>= 1n)) result++
  return Number(result)
}

export function log2Ceil(n: bigint): number {
  return n <= 1n ? 0 : log2Floor(n - 1n) + 1
}
