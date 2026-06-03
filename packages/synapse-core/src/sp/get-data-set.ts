import { HttpError, type RequestJsonErrors, request } from 'iso-web/http'
import * as z from 'zod'
import { GetDataSetError } from '../errors/pdp.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { zNumberToBigInt, zStringToCid } from '../utils/schemas.ts'

const PieceSchema = z.object({
  pieceCid: zStringToCid,
  pieceId: zNumberToBigInt,
  subPieceCid: zStringToCid,
  subPieceOffset: z.number(),
})

export const DataSetSchema = z.object({
  id: zNumberToBigInt,
  nextChallengeEpoch: z.number(),
  pieces: z.array(PieceSchema),
})

/**
 * Data set from the PDP API.
 */
export type DataSet = z.infer<typeof DataSetSchema>

export namespace getDataSet {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to 250ms. */
    retryDelay?: number
  }
  export type OutputType = DataSet
  export type ErrorType = GetDataSetError | RequestJsonErrors
}

/**
 * Get a data set from the PDP API.
 *
 * GET /pdp/data-sets/{dataSetId}
 *
 * @deprecated Use {@link getPdpDataSet} instead.
 * @param options - {@link getDataSet.OptionsType}
 * @returns The data set from the PDP API. {@link getDataSet.OutputType}
 * @throws Errors {@link getDataSet.ErrorType}
 */
export async function getDataSet(options: getDataSet.OptionsType): Promise<getDataSet.OutputType> {
  const response = await request.json.get(new URL(`pdp/data-sets/${options.dataSetId}`, options.serviceURL), {
    timeout: RETRY_CONSTANTS.TIMEOUT,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
    schema: DataSetSchema,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new GetDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  return response.result
}
