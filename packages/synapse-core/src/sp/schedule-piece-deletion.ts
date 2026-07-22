import { HttpError, type RequestErrors, request } from 'iso-web/http'
import type { Account, Chain, Client, Hex, Transport } from 'viem'
import { DeletePieceError } from '../errors/pdp.ts'
import { AtLeastOnePieceRequiredError, TooManyPiecesError } from '../errors/warm-storage.ts'
import { signSchedulePieceRemovals } from '../typed-data/sign-schedule-piece-removals.ts'
import { RETRY_CONSTANTS, SIZE_CONSTANTS } from '../utils/constants.ts'

const MAX_CURIO_PIECE_ID = (1n << 63n) - 1n

export namespace deletePieces {
  export type OptionsType = {
    serviceURL: string
    dataSetId: bigint
    pieceIds: bigint[]
    extraData: Hex
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }
  export type OutputType = {
    hash: Hex
  }
  export type ErrorType =
    | AtLeastOnePieceRequiredError
    | TooManyPiecesError
    | RangeError
    | DeletePieceError
    | RequestErrors
}

/**
 * Delete pieces from a data set on the PDP API in one transaction.
 *
 * DELETE /pdp/data-sets/{dataSetId}/pieces/{pieceId}
 *
 * Curio uses the first piece ID in the URL for backwards-compatible routing and
 * the pieceIds request field as the authoritative list when it is non-empty.
 *
 * @param options - {@link deletePieces.OptionsType}
 * @returns Hash of the delete operation {@link deletePieces.OutputType}
 * @throws Errors {@link deletePieces.ErrorType}
 */
export async function deletePieces(options: deletePieces.OptionsType): Promise<deletePieces.OutputType> {
  const { serviceURL, dataSetId, extraData } = options
  const pieceIds = normalizeDeletePieceIds(options.pieceIds)

  // Curio accepts uint64 JSON numbers. Construct the array from bigint decimal
  // strings so IDs above Number.MAX_SAFE_INTEGER are not rounded by JSON.stringify.
  const body = `{"extraData":${JSON.stringify(extraData)},"pieceIds":[${pieceIds.join(',')}]}`
  const response = await request.delete(new URL(`pdp/data-sets/${dataSetId}/pieces/${pieceIds[0]}`, serviceURL), {
    body,
    headers: { 'content-type': 'application/json' },
    timeout: RETRY_CONSTANTS.TIMEOUT,
    retry: {
      retries: options.retryCount,
      minTimeout: options.retryDelay ?? RETRY_CONSTANTS.RETRY_DELAY,
      shouldRetry: (ctx) => HttpError.is(ctx.error) && ctx.error.code === 429,
    },
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new DeletePieceError(await response.error.response.text())
    }
    throw response.error
  }

  const result = (await response.result.json()) as { txHash: Hex }
  return { hash: result.txHash }
}

/**
 * Validate a delete-pieces batch before signing or sending it.
 */
export function validateDeletePiecesBatch(pieceCount: number): void {
  if (!Number.isInteger(pieceCount) || pieceCount < 1) {
    throw new AtLeastOnePieceRequiredError()
  }
  if (pieceCount > SIZE_CONSTANTS.MAX_DELETE_PIECES_BATCH_SIZE) {
    throw new TooManyPiecesError(pieceCount, SIZE_CONSTANTS.MAX_DELETE_PIECES_BATCH_SIZE)
  }
}

function normalizeDeletePieceIds(pieceIds: bigint[]): bigint[] {
  const normalized = [...new Set(pieceIds)]
  validateDeletePiecesBatch(normalized.length)

  for (const pieceId of normalized) {
    if (pieceId < 0n || pieceId > MAX_CURIO_PIECE_ID) {
      throw new RangeError(`Piece ID ${pieceId} is outside Curio's supported range of 0 to ${MAX_CURIO_PIECE_ID}`)
    }
  }

  return normalized
}

export namespace schedulePieceDeletions {
  export type OptionsType = {
    /** The piece IDs to delete. Duplicate IDs are removed before signing. */
    pieceIds: bigint[]
    /** The data set ID to delete the piece from. */
    dataSetId: bigint
    /** The client data set id (nonce) to use for the signature. Must be unique for each data set. */
    clientDataSetId: bigint
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. Defaults to {@link RETRY_CONSTANTS.RETRY_DELAY}. */
    retryDelay?: number
  }
  export type OutputType = deletePieces.OutputType
  export type ErrorType = deletePieces.ErrorType
}

/**
 * Schedule piece deletions in one transaction.
 *
 * Call the Service Provider API to schedule the piece deletion.
 *
 * @param client - The client to use to schedule the piece deletion.
 * @param options - {@link schedulePieceDeletions.OptionsType}
 * @returns Schedule piece deletions operation hash {@link schedulePieceDeletions.OutputType}
 * @throws Errors {@link schedulePieceDeletions.ErrorType}
 *
 * @example
 * ```ts
 * import { schedulePieceDeletions } from '@filoz/synapse-core/sp'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 * import { calibration } from '@filoz/synapse-core/chains'
 *
 * const account = privateKeyToAccount('0x...')
 * const client = createWalletClient({
 *   account,
 *   chain: calibration,
 *   transport: http(),
 * })
 *
 * const result = await schedulePieceDeletions(client, {
 *   pieceIds: [1n, 2n],
 *   dataSetId: 1n,
 *   clientDataSetId: 1n,
 *   serviceURL: 'https://pdp.example.com',
 * })
 *
 * console.log(result.hash)
 * ```
 */
export async function schedulePieceDeletions(
  client: Client<Transport, Chain, Account>,
  options: schedulePieceDeletions.OptionsType
): Promise<schedulePieceDeletions.OutputType> {
  const pieceIds = normalizeDeletePieceIds(options.pieceIds)

  return deletePieces({
    serviceURL: options.serviceURL,
    dataSetId: options.dataSetId,
    pieceIds,
    extraData: await signSchedulePieceRemovals(client, {
      clientDataSetId: options.clientDataSetId,
      pieceIds,
    }),
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
  })
}

export namespace deletePiece {
  export type OptionsType = Omit<deletePieces.OptionsType, 'pieceIds'> & { pieceId: bigint }
  export type OutputType = deletePieces.OutputType
  export type ErrorType = deletePieces.ErrorType
}

/**
 * Delete one piece from a data set on the PDP API.
 */
export function deletePiece(options: deletePiece.OptionsType): Promise<deletePiece.OutputType> {
  const { pieceId, ...rest } = options
  return deletePieces({ ...rest, pieceIds: [pieceId] })
}

export namespace schedulePieceDeletion {
  export type OptionsType = Omit<schedulePieceDeletions.OptionsType, 'pieceIds'> & { pieceId: bigint }
  export type OutputType = schedulePieceDeletions.OutputType
  export type ErrorType = schedulePieceDeletions.ErrorType
}

/**
 * Schedule one piece deletion.
 */
export function schedulePieceDeletion(
  client: Client<Transport, Chain, Account>,
  options: schedulePieceDeletion.OptionsType
): Promise<schedulePieceDeletion.OutputType> {
  const { pieceId, ...rest } = options
  return schedulePieceDeletions(client, { ...rest, pieceIds: [pieceId] })
}
