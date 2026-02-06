import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import * as z from 'zod'
import { GetDataSetError } from '../errors/pdp.ts'
import { zNumberToBigInt, zStringToCid } from '../utils/schemas.ts'

const PieceSchema = z.object({
  pieceCid: zStringToCid,
  pieceId: zNumberToBigInt,
  subPieceCid: zStringToCid,
  subPieceOffset: z.number(),
})

const DataSetSchema = z.object({
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
  }
  export type OutputType = DataSet
  export type ErrorType = GetDataSetError | TimeoutError | NetworkError | AbortError
}

/**
 * Get a data set from the PDP API.
 *
 * GET /pdp/data-sets/{dataSetId}
 *
 * @param options - {@link getDataSet.OptionsType}
 * @returns The data set from the PDP API. {@link getDataSet.OutputType}
 * @throws Errors {@link getDataSet.ErrorType}
 */
export async function getDataSet(options: getDataSet.OptionsType): Promise<getDataSet.OutputType> {
  const response = await request.json.get<getDataSet.OutputType>(
    new URL(`pdp/data-sets/${options.dataSetId}`, options.serviceURL)
  )
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new GetDataSetError(await response.error.response.text())
    }
    throw response.error
  }

  return DataSetSchema.parse(response.result)
}
