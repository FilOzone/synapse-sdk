import { HttpError, request } from 'iso-web/http'
import {
  type Account,
  type Address,
  type Chain,
  type Client,
  type EncodeAbiParametersErrorType,
  type Hex,
  isHex,
  type SignTypedDataErrorType,
  type Transport,
} from 'viem'
import * as z from 'zod'
import { asChain } from '../chains.ts'
import { CreateDataSetError, LocationHeaderError } from '../errors/index.ts'
import { WaitForCreateDataSetError, WaitForCreateDataSetRejectedError } from '../errors/pdp.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { datasetMetadataObjectToEntry, type MetadataObject } from '../utils/metadata.ts'
import { zHex, zNumberToBigInt } from '../utils/schemas.ts'
import type { AbortError, NetworkError, TimeoutError } from './index.ts'

export namespace createDataSetApiRequest {
  /**
   * The options for the create data set on PDP API.
   */
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set. */
    extraData: Hex
  }

  export type OutputType = {
    txHash: Hex
    statusUrl: string
  }

  export type ErrorType = CreateDataSetError | LocationHeaderError | TimeoutError | NetworkError | AbortError

  export type RequestBody = {
    recordKeeper: Address
    extraData: Hex
  }
}

/**
 * Create a data set on PDP API
 *
 * POST /pdp/data-sets
 *
 * @param options - {@link createDataSet.OptionsType}
 * @returns Transaction hash and status URL. {@link createDataSet.OutputType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSetApiRequest(
  options: createDataSetApiRequest.OptionsType
): Promise<createDataSetApiRequest.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets`, options.serviceURL), {
    body: JSON.stringify({
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
    }),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new CreateDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  const location = response.result.headers.get('Location')
  const hash = location?.split('/').pop()
  if (!location || !hash || !isHex(hash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: hash,
    statusUrl: new URL(location, options.serviceURL).toString(),
  }
}

export namespace createDataSet {
  export type OptionsType = {
    /** Whether the data set should use CDN. */
    cdn: boolean
    /** The address that will receive payments (service provider). */
    payee: Address
    /** The service URL of the PDP API. */
    serviceURL: string
    /**
     * The address that will pay for the storage (client). If not provided, the default is the client address.
     * If client is from a session key this should be set to the actual payer address
     */
    payer?: Address
    /** The metadata for the data set. */
    metadata?: MetadataObject
    /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
    clientDataSetId?: bigint
    /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
    recordKeeper?: Address
  }
  export type ReturnType = createDataSetApiRequest.OutputType
  export type ErrorType =
    | createDataSetApiRequest.ErrorType
    | asChain.ErrorType
    | SignTypedDataErrorType
    | EncodeAbiParametersErrorType
}

/**
 * Create a data set
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link createDataSet.OptionsType}
 * @returns Transaction hash and status URL. {@link createDataSet.ReturnType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSet(client: Client<Transport, Chain, Account>, options: createDataSet.OptionsType) {
  const chain = asChain(client.chain)

  // Sign and encode the create data set message
  const extraData = await signCreateDataSet(client, {
    clientDataSetId: options.clientDataSetId,
    payee: options.payee,
    payer: options.payer,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn,
    }),
  })

  return createDataSetApiRequest({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData,
  })
}

/**
 * Schema for the create data set pending response.
 */
export const CreateDataSetPendingSchema = z.object({
  createMessageHash: zHex,
  dataSetCreated: z.literal(false),
  service: z.string(),
  txStatus: z.union([z.literal('pending'), z.literal('confirmed')]),
  ok: z.null(),
})

/**
 * Schema for the create data set rejected response.
 */
export const CreateDataSetRejectedSchema = z.object({
  createMessageHash: zHex,
  dataSetCreated: z.literal(false),
  service: z.string(),
  txStatus: z.literal('rejected'),
  ok: z.literal(false),
})

/**
 * Schema for the create data set success response.
 */
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
