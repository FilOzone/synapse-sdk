import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import * as z from 'zod'
import { WaitForCreateDataSetError, WaitForCreateDataSetRejectedError } from '../errors/pdp.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { zHex, zNumberToBigInt } from '../utils/schemas.ts'

export const CreateDataSetPendingSchema = z.object({
  createMessageHash: zHex,
  dataSetCreated: z.literal(false),
  service: z.string(),
  txStatus: z.union([z.literal('pending'), z.literal('confirmed')]),
  ok: z.null(),
})

export const CreateDataSetRejectedSchema = z.object({
  createMessageHash: zHex,
  dataSetCreated: z.literal(false),
  service: z.string(),
  txStatus: z.literal('rejected'),
  ok: z.literal(false),
})

export const CreateDataSetSuccessSchema = z.object({
  createMessageHash: zHex,
  dataSetCreated: z.literal(true),
  service: z.string(),
  txStatus: z.literal('confirmed'),
  ok: z.literal(true),
  dataSetId: zNumberToBigInt,
})

export type CreateDataSetSuccess = z.infer<typeof CreateDataSetSuccessSchema>
export type CreateDataSetPending = z.infer<typeof CreateDataSetPendingSchema>
export type CreateDataSetRejected = z.infer<typeof CreateDataSetRejectedSchema>
export type CreateDataSetResponse = CreateDataSetPending | CreateDataSetRejected | CreateDataSetSuccess

const schema = z.discriminatedUnion('txStatus', [CreateDataSetRejectedSchema, CreateDataSetSuccessSchema])

export namespace waitForCreateDataSet {
  export type OptionsType = {
    /** The status URL to poll. */
    statusUrl: string
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }
  export type ReturnType = CreateDataSetSuccess
  export type ErrorType =
    | WaitForCreateDataSetError
    | WaitForCreateDataSetRejectedError
    | TimeoutError
    | NetworkError
    | AbortError
}
/**
 * Wait for the data set creation status.
 *
 * GET /pdp/data-sets/created({txHash})
 *
 * @param options - {@link waitForCreateDataSet.OptionsType}
 * @returns Status {@link waitForCreateDataSet.ReturnType}
 * @throws Errors {@link waitForCreateDataSet.ErrorType}
 */
export async function waitForCreateDataSet(
  options: waitForCreateDataSet.OptionsType
): Promise<waitForCreateDataSet.ReturnType> {
  const response = await request.json.get<CreateDataSetResponse>(options.statusUrl, {
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as CreateDataSetResponse
        if (data.dataSetCreated === false) {
          throw new Error('Still pending')
        }
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Still pending',
      retries: RETRY_CONSTANTS.RETRIES,
      factor: RETRY_CONSTANTS.FACTOR,
      minTimeout: options.pollInterval ?? RETRY_CONSTANTS.DELAY_TIME,
    },

    timeout: options.timeout ?? RETRY_CONSTANTS.MAX_RETRY_TIME,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new WaitForCreateDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  const data = schema.parse(response.result)
  if (data.txStatus === 'rejected') {
    throw new WaitForCreateDataSetRejectedError(data)
  }
  return data
}
