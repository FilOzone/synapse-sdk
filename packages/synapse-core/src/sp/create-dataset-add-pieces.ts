import { HttpError, type RequestErrors, request } from 'iso-web/http'
import type { ToString } from 'multiformats'
import { type Account, type Address, type Chain, type Client, type Hex, isHex, type Transport } from 'viem'
import { asChain } from '../chains.ts'
import { CreateDataSetError, LocationHeaderError } from '../errors/index.ts'
import type { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../errors/pdp.ts'
import type { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { assertAddPiecesFit } from '../utils/add-pieces-fits.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { type DroppedPiece, dedupePieces } from '../utils/dedupe-pieces.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'

export namespace createDataSetAndAddPiecesApiRequest {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The address of the record keeper. */
    recordKeeper: Address
    /** The extra data for the create data set and add pieces. */
    extraData: Hex
    /** The pieces to add. */
    pieces: PieceCID[]
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
     * `waitForCreateDataSetAddPieces` or to recover with `getCreateDataSetAndAddPiecesResult` after a crash.
     * If nothing landed, resubmit this same extra data: FWSS rejects reused nonces, so it can never create or add twice.
     */
    extraData: Hex
    /** The number of pieces submitted. Persist it with `extraData`: recovering the piece IDs needs it. */
    pieceCount: number
  }
  export type ErrorType = CreateDataSetError | LocationHeaderError | RequestErrors
  export type RequestBody = {
    recordKeeper: Address
    extraData: Hex
    pieces: {
      pieceCid: ToString<PieceCID>
      subPieces: { subPieceCid: ToString<PieceCID> }[]
    }[]
  }
}

/**
 * Create a data set and add pieces to it on PDP API
 *
 * POST /pdp/data-sets/create-and-add
 *
 * @param options - {@link createDataSetAndAddPiecesApiRequest.OptionsType}
 * @returns Hash, extra data and piece count {@link createDataSetAndAddPiecesApiRequest.OutputType}
 * @throws Errors {@link createDataSetAndAddPiecesApiRequest.ErrorType}
 */
export async function createDataSetAndAddPiecesApiRequest(
  options: createDataSetAndAddPiecesApiRequest.OptionsType
): Promise<createDataSetAndAddPiecesApiRequest.OutputType> {
  // Send the create data set message to the PDP
  const response = await request.post(new URL(`pdp/data-sets/create-and-add`, options.serviceURL), {
    json: {
      recordKeeper: options.recordKeeper,
      extraData: options.extraData,
      pieces: options.pieces.map((piece) => ({
        pieceCid: piece.toString(),
        subPieces: [{ subPieceCid: piece.toString() }],
      })),
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
    pieceCount: options.pieces.length,
  }
}

export type CreateDataSetAndAddPiecesOptions = {
  /** The service URL of the PDP API. */
  serviceURL: string
  /** The address that will receive payments (service provider). */
  payee: Address
  /** The pieces and metadata to add to the data set. */
  pieces: { pieceCid: PieceCID; metadata?: MetadataObject }[]
  /**
   * The address that will pay for the storage (client). If not provided, the default is the root address
   * for a session key client, otherwise the client address.
   */
  payer?: Address
  /** The metadata for the data set. */
  metadata?: MetadataObject
  /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
  clientDataSetId?: bigint
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
  /** Whether the data set should use CDN. */
  cdn?: boolean
  /** The address of the record keeper to use for the signature. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
  /** The signal to abort the request. */
  signal?: AbortSignal
  /** The number of retries. Defaults to 2. */
  retryCount?: number
  /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
  retryDelay?: number
}

export namespace createDataSetAndAddPieces {
  export type OptionsType = CreateDataSetAndAddPiecesOptions
  export type ReturnType = createDataSetAndAddPiecesApiRequest.OutputType & {
    /** With `dedupe: true`, the pieces not submitted because an earlier piece had the same PieceCID. */
    dropped?: DroppedPiece[]
  }
  export type ErrorType =
    | createDataSetAndAddPiecesApiRequest.ErrorType
    | signCreateDataSetAndAddPieces.ErrorType
    | AtLeastOnePieceRequiredError
    | AddPiecesBatchTooLargeError
    | InvalidUploadSizeError
}

/**
 * Create a data set and add pieces to it
 *
 * @param client - The client to use to create the data set.
 * @param options - {@link CreateDataSetAndAddPiecesOptions}
 * @returns The response from the create data set on PDP API. {@link createDataSetAndAddPieces.ReturnType}
 * @throws Errors {@link createDataSetAndAddPieces.ErrorType}
 */
export async function createDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: CreateDataSetAndAddPiecesOptions
): Promise<createDataSetAndAddPieces.ReturnType> {
  throwIfAborted(options.signal)
  const { pieces, dropped } = options.dedupe ? dedupePieces(options.pieces) : { pieces: options.pieces }
  assertAddPiecesFit({
    kind: 'createDataSetAndAddPieces',
    metadata: options.metadata,
    cdn: options.cdn,
    pieces,
  })
  const chain = asChain(client.chain)
  const extraData =
    options.extraData ??
    (await signCreateDataSetAndAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      payee: options.payee,
      payer: options.payer,
      metadata: datasetMetadataObjectToEntry(options.metadata, {
        cdn: options.cdn ?? false,
      }),
      pieces: pieces.map((piece) => ({
        pieceCid: piece.pieceCid,
        metadata: pieceMetadataObjectToEntry(piece.metadata),
      })),
    }))

  const result = await createDataSetAndAddPiecesApiRequest({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData,
    pieces: pieces.map((piece) => piece.pieceCid),
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
    signal: options.signal,
  })
  return dropped ? { ...result, dropped } : result
}
