import * as z from 'zod'

const symbol = Symbol.for('synapse-error')

export interface SynapseErrorOptions extends ErrorOptions {
  cause?: Error
  details?: string
}

/**
 * Check if a value is a SynapseError
 *
 */
export function isSynapseError(value: unknown): value is SynapseError {
  return value instanceof Error && symbol in value
}

export class SynapseError extends Error {
  [symbol]: boolean = true

  override name = 'SynapseError'
  override cause?: Error
  details?: string
  shortMessage: string

  constructor(message: string, options?: SynapseErrorOptions) {
    // Use explicit details if provided, otherwise fall back to cause.message
    const details = options?.details
      ? options.details
      : options?.cause instanceof Error
        ? options.cause.message
        : undefined

    const msg = [
      message || 'An error occurred.',
      ...(details ? [''] : []),
      ...(details ? [`Details: ${details}`] : []),
    ].join('\n')
    super(msg, options)

    this.cause = options?.cause ?? undefined
    this.details = details ?? undefined
    this.shortMessage = message
  }

  static is(value: unknown): value is SynapseError {
    return isSynapseError(value) && value.name === 'SynapseError'
  }
}

/**
 * Validation error thrown when a value does not match the expected Zod schema.
 */
export class ZodValidationError extends SynapseError {
  override name: 'ZodValidationError' = 'ZodValidationError'

  constructor(zodError: z.ZodError, message: string = 'Validation failed.') {
    super(message, {
      cause: zodError,
      details: z.prettifyError(zodError),
    })
  }

  static override is(value: unknown): value is ZodValidationError {
    return isSynapseError(value) && value.name === 'ZodValidationError'
  }
}

export class ValidationError extends SynapseError {
  override name: 'ValidationError' = 'ValidationError'

  static override is(value: unknown): value is ValidationError {
    return isSynapseError(value) && value.name === 'ValidationError'
  }
}
