import { decodePDPError } from '../utils/decode-pdp-errors.ts'
import { isSynapseError, SynapseError } from './base.ts'

export class SPFetchError extends SynapseError {
  override name: 'SPFetchError' = 'SPFetchError'

  constructor(error: string) {
    const decodedError = decodePDPError(error)
    super(`Failed to fetch pieces from storage provider.`, {
      details: decodedError,
    })
  }

  static override is(value: unknown): value is SPFetchError {
    return isSynapseError(value) && value.name === 'SPFetchError'
  }
}
