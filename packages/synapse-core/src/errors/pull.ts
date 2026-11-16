import { isSynapseError } from './base.ts'
import { ProviderError, type ProviderErrorOptions } from './provider.ts'

/**
 * A pull request to the storage provider failed.
 *
 * When the provider answered with an HTTP error, {@link ProviderError.status} tells why. Curio answers
 * 400 when a request has more than 108 pieces (split the batch), 429 when its pull queue is full
 * (wait and retry), and 5xx when the pull fails.
 */
export class PullError extends ProviderError {
  override name: 'PullError' = 'PullError'

  constructor(error: string, options?: ProviderErrorOptions) {
    super(`Failed to pull pieces from storage provider.`, error, options)
  }

  static override is(value: unknown): value is PullError {
    return isSynapseError(value) && value.name === 'PullError'
  }
}
