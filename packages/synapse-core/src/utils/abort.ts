import { AbortError } from 'iso-web/http'

/**
 * Throw iso-web's AbortError if the signal has already been aborted.
 *
 * Used before signing so an aborted call never triggers a wallet prompt.
 * Unlike `AbortSignal.prototype.throwIfAborted`, it throws the same AbortError
 * the HTTP requests reject with.
 *
 * Internal helper, not exported from `@filoz/synapse-core/utils`.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AbortError(signal)
  }
}
