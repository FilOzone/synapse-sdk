/**
 * Utility function to create descriptive errors with context
 */
export function createError (prefix: string, operation: string, details: string, originalError?: unknown): Error {
  let baseMessage = `${prefix} ${operation} failed: ${details}`

  // If there's an original error, append its message to provide full context
  if (originalError != null && originalError instanceof Error) {
    baseMessage = `${baseMessage} - ${originalError.message}`
  }

  if (originalError != null) {
    return new Error(baseMessage, { cause: originalError })
  }

  return new Error(baseMessage)
}
