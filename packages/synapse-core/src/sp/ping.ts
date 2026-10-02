import { type AbortError, type HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'

const DEFAULT_TIMEOUT = 8000
const RETRY_COUNT = 2
const RETRY_DELAY = 500

export namespace ping {
  export type OptionsType = {
    /** Total timeout for the ping request and its retries, in milliseconds. Defaults to 8 seconds. */
    timeout?: number
    /** The signal to abort the request. */
    signal?: AbortSignal
  }
  export type OutputType = Response
  export type ErrorType = AbortError | HttpError | NetworkError | TimeoutError
}

/**
 * Ping the PDP API.
 *
 * GET /pdp/ping
 *
 * @param serviceURL - The service URL of the PDP API.
 * @param options - Optional timeout and abort signal.
 * @returns Response {@link ping.OutputType}
 * @throws Errors {@link ping.ErrorType}
 */
export async function ping(serviceURL: string, options: ping.OptionsType = {}): Promise<ping.OutputType> {
  const response = await request.get(new URL(`pdp/ping`, serviceURL), {
    retry: {
      retries: RETRY_COUNT,
      minTimeout: RETRY_DELAY,
    },
    signal: options.signal,
    timeout: options.timeout ?? DEFAULT_TIMEOUT,
  })
  if (response.error) {
    throw response.error
  }
  return response.result
}
