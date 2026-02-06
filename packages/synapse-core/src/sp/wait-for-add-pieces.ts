import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import * as z from 'zod'
import { WaitForAddPiecesError, WaitForAddPiecesRejectedError } from '../errors/pdp.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { zHex, zNumberToBigInt } from '../utils/schemas.ts'

export const AddPiecesPendingSchema = z.object({
  txHash: zHex,
  txStatus: z.literal('pending'),
  dataSetId: zNumberToBigInt,
  pieceCount: z.number(),
  addMessageOk: z.null(),
  piecesAdded: z.literal(false),
})

export const AddPiecesRejectedSchema = z.object({
  txHash: zHex,
  txStatus: z.literal('rejected'),
  dataSetId: zNumberToBigInt,
  pieceCount: z.number(),
  addMessageOk: z.null(),
  piecesAdded: z.literal(false),
})

export const AddPiecesSuccessSchema = z.object({
  txHash: zHex,
  txStatus: z.literal('confirmed'),
  dataSetId: zNumberToBigInt,
  pieceCount: z.number(),
  addMessageOk: z.literal(true),
  piecesAdded: z.literal(true),
  confirmedPieceIds: z.array(zNumberToBigInt),
})

export type AddPiecesPending = z.infer<typeof AddPiecesPendingSchema>
export type AddPiecesRejected = z.infer<typeof AddPiecesRejectedSchema>
export type AddPiecesSuccess = z.infer<typeof AddPiecesSuccessSchema>
export type AddPiecesResponse = AddPiecesRejected | AddPiecesSuccess | AddPiecesPending
export type AddPiecesOutput = AddPiecesSuccess

const schema = z.discriminatedUnion('txStatus', [AddPiecesRejectedSchema, AddPiecesSuccessSchema])

export namespace waitForAddPieces {
  export type OptionsType = {
    /** The status URL to poll. */
    statusUrl: string
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }
  export type OutputType = AddPiecesOutput
  export type ErrorType =
    | WaitForAddPiecesError
    | WaitForAddPiecesRejectedError
    | TimeoutError
    | NetworkError
    | AbortError
}

/**
 * Wait for the add pieces status.
 *
 * GET /pdp/data-sets/{dataSetId}/pieces/added/{txHash}
 *
 * @param options - {@link waitForAddPieces.OptionsType}
 * @returns Status {@link waitForAddPieces.OutputType}
 * @throws Errors {@link waitForAddPieces.ErrorType}
 */
export async function waitForAddPieces(options: waitForAddPieces.OptionsType): Promise<waitForAddPieces.OutputType> {
  const response = await request.json.get<AddPiecesResponse>(options.statusUrl, {
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as AddPiecesResponse
        if (data.piecesAdded === false) {
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
      throw new WaitForAddPiecesError(await response.error.response.text())
    }
    throw response.error
  }
  const data = schema.parse(response.result)
  if (data.txStatus === 'rejected') {
    throw new WaitForAddPiecesRejectedError(data)
  }
  return data
}
