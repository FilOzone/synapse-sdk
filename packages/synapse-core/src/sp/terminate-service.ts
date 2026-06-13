import { HttpError, type RequestErrors, type RequestJsonErrors, request, SchemaError } from 'iso-web/http'
import type {
  Account,
  Chain,
  Client,
  EncodeAbiParametersErrorType,
  Hash,
  Hex,
  SignTypedDataErrorType,
  Transport,
} from 'viem'
import * as z from 'zod'
import type { asChain } from '../chains.ts'
import {
  ServiceAlreadyTerminatedError,
  TerminateServiceError,
  TerminateServiceNotSupportedError,
  TerminateServicePendingError,
  WaitForTerminateServiceError,
  WaitForTerminateServiceNotFoundError,
  WaitForTerminateServiceRejectedError,
} from '../errors/pdp.ts'
import { signTerminateService } from '../typed-data/sign-terminate-service.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { zHex, zNumberToBigInt } from '../utils/schemas.ts'

/*
SP-side termination protocol, as observed through the HTTP API.

POST /pdp/data-sets/{id}/terminate
  Queues the signed request and returns 202 with no body; the SP relays
  FWSS.terminateService(dataSetId, extraData) asynchronously. A valid client
  signature submitted by the SP is FWSS's consent case: termination is
  immediate (endEpoch ~ current) and a termination fee is drawn from the
  payer; the tx reverts instead if the payer cannot settle in full.

  409 JSON {code: 0} -> DataSetAlreadyTerminatedError
  409 JSON {code: 1} -> TerminateServicePendingError
  503 (FWSS predates client termination) -> TerminateServiceNotSupportedError

GET /pdp/data-sets/{id}/terminate (the status URL; valid immediately after the 202)
  queued    {terminationTxHash: "", fwssTerminated: null}
  sent      {terminationTxHash: "0x...", fwssTerminated: null}
  done      {terminationTxHash: "0x..." or "", fwssTerminated: true, serviceTerminationEpoch: 4567}
  reverted  if we get a hash and then get a 404, the tx was rejected
  404       failed relays are discarded so the client can re-POST; also the
            response for SP-initiated terminations (only client-requested ones
            are visible) and, eventually, for fully cleaned-up data sets.

  Reverted and 404 are two observations of the same outcome (the SP discards a
  failed relay shortly after it lands): retry, or terminate on-chain. Success
  may carry an empty hash (the SP found the service already terminated and
  sent no tx), and fwssTerminated: true wins over txSuccess: false (a
  competing terminate landed first; the goal state holds). When no terminate
  tx ever lands, ours or anyone's (e.g. the SP is unable to send), there is no
  terminal signal: the status stays queued and the poller runs to its timeout.
*/

/**
 * Schema for the termination conflict response.
 */
const TerminateConflictSchema = z.discriminatedUnion('code', [
  // The service was already terminated on chain.
  z.object({
    code: z.literal(0),
    message: z.string(),
    serviceTerminationEpoch: z.number(),
  }),
  // A termination request is already queued.
  z.object({
    code: z.literal(1),
    message: z.string(),
    serviceTerminationEpoch: z.null(),
  }),
])

/**
 * Build the termination status URL for a data set, pollable with
 * {@link waitForTerminateService}. Useful for resuming tracking of a
 * previously requested termination.
 */
export function terminateServiceStatusUrl(options: { serviceURL: string; dataSetId: bigint }): string {
  return new URL(`pdp/data-sets/${options.dataSetId}/terminate`, options.serviceURL).toString()
}

export namespace terminateServiceApiRequest {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set to terminate. */
    dataSetId: bigint
    /** The extra data carrying the signed termination authorization. {@link TypedData.signTerminateService} */
    extraData: Hex
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }

  export type OutputType = {
    /** The status URL to poll with {@link waitForTerminateService}. */
    statusUrl: string
  }

  export type ErrorType =
    | TerminateServiceError
    | ServiceAlreadyTerminatedError
    | TerminateServicePendingError
    | TerminateServiceNotSupportedError
    | RequestErrors

  export type RequestBody = {
    extraData: Hex
  }
}

/**
 * Request data set termination on the PDP API.
 *
 * POST /pdp/data-sets/{dataSetId}/terminate
 *
 * The provider queues the request and relays it on chain asynchronously; a 202
 * response carries no transaction hash. Poll {@link waitForTerminateService}
 * for the hash and confirmation.
 *
 * @param options - {@link terminateServiceApiRequest.OptionsType}
 * @returns Status URL {@link terminateServiceApiRequest.OutputType}
 * @throws Errors {@link terminateServiceApiRequest.ErrorType}
 */
export async function terminateServiceApiRequest(
  options: terminateServiceApiRequest.OptionsType
): Promise<terminateServiceApiRequest.OutputType> {
  const statusUrl = terminateServiceStatusUrl(options)
  const result = await request.post(statusUrl, {
    json: {
      extraData: options.extraData,
    },
    timeout: RETRY_CONSTANTS.TIMEOUT,
    retry: {
      methods: ['post'],
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
      shouldRetry: (ctx) => HttpError.is(ctx.error) && ctx.error.code === 429,
    },
  })

  if (result.error) {
    if (HttpError.is(result.error)) {
      switch (result.error.code) {
        case 409: {
          const error = TerminateConflictSchema.safeParse(await result.error.response.json())
          if (!error.success) {
            throw new SchemaError({ issues: error.error.issues, response: result.error.response })
          }
          if (error.data.code === 0) {
            throw new ServiceAlreadyTerminatedError(BigInt(error.data.serviceTerminationEpoch))
          } else {
            throw new TerminateServicePendingError()
          }
        }
        case 503:
          throw new TerminateServiceNotSupportedError(await result.error.response.text())
        default:
          throw new TerminateServiceError(await result.error.response.text())
      }
    }
    throw result.error
  }

  return { statusUrl }
}

export namespace terminateService {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set to terminate. */
    dataSetId: bigint
    /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
    extraData?: Hex
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }
  export type OutputType = terminateServiceApiRequest.OutputType
  export type ErrorType =
    | terminateServiceApiRequest.ErrorType
    | asChain.ErrorType
    | SignTypedDataErrorType
    | EncodeAbiParametersErrorType
}

/**
 * Terminate a data set service via the service provider
 *
 * Signs a termination authorization and sends it to the provider, which relays
 * it on chain. Provider-relayed termination takes effect immediately when the
 * transaction lands (no lockup wind-down); it fails instead if the payer's
 * account cannot settle in full. The direct on-chain alternative
 * (`warm-storage/terminate-service`) needs no provider cooperation but the
 * service runs to the end of the lockup period.
 *
 * @param client - The client to use to sign the termination authorization.
 * @param options - {@link terminateService.OptionsType}
 * @returns Status URL to poll with {@link waitForTerminateService}. {@link terminateService.OutputType}
 * @throws Errors {@link terminateService.ErrorType}
 *
 * @example
 * ```ts
 * import { terminateService, waitForTerminateService } from '@filoz/synapse-core/sp'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const { statusUrl } = await terminateService(client, {
 *   dataSetId: 1n,
 *   serviceURL: 'https://pdp.example.com',
 * })
 * const status = await waitForTerminateService({ statusUrl })
 * console.log(status.serviceTerminationEpoch)
 * ```
 */
export async function terminateService(
  client: Client<Transport, Chain, Account>,
  options: terminateService.OptionsType
): Promise<terminateService.OutputType> {
  const extraData = options.extraData ?? (await signTerminateService(client, { dataSetId: options.dataSetId }))
  return terminateServiceApiRequest({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    extraData,
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
  })
}

/**
 * Schema for the termination status while the provider's transaction is pending.
 * The hash is empty until the provider's relay task sends the transaction.
 */
export const TerminateServiceStatusPendingSchema = z.object({
  terminationTxHash: z.union([zHex, z.literal('')]),
  fwssTerminated: z.null(),
  serviceTerminationEpoch: z.null(),
})

/**
 * Schema for the confirmed termination status. The hash may be empty when the
 * service was already terminated on chain without a provider transaction.
 */
export const TerminateServiceStatusSuccessSchema = z.object({
  terminationTxHash: z.union([zHex, z.literal('')]),
  fwssTerminated: z.literal(true),
  serviceTerminationEpoch: zNumberToBigInt,
})

export type TerminateServiceStatusPending = z.infer<typeof TerminateServiceStatusPendingSchema>
export type TerminateServiceStatusSuccess = z.infer<typeof TerminateServiceStatusSuccessSchema>
export type TerminateServiceStatusResponse = TerminateServiceStatusPending | TerminateServiceStatusSuccess

// Validates only the FINAL response; intermediate pending bodies are inspected
// (and polling continued) by shouldPoll below, without schema validation.
const schema = TerminateServiceStatusSuccessSchema

export namespace waitForTerminateService {
  export type OptionsType = {
    /** The status URL to poll. */
    statusUrl: string
    /** Called once with the provider's transaction hash as soon as it is known. */
    onHash?: (hash: Hash) => void
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
    /** The poll interval in milliseconds. Defaults to {@link RETRY_CONSTANTS.POLL_INTERVAL}. */
    pollInterval?: number
  }
  export type OutputType = TerminateServiceStatusSuccess
  export type ErrorType =
    | WaitForTerminateServiceError
    | WaitForTerminateServiceNotFoundError
    | WaitForTerminateServiceRejectedError
    | RequestJsonErrors
}

/**
 * Wait for the data set termination status.
 *
 * GET /pdp/data-sets/{dataSetId}/terminate
 *
 * Polls until the provider's transaction confirms and the termination epoch is
 * recorded.
 *
 * @param options - {@link waitForTerminateService.OptionsType}
 * @returns Status {@link waitForTerminateService.OutputType}
 * @throws Errors {@link waitForTerminateService.ErrorType}
 */
export async function waitForTerminateService(
  options: waitForTerminateService.OptionsType
): Promise<waitForTerminateService.OutputType> {
  let hash: Hash | undefined
  const response = await request.json.get(options.statusUrl, {
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
    poll: {
      limit: RETRY_CONSTANTS.POLL_LIMIT,
      interval: options.pollInterval ?? RETRY_CONSTANTS.POLL_INTERVAL,
      statusCodes: [200],
      shouldPoll: async (ctx) => {
        const data = (await ctx.response.clone().json()) as TerminateServiceStatusResponse
        if (!hash && data.terminationTxHash !== '') {
          hash = data.terminationTxHash
          options.onHash?.(data.terminationTxHash)
        }
        return data.fwssTerminated === null
      },
    },
    timeout: options.timeout ?? RETRY_CONSTANTS.TIMEOUT,
    schema,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      if (response.error.code === 404 && hash === undefined) {
        throw new WaitForTerminateServiceNotFoundError()
      }
      if (response.error.code === 404 && hash !== undefined) {
        throw new WaitForTerminateServiceRejectedError(hash)
      }
      throw new WaitForTerminateServiceError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result
}
