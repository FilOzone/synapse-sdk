import { HttpError, type RequestErrors, request } from 'iso-web/http'
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
import { asChain } from '../chains.ts'
import { CreateDataSetError, LocationHeaderError } from '../errors/index.ts'
import { signCreateDataSet } from '../typed-data/sign-create-dataset.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { datasetMetadataObjectToEntry, type MetadataObject } from '../utils/metadata.ts'

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
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }

  export type OutputType = {
    /** The original transaction hash. May not be the hash that lands on chain if Curio replaces the message by fee. */
    txHash: Hex
    /**
     * The signed extra data that was submitted. Persist it with `txHash` to wait with
     * `waitForCreateDataSet` or to recover with `getCreateDataSetResult` after a crash.
     * If nothing landed, resubmit this same extra data: FWSS rejects a reused client data set ID, so it can never create a second data set.
     */
    extraData: Hex
  }

  export type ErrorType = CreateDataSetError | LocationHeaderError | RequestErrors

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
 * @returns Transaction hash and extra data. {@link createDataSet.OutputType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSetApiRequest(
  options: createDataSetApiRequest.OptionsType
): Promise<createDataSetApiRequest.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets`, options.serviceURL), {
    json: {
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
    },
    signal: options.signal,
    timeout: RETRY_CONSTANTS.TIMEOUT,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
      shouldRetry: (ctx) => HttpError.is(ctx.error) && ctx.error.code === 429,
    },
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
    extraData: options.extraData,
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
     * The address that will pay for the storage (client). If not provided, the default is the root address
     * for a session key client, otherwise the client address.
     */
    payer?: Address
    /** The metadata for the data set. */
    metadata?: MetadataObject
    /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
    clientDataSetId?: bigint
    /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
    recordKeeper?: Address
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
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
 * @returns Transaction hash and extra data. {@link createDataSet.ReturnType}
 * @throws Errors {@link createDataSet.ErrorType}
 */
export async function createDataSet(client: Client<Transport, Chain, Account>, options: createDataSet.OptionsType) {
  throwIfAborted(options.signal)
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
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
    signal: options.signal,
  })
}
