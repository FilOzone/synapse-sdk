import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Account, type Chain, type Client, type Hex, isHex, type Transport } from 'viem'
import { asChain } from '../chains.ts'
import { AddPiecesError, LocationHeaderError } from '../errors/index.ts'
import type { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../errors/pdp.ts'
import type { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { assertAddPiecesFit } from '../utils/add-pieces-fits.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { type DroppedPiece, dedupePieces } from '../utils/dedupe-pieces.ts'
import { type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'

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
     * `waitForAddPieces` or to recover with `getAddPiecesResult` after a crash.
     * If nothing landed, resubmit this same extra data: FWSS rejects a reused nonce, so it can never add the pieces twice.
     */
    extraData: Hex
    /** The number of pieces submitted. Persist it with `extraData`: recovering the piece IDs needs it. */
    pieceCount: number
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
 * @returns Hash, extra data and piece count {@link addPiecesApiRequest.OutputType}
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
    extraData,
    pieceCount: pieces.length,
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
    /**
     * Pre-built signed extraData. When provided, skips internal EIP-712 signing.
     * With `dedupe: true` it must be signed over the deduped pieces.
     */
    extraData?: Hex
    /**
     * Remove pieces whose PieceCID already appeared earlier in `pieces` before signing and submitting.
     * The first piece's metadata wins. Removed pieces are listed in the result's `dropped`. Defaults to false.
     */
    dedupe?: boolean
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }

  export type OutputType = addPiecesApiRequest.OutputType & {
    /** With `dedupe: true`, the pieces not submitted because an earlier piece had the same PieceCID. */
    dropped?: DroppedPiece[]
  }
  export type ErrorType =
    | addPiecesApiRequest.ErrorType
    | signAddPieces.ErrorType
    | AtLeastOnePieceRequiredError
    | AddPiecesBatchTooLargeError
    | InvalidUploadSizeError
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
  throwIfAborted(options.signal)
  const { pieces, dropped } = options.dedupe ? dedupePieces(options.pieces) : { pieces: options.pieces }
  assertAddPiecesFit({
    kind: 'addPieces',
    dataSetId: options.dataSetId,
    legacyPieceStorageIdLimit: asChain(client.chain).legacyPieceStorageIdLimit,
    pieces,
  })
  const extraData =
    options.extraData ??
    (await signAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      nonce: options.nonce,
      pieces: pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }))
  const result = await addPiecesApiRequest({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieces: pieces.map((piece) => piece.pieceCid),
    extraData,
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
    signal: options.signal,
  })
  return dropped ? { ...result, dropped } : result
}
