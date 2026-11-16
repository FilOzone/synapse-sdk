import type { HttpError } from 'iso-web/http'
import { decodePDPError } from '../utils/decode-pdp-errors.ts'
import { isSynapseError, SynapseError } from './base.ts'

const symbol = Symbol.for('synapse-provider-error')

export interface ProviderErrorOptions {
  /** The underlying request error, such as an `HttpError` or `TimeoutError`. */
  cause?: Error
  /** The HTTP status the service provider answered with. */
  status?: number
}

/**
 * Base class for errors raised when a service provider request fails.
 *
 * When the provider answered with a non-2xx response, {@link ProviderError.status} holds the HTTP
 * status and `cause` the `HttpError`, so callers can tell a client problem (4xx) from one worth
 * retrying (429, 5xx) without parsing the message.
 */
export class ProviderError extends SynapseError {
  [symbol]: boolean = true

  override name = 'ProviderError'
  /** The HTTP status the service provider answered with. `undefined` when the failure was not an HTTP response. */
  status?: number
  /** `true` when the service provider answered 404. */
  notFound: boolean

  constructor(message: string, error: string, options: ProviderErrorOptions = {}) {
    super(message, {
      details: decodePDPError(error),
      cause: options.cause,
    })
    this.status = options.status
    this.notFound = options.status === 404
  }

  override toJSON(): Record<string, unknown> {
    return {
      ...super.toJSON(),
      ...(this.status === undefined ? {} : { status: this.status }),
    }
  }

  /**
   * Build the error from an `HttpError`, keeping the response status and the `HttpError` as `cause`.
   * The response body becomes `details`, or `HTTP <status>` when the body is empty.
   *
   * @example
   * ```ts
   * throw await PullError.fromHttpError(response.error)
   * ```
   */
  static async fromHttpError<T>(
    this: new (
      error: string,
      options: ProviderErrorOptions
    ) => T,
    error: HttpError
  ): Promise<T> {
    const { status } = error.response
    const body = await error.response.text().catch(() => '')
    return new this(body || `HTTP ${status}`, { cause: error, status })
  }

  /** Check if a value is a {@link ProviderError} or one of its subclasses. */
  static override is(value: unknown): value is ProviderError {
    return isSynapseError(value) && symbol in value
  }
}
