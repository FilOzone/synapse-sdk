import type { AbortError } from 'iso-web/http'
import { ping } from './ping.ts'

export namespace isReachable {
  export type OptionsType = ping.OptionsType
  export type OutputType = boolean
  export type ErrorType = AbortError
}

/**
 * Check whether a provider's PDP API answers a ping.
 *
 * GET /pdp/ping
 *
 * Returns `false` instead of throwing when {@link ping} fails with an HTTP, network or timeout error.
 * Still throws `AbortError` when the signal aborts.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 *
 * if (await SP.isReachable('https://pdp.example.com', { timeout: 5000 })) {
 *   console.log('provider is up')
 * }
 * ```
 *
 * @param serviceURL - The service URL of the PDP API.
 * @param options - {@link isReachable.OptionsType}
 * @returns Whether the provider answered {@link isReachable.OutputType}
 * @throws Errors {@link isReachable.ErrorType}
 */
export async function isReachable(
  serviceURL: string,
  options: isReachable.OptionsType = {}
): Promise<isReachable.OutputType> {
  try {
    await ping(serviceURL, options)
    return true
  } catch (error) {
    if (options.signal?.aborted) {
      throw error
    }
    return false
  }
}
