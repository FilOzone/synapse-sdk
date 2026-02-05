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

/**
 * Parse a value to a bigint.
 *
 * @param value - The value to parse. It can be a string, a number, a bigint, or a dnum.
 * @param decimals - The number of decimals to parse. If not provided, the default is 18.
 * @returns The parsed value as a bigint.
 */
export function parseUnits(value: string | number | bigint | dn.Dnum, decimals?: number) {
  return dn.from(value, decimals ?? 18)[0]
}

type FormatUnitsOptions = {
  /**
   * The number of decimals.
   * If not provided, the default is 18.
   */
  decimals?: number
  /**
   * The number of digits to display after the decimal point.
   */
  digits?: number
  /**
   * Compact formatting (e.g. “1,000” becomes “1K”).
   */
  compact?: boolean
  /**
   * Add trailing zeros if any, following the number of digits.
   */
  trailingZeros?: boolean
  /**
   * The locale to use for formatting.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl#locales_argument
   */
  locale?: Intl.LocalesArgument
  /**
   * Method used to round to digits decimals (defaults to "ROUND_HALF").
   *
   */
  decimalsRounding?: 'ROUND_HALF' | 'ROUND_UP' | 'ROUND_DOWN'
  /**
   * How to display the sign of the number (defaults to "auto").
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/NumberFormat/NumberFormat#signdisplay
   */
  signDisplay?: 'auto' | 'always' | 'exceptZero' | 'negative' | 'never'
}

export function formatUnits(value: bigint, options?: FormatUnitsOptions) {
  return dn.format([value, options?.decimals ?? 18], {
    locale: options?.locale,
    compact: options?.compact,
    digits: options?.digits,
    trailingZeros: options?.trailingZeros,
    decimalsRounding: options?.decimalsRounding,
    signDisplay: options?.signDisplay,
  })
}
