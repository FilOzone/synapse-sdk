import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Account, type Chain, type Client, type Hex, isHex, type Transport } from 'viem'
import * as z from 'zod'
import { AddPiecesError, LocationHeaderError } from '../errors/index.ts'
import { WaitForAddPiecesError, WaitForAddPiecesRejectedError } from '../errors/pdp.ts'
import { AtLeastOnePieceRequiredError, TooManyPiecesError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from '../utils/constants.ts'
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
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
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
    json: {
      pieces: pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
      extraData: extraData,
    },
    timeout: RETRY_CONSTANTS.TIMEOUT,
    retry: {
      methods: ['post'],
      statusCodes: [429],
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
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
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }

  export type OutputType = addPiecesApiRequest.OutputType
  export type ErrorType = addPiecesApiRequest.ErrorType | signAddPieces.ErrorType
}

/**
 * Validate the piece count for an addPieces (or createDataSetAndAddPieces) batch,
 * failing early instead of reverting on-chain.
 *
 * @param pieceCount - Number of pieces in the batch
 * @throws AtLeastOnePieceRequiredError when not a positive integer
 * @throws TooManyPiecesError when above {@link SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE}
 */
export function validateAddPiecesBatch(pieceCount: number): void {
  if (!Number.isInteger(pieceCount) || pieceCount < 1) {
    throw new AtLeastOnePieceRequiredError()
  }
  if (pieceCount > SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE) {
    throw new TooManyPiecesError(pieceCount, SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE)
  }
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
  validateAddPiecesBatch(options.pieces.length)
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
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
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
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
    /** The poll interval in milliseconds. Defaults to {@link RETRY_CONSTANTS.POLL_INTERVAL}. */
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
  const response = await request.json.get(options.statusUrl, {
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
    },
    poll: {
      limit: RETRY_CONSTANTS.POLL_LIMIT,
      interval: options.pollInterval ?? RETRY_CONSTANTS.POLL_INTERVAL,
      statusCodes: [202, 200], // 202 is processing, 200 is success
      shouldPoll: async (ctx) => {
        const data = (await ctx.response.clone().json()) as AddPiecesResponse
        return data.piecesAdded === false
      },
    },
    timeout: options.timeout ?? RETRY_CONSTANTS.TIMEOUT,
    schema,
  })
  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new WaitForAddPiecesError(await response.error.response.text())
    }
    throw response.error
  }
  if (response.result.txStatus === 'rejected') {
    throw new WaitForAddPiecesRejectedError(response.result)
  }
  return response.result
}
