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

/**
 * Reject with iso-web's AbortError when the signal aborts, otherwise settle like the promise.
 *
 * The underlying work is not cancelled, only the wait for it.
 *
 * Internal helper, not exported from `@filoz/synapse-core/utils`.
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal == null) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new AbortError(signal))
      return
    }
    const onAbort = () => reject(new AbortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}
