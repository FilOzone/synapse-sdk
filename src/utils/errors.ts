/**
 * Utility function to create descriptive errors with context
 */
export function createError (prefix: string, operation: string, details: string, originalError?: unknown): Error {
  const baseMessage = `${prefix} ${operation} failed: ${details}`

  if (originalError != null) {
    return new Error(baseMessage, { cause: originalError })
  }

  return new Error(baseMessage)
}
