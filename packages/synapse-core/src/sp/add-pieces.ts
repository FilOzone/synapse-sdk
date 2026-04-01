import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Account, type Chain, type Client, type Hex, isHex, type Transport } from 'viem'
import * as z from 'zod'
import { AddPiecesError, LocationHeaderError } from '../errors/index.ts'
import { WaitForAddPiecesError, WaitForAddPiecesRejectedError } from '../errors/pdp.ts'
import { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { zHex, zNumberToBigInt } from '../utils/schemas.ts'

export namespace addPiecesApiRequest {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The pieces to add. */
    pieces: PieceCID[]
    /** The extra data for the add pieces. {@link TypedData.signAddPieces} */
    extraData: Hex
  }
  export type OutputType = {
    /** The transaction hash. */
    txHash: Hex
    /** The status URL. */
    statusUrl: string
  }
  export type ErrorType = AddPiecesError | LocationHeaderError | TimeoutError | NetworkError | AbortError
  export type RequestBody = {
    pieces: {
      pieceCid: ToString<PieceCID>
      subPieces: { subPieceCid: ToString<PieceCID> }[]
    }[]
    extraData: Hex
  }
}

/**
 * Add pieces to a data set on the PDP API.
 *
 * POST /pdp/data-sets/{dataSetId}/pieces
 *
 * @param options - {@link addPiecesApiRequest.OptionsType}
 * @returns Hash and status URL {@link addPiecesApiRequest.OutputType}
 * @throws Errors {@link addPiecesApiRequest.ErrorType}
 */
export async function addPiecesApiRequest(
  options: addPiecesApiRequest.OptionsType
): Promise<addPiecesApiRequest.OutputType> {
  const { serviceURL, dataSetId, pieces, extraData } = options
  const response = await request.post(new URL(`pdp/data-sets/${dataSetId}/pieces`, serviceURL), {
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      pieces: pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
      extraData: extraData,
    }),
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new AddPiecesError(await response.error.response.text())
    }
    throw response.error
  }
  const location = response.result.headers.get('Location')
  const txHash = location?.split('/').pop()
  if (!location || !txHash || !isHex(txHash)) {
    throw new LocationHeaderError(location)
  }

  return {
    txHash: txHash as Hex,
    statusUrl: new URL(location, serviceURL).toString(),
  }
}

export namespace addPieces {
  export type PieceType = {
    pieceCid: PieceCID
    metadata?: MetadataObject
  }
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The ID of the data set. */
    dataSetId: bigint
    /** The ID of the client data set. */
    clientDataSetId: bigint
    /** The pieces to add. */
    pieces: PieceType[]
    /** Optional nonce for the add pieces signature. Ignored when extraData is provided. */
    nonce?: bigint
    /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
    extraData?: Hex
  }

  export type OutputType = addPiecesApiRequest.OutputType
  export type ErrorType = addPiecesApiRequest.ErrorType | signAddPieces.ErrorType
}

/**
 * Add pieces to a data set
 *
 * Call the Service Provider API to add pieces to a data set.
 *
 * @param client - The client to use to add the pieces.
 * @param options - The options for the add pieces. {@link addPieces.OptionsType}
 * @returns The response from the add pieces operation. {@link addPieces.OutputType}
 * @throws Errors {@link addPieces.ErrorType}
 */
export async function addPieces(
  client: Client<Transport, Chain, Account>,
  options: addPieces.OptionsType
): Promise<addPieces.OutputType> {
  if (options.pieces.length === 0) {
    throw new AtLeastOnePieceRequiredError()
  }
  const extraData =
    options.extraData ??
    (await signAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      nonce: options.nonce,
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }))
  return addPiecesApiRequest({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieces: options.pieces.map((piece) => piece.pieceCid),
    extraData,
  })
}

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
