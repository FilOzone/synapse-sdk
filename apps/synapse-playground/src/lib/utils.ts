import { type ClassValue, clsx } from 'clsx'
import { toast } from 'sonner'
import { twMerge } from 'tailwind-merge'
import { BaseError } from 'viem'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Truncates a string by keeping a specified number of characters at the start and end,
 * replacing the middle with "...". If the string is too short, returns it as is.
 *
 * @param str - The string to truncate.
 * @param startLen - Number of characters to keep at the start.
 * @param endLen - Number of characters to keep at the end.
 * @returns The truncated string.
 * @example
 * ```ts twoslash
 * import { truncateMiddle } from 'filsnap/utils'
 * truncateMiddle('f1abcdef1234567890abcdef', 4, 4) // "f1ab...cdef"
 * ```
 */
export function truncateMiddle(str: string, startLen: number, endLen: number): string {
  if (str.length <= startLen + endLen + 3) return str
  return `${str.slice(0, startLen)}...${str.slice(-endLen)}`
}

export function formatErrorForToast(error: Error, title?: string) {
  return {
    title: title ?? (error instanceof BaseError ? error.name : 'Error'),
    description: error instanceof BaseError ? (error.details ?? error.message) : error.message,
  }
}

export function toastError(error: Error, id: string, title?: string) {
  console.error(error)
  const formattedError = formatErrorForToast(error, title)
  toast.error(formattedError.title, {
    description: formattedError.description,
    id,
  })
}

export function formatBytes(bytes: bigint | number): string {
  const num = typeof bytes === 'bigint' ? Number(bytes) : bytes
  if (num === 0) return '0 B'

  const isNegative = num < 0
  const absNum = Math.abs(num)

  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB']
  const k = 1024
  const i = Math.floor(Math.log(absNum) / Math.log(k))
  const value = absNum / k ** i
  const formatted = `${value.toFixed(2).replace(/\.?0+$/, '')} ${units[i]}`

  return isNegative ? `-${formatted}` : formatted
}
