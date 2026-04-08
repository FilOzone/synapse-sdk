import type { BaseError } from 'viem'

/**
 * FOC contracts errors strings
 */
export const STRING_ERRORS = {
  PDP_VERIFIER_DATA_SET_NOT_LIVE: 'Data set not live',
} as const

/**
 * FOC contracts errors types
 */
export type StringErrorType = (typeof STRING_ERRORS)[keyof typeof STRING_ERRORS]

/**
 * Check if the error is a viem error
 */
export function isViemError(error: unknown): error is BaseError {
  return (
    error instanceof Error &&
    'walk' in error &&
    'details' in error &&
    'shortMessage' in error &&
    error.message.includes('Version: viem@')
  )
}

/**
 * Check if the error message equals the expected string
 */
export function stringErrorEquals(error: unknown, expected: StringErrorType): boolean {
  if (!isViemError(error)) return false

  // Try viem reason extraction
  if ('cause' in error && error.cause instanceof Error && 'reason' in error.cause) {
    return error.cause.reason === expected
  }

  // Fallback to regex extraction
  const regex = /(?:vm error|revert reason)=\[(.*?)\]/g
  const matches = error.message.matchAll(regex)
  for (const match of matches) {
    const extractedContent = match[1]
    if (extractedContent?.startsWith('Error(')) {
      return extractedContent.replace('Error(', '').replace(')', '') === expected
    }
  }
  return false
}
