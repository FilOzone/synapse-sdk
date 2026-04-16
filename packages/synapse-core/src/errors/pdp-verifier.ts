import { isSynapseError, SynapseError } from './base.ts'

export class LimitMustBeGreaterThanZeroError extends SynapseError {
  override name: 'LimitMustBeGreaterThanZeroError' = 'LimitMustBeGreaterThanZeroError'
  constructor() {
    super('Limit must be greater than zero')
  }

  static override is(value: unknown): value is LimitMustBeGreaterThanZeroError {
    return isSynapseError(value) && value.name === 'LimitMustBeGreaterThanZeroError'
  }
}
