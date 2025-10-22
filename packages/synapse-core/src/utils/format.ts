import * as dn from 'dnum'

export function formatBalance(
  data: { value?: bigint; decimals?: number; compact?: boolean; digits?: number } | undefined
) {
  return dn.format([data?.value ?? 0n, data?.decimals ?? 18], {
    compact: data?.compact ?? true,
    digits: data?.digits ?? 4,
  })
}

export function formatFraction(
  data: { value?: bigint; decimals?: number; compact?: boolean; digits?: number } | undefined
) {
  return dn.format([data?.value ?? 0n, data?.decimals ?? 18], {
    compact: data?.compact ?? false,
    digits: data?.digits ?? 8,
  })
}
