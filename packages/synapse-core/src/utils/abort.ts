import { AbortError } from 'iso-web/http'
import type { Transport } from 'viem'

/**
 * Throw iso-web's AbortError if the signal has already been aborted.
 *
 * Used before signing so an aborted call never triggers a wallet prompt.
 * Unlike `AbortSignal.prototype.throwIfAborted`, it throws the same AbortError
 * the HTTP requests reject with.
 */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new AbortError(signal)
  }
}

/**
 * Reject with iso-web's AbortError when the signal aborts, otherwise settle like the promise.
 *
 * The underlying work is not cancelled, only the wait for it. Use it to cancel waits that take no
 * signal, such as viem's `waitForTransactionReceipt`, and to get a plain AbortError from contract
 * reads on a {@link withSignal} client, which viem wraps in `ContractFunctionExecutionError`.
 *
 * @example
 * ```ts
 * import { abortable } from '@filoz/synapse-core/utils'
 * import { getPdpDataSet } from '@filoz/synapse-core/warm-storage'
 *
 * const dataSet = await abortable(getPdpDataSet(client, { dataSetId: 1n }), signal)
 * ```
 */
export function abortable<T>(promise: Promise<T>, signal: AbortSignal | undefined): Promise<T> {
  if (signal == null) {
    return promise
  }
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      // the promise is abandoned, so a later rejection must not surface as unhandled
      promise.catch(() => undefined)
      reject(new AbortError(signal))
      return
    }
    const onAbort = () => reject(new AbortError(signal))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort))
  })
}

/**
 * Wrap a viem transport so its requests reject with iso-web's AbortError once the signal aborts.
 *
 * Unlike passing `fetchOptions.signal` to viem's `http` transport, this keeps the transport's own
 * request timeout and retries. For the default Filecoin transports, `getTransport(chain, { signal })`
 * does this for you. Requests in flight are not cancelled, only the wait for them; requests
 * made after the signal aborted reject without being sent.
 *
 * Limits:
 * - Contract reads reject with viem's `ContractFunctionExecutionError`, with the AbortError in its
 *   `cause` chain. Wrap the call in {@link abortable} to reject with the AbortError itself.
 * - The transport's retries for a request in flight keep sending after the abort; the caller only
 *   stops waiting for them.
 * - viem's `waitForTransactionReceipt` swallows polling errors, so on a `withSignal` client it runs
 *   until its timeout. Wrap receipt waits in {@link abortable} instead.
 *
 * @example
 * ```ts
 * import { createPublicClient, http } from 'viem'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { withSignal } from '@filoz/synapse-core/utils'
 *
 * const controller = new AbortController()
 * const client = createPublicClient({
 *   chain: calibration,
 *   transport: withSignal(http('https://my-rpc.example.com'), controller.signal),
 * })
 * ```
 *
 * @param transport - The transport to wrap.
 * @param signal - The signal to abort requests. The transport is returned as is when undefined.
 * @returns The wrapped transport.
 */
export function withSignal<transport extends Transport>(
  transport: transport,
  signal: AbortSignal | undefined
): transport {
  if (signal == null) {
    return transport
  }
  return ((params: Parameters<Transport>[0]) => {
    const result = transport(params)
    // async so an aborted signal rejects the returned promise instead of throwing synchronously
    const request: typeof result.request = async (args, options) => {
      throwIfAborted(signal)
      return abortable(result.request(args, options), signal)
    }
    return { ...result, request }
  }) as transport
}
