import { decodePDPError } from '../utils/decode-pdp-errors.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class PullError extends SynapseError {
  override name: 'PullError' = 'PullError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to pull pieces from storage provider.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is PullError {
    return isSynapseError(value) && value.name === 'PullError'
  }
}
