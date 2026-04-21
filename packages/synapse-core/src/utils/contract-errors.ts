import type { BaseError } from 'viem'

/**
 * FOC contracts errors strings
 */
export const STRING_ERRORS = {
  PDP_VERIFIER_DATA_SET_NOT_LIVE: 'Data set not live',
  /**
   * Revert raised by `ServiceProviderRegistry.providerExists` when the given
   * provider ID is `0` or greater than `numProviders`.
   */
  SP_REGISTRY_PROVIDER_DOES_NOT_EXIST: 'Provider does not exist',
  /**
   * Revert raised by `ServiceProviderRegistry.providerExists` when the given
   * provider ID is within range but the underlying storage slot has no
   * associated service provider address (e.g. after removal).
   */
  SP_REGISTRY_PROVIDER_NOT_FOUND: 'Provider not found',
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
  const reasonError = error.walk((cause) => cause instanceof Error && 'reason' in cause)
  if (reasonError && typeof reasonError === 'object' && 'reason' in reasonError) {
    return reasonError.reason === expected
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

/**
 * Check whether the given error is a revert emitted by the
 * `ServiceProviderRegistry.providerExists` modifier (i.e. the provider ID is
 * out of range or maps to an unoccupied storage slot).
 */
export function isProviderExistsRevert(error: unknown): boolean {
  return (
    stringErrorEquals(error, STRING_ERRORS.SP_REGISTRY_PROVIDER_DOES_NOT_EXIST) ||
    stringErrorEquals(error, STRING_ERRORS.SP_REGISTRY_PROVIDER_NOT_FOUND)
  )
}
