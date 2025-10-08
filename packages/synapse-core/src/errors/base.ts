import type { UnsupportedChainError } from './chains.ts'

const symbol = Symbol.for('synapse-error')

interface SynapseErrorOptions extends ErrorOptions {
  cause?: Error
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

  constructor(message: string, options?: SynapseErrorOptions) {
    const causeString = options?.cause instanceof Error ? options.cause.message : undefined

    const msg = [message || 'Unknown error', ...(causeString ? [`Cause: ${causeString}`] : [])].join('\n')
    super(msg, options)
    this.cause = options?.cause ?? undefined
  }

  static is(value: unknown): value is SynapseError {
    return isSynapseError(value) && value.name === 'SynapseError'
  }
}
