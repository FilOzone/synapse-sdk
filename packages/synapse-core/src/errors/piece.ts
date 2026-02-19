import { isSynapseError, SynapseError, type SynapseErrorOptions } from './base.ts'

export class InvalidPieceCIDError extends SynapseError {
  override name: 'InvalidPieceCIDError' = 'InvalidPieceCIDError'

  constructor(input: unknown, options?: SynapseErrorOptions) {
    let msg = 'Invalid piece CID.'
    if (typeof input === 'object' && input != null && 'toString' in input && typeof input.toString === 'function') {
      msg = `Invalid piece CID: ${input.toString()}`
    } else if (typeof input === 'string') {
      msg = `Invalid piece CID: ${input}`
    }
    super(msg, options)
  }

  static override is(value: unknown): value is InvalidPieceCIDError {
    return isSynapseError(value) && value.name === 'InvalidPieceCIDError'
  }
}
