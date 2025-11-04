const symbol = Symbol.for('synapse-error')

interface SynapseErrorOptions extends ErrorOptions {
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
    const details =
      options?.cause instanceof Error ? options.cause.message : options?.details ? options.details : undefined

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
