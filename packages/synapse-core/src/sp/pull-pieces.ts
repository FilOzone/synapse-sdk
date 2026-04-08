import { type AbortError, HttpError, type NetworkError, request, type TimeoutError } from 'iso-web/http'
import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { asChain } from '../chains.ts'
import { PullError } from '../errors/pull.ts'
import type { PieceCID } from '../piece/piece.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import type { MetadataEntry } from '../typed-data/type-definitions.ts'
import { RETRY_CONSTANTS } from '../utils/constants.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'

// =============================================================================
// SP-to-SP Piece Pull Operations
// =============================================================================

export namespace pullPiecesApiRequest {
  /**
   * Status of a pull operation or individual piece.
   *
   * Status progression:
   * - `pending`: Piece is queued but download hasn't started
   * - `inProgress`: Download task is actively running (first attempt)
   * - `retrying`: Download task is running after one or more failures
   * - `complete`: Piece successfully downloaded and verified
   * - `failed`: Piece permanently failed after exhausting retries
   *
   * Overall response status reflects the worst-case across all pieces:
   * failed > retrying > inProgress > pending > complete
   */
  export type PullStatus = 'pending' | 'inProgress' | 'retrying' | 'complete' | 'failed'

  /**
   * Input piece for a pull request.
   */
  export type PullPieceInput = {
    /** PieceCIDv2 format (encodes both CommP and raw size) */
    pieceCid: string
    /** HTTPS URL to pull the piece from (must end in /piece/{pieceCid}) */
    sourceUrl: string
  }

  /**
   * Status of a single piece in a pull response.
   */
  export type PullPieceStatus = {
    /** PieceCIDv2 of the piece */
    pieceCid: string
    /** Current status of this piece */
    status: PullStatus
  }

  /**
   * Options for pulling pieces from external SPs.
   */
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The record keeper contract address (e.g., FWSS). */
    recordKeeper: Address
    /** EIP-712 signed extraData for authorization. */
    extraData: Hex
    /** Optional target dataset ID (omit or 0n to create new). */
    dataSetId?: bigint
    /** Pieces to pull with their source URLs. */
    pieces: PullPieceInput[]
    /** Optional AbortSignal to cancel the request. */
    signal?: AbortSignal
  }

  export type ReturnType = {
    /** Overall status (worst-case across all pieces) */
    status: PullStatus
    /** Per-piece status */
    pieces: PullPieceStatus[]
  }

  export type ErrorType = PullError | TimeoutError | NetworkError | AbortError

  export type RequestBody = {
    extraData: Hex
    recordKeeper: Address
    pieces: PullPieceInput[]
    dataSetId?: number
  }
}

/**
 * Build the JSON request body for a pull request.
 */
function buildPullRequestBody(options: pullPiecesApiRequest.OptionsType): string {
  const body: pullPiecesApiRequest.RequestBody = {
    extraData: options.extraData,
    recordKeeper: options.recordKeeper,
    pieces: options.pieces,
  }

  // Only include dataSetId if specified and non-zero
  if (options.dataSetId != null && options.dataSetId > 0n) {
    body.dataSetId = Number(options.dataSetId)
  }

  return JSON.stringify(body)
}

/**
 * Initiate a piece pull request or get status of an existing one.
 *
 * POST /pdp/piece/pull
 *
 * This endpoint is idempotent - calling with the same extraData returns
 * the status of the existing pull rather than creating duplicates.
 * This allows safe retries and status polling using the same request.
 *
 * @param options - {@link pullPiecesApiRequest.OptionsType}
 * @returns The current status of the pull operation. {@link pullPiecesApiRequest.ReturnType}
 * @throws Errors {@link pullPiecesApiRequest.ErrorType}
 */
export async function pullPiecesApiRequest(
  options: pullPiecesApiRequest.OptionsType
): Promise<pullPiecesApiRequest.ReturnType> {
  const response = await request.post(new URL('pdp/piece/pull', options.serviceURL), {
    body: buildPullRequestBody(options),
    headers: {
      'Content-Type': 'application/json',
    },
    timeout: RETRY_CONSTANTS.MAX_RETRY_TIME,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PullError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as pullPiecesApiRequest.ReturnType
}

export namespace waitForPullPiecesApiRequest {
  /**
   * Options for polling pull status.
   */
  export type OptionsType = pullPiecesApiRequest.OptionsType & {
    /** Callback invoked on each poll with current status. */
    onStatus?: (response: pullPiecesApiRequest.ReturnType) => void
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }

  export type ReturnType = pullPiecesApiRequest.ReturnType

  export type ErrorType = pullPiecesApiRequest.ErrorType
}

/**
 * Wait for pull pieces completion API request.
 *
 * Repeatedly calls the pull endpoint until all pieces are complete or any piece fails.
 * Since the endpoint is idempotent, this effectively polls for status updates.
 *
 * @param options - {@link waitForPullPiecesApiRequest.OptionsType}
 * @returns The final status when complete or failed. {@link waitForPullPiecesApiRequest.ReturnType}
 * @throws Errors {@link waitForPullPiecesApiRequest.ErrorType}
 */
export async function waitForPullPiecesApiRequest(
  options: waitForPullPiecesApiRequest.OptionsType
): Promise<waitForPullPiecesApiRequest.ReturnType> {
  const url = new URL('pdp/piece/pull', options.serviceURL)
  const body = buildPullRequestBody(options)
  const headers = { 'Content-Type': 'application/json' }

  // Custom fetch that creates a fresh Request each time to avoid body consumption issues
  // (iso-web creates Request once and reuses it, but POST bodies can only be read once)
  const fetchWithFreshRequest: typeof globalThis.fetch = (input, init) => {
    // iso-web passes the Request object as input, extract signal from it
    const signal = input instanceof Request ? input.signal : init?.signal
    return globalThis.fetch(url, { method: 'POST', body, headers, signal })
  }

  const response = await request.post(url, {
    body,
    headers,
    fetch: fetchWithFreshRequest,
    async onResponse(response) {
      if (response.ok) {
        const data = (await response.clone().json()) as pullPiecesApiRequest.ReturnType

        // Invoke status callback if provided
        if (options.onStatus) {
          options.onStatus(data)
        }

        // Stop polling when complete or failed
        if (data.status === 'complete' || data.status === 'failed') {
          return response
        }
        throw new Error('Pull not complete')
      }
    },
    retry: {
      shouldRetry: (ctx) => ctx.error.message === 'Pull not complete',
      retries: RETRY_CONSTANTS.RETRIES,
      factor: RETRY_CONSTANTS.FACTOR,
      minTimeout: options.pollInterval ?? RETRY_CONSTANTS.DELAY_TIME,
    },
    timeout: options.timeout ?? RETRY_CONSTANTS.MAX_RETRY_TIME,
    signal: options.signal,
  })

  if (response.error) {
    if (HttpError.is(response.error)) {
      throw new PullError(await response.error.response.text())
    }
    throw response.error
  }

  return (await response.result.json()) as waitForPullPiecesApiRequest.ReturnType
}

/**
 * Input piece for a pull request with typed PieceCID.
 */
export type PullPieceInput = {
  /** PieceCID for the piece */
  pieceCid: PieceCID
  /** HTTPS URL to pull the piece from (must end in /piece/{pieceCid}) */
  sourceUrl: string
  /** Optional metadata for the piece */
  metadata?: MetadataObject
}

/**
 * Base options for pulling pieces.
 */
export type BasePullPiecesOptions = {
  /** The service URL of the PDP API. */
  serviceURL: string
  /** Pieces to pull with their source URLs. */
  pieces: PullPieceInput[]
  /** Optional nonce for the add pieces signature. Ignored when extraData is provided. */
  nonce?: bigint
  /** The address of the record keeper. If not provided, the default is the Warm Storage contract address. */
  recordKeeper?: Address
  /** Optional AbortSignal to cancel the request. */
  signal?: AbortSignal
  /** Pre-built signed extraData. When provided, skips internal EIP-712 signing. */
  extraData?: Hex
}

/**
 * Options for pulling pieces into an existing data set.
 */
export type PullToExistingDataSetOptions = BasePullPiecesOptions & {
  /** The ID of the existing data set to add pieces to. */
  dataSetId: bigint
  /** The client data set ID (used for signing). */
  clientDataSetId: bigint
}

/**
 * Options for creating a new data set and pulling pieces into it.
 */
export type PullToNewDataSetOptions = BasePullPiecesOptions & {
  /** Omit or set to 0n to create a new data set. */
  dataSetId?: undefined | 0n
  /** The client data set ID. Must be unique for each data set. If not provided, a random value is generated. */
  clientDataSetId?: bigint
  /** The address that will receive payments (service provider). Required for new data sets. */
  payee: Address
  /**
   * The address that will pay for the storage (client). If not provided, the default is the client address.
   * If client is from a session key this should be set to the actual payer address.
   */
  payer?: Address
  /** Whether the data set should use CDN. */
  cdn?: boolean
  /** The metadata for the data set. */
  metadata?: MetadataObject
}

export namespace pullPieces {
  /**
   * Options for pulling pieces from external SPs.
   * Use dataSetId > 0n to add to an existing data set, or omit/0n to create a new one.
   */
  export type OptionsType = PullToExistingDataSetOptions | PullToNewDataSetOptions

  export type ReturnType = pullPiecesApiRequest.ReturnType

  export type ErrorType =
    | pullPiecesApiRequest.ErrorType
    | signAddPieces.ErrorType
    | signCreateDataSetAndAddPieces.ErrorType
}

/**
 * Check if options are for adding to an existing data set.
 */
function isExistingDataSet(options: pullPieces.OptionsType): options is PullToExistingDataSetOptions {
  return options.dataSetId != null && options.dataSetId > 0n
}

/**
 * Convert PullPieceInput to signing input format.
 */
function toSigningPieces(pieces: PullPieceInput[]): { pieceCid: PieceCID; metadata?: MetadataEntry[] }[] {
  return pieces.map((piece) => ({
    pieceCid: piece.pieceCid,
    metadata: pieceMetadataObjectToEntry(piece.metadata),
  }))
}

/**
 * Convert PullPieceInput to SP pull input format.
 */
function toPullPieces(pieces: PullPieceInput[]): pullPiecesApiRequest.PullPieceInput[] {
  return pieces.map((piece) => ({
    pieceCid: piece.pieceCid.toString(),
    sourceUrl: piece.sourceUrl,
  }))
}

/**
 * Sign extraData for a pull operation when not pre-built by the caller.
 */
async function signPullExtraData(
  client: Client<Transport, Chain, Account>,
  options: pullPieces.OptionsType
): Promise<Hex> {
  if (isExistingDataSet(options)) {
    return signAddPieces(client, {
      clientDataSetId: options.clientDataSetId,
      nonce: options.nonce,
      pieces: toSigningPieces(options.pieces),
    })
  }
  return signCreateDataSetAndAddPieces(client, {
    clientDataSetId: options.clientDataSetId ?? randU256(),
    payee: options.payee,
    payer: options.payer,
    metadata: datasetMetadataObjectToEntry(options.metadata, {
      cdn: options.cdn ?? false,
    }),
    nonce: options.nonce,
    pieces: toSigningPieces(options.pieces),
  })
}

/**
 * Resolve the common SP-level options from high-level pull options.
 * Signs extraData if not pre-built by the caller.
 */
async function resolvePullParams(
  client: Client<Transport, Chain, Account>,
  options: pullPieces.OptionsType
): Promise<pullPiecesApiRequest.OptionsType> {
  const chain = asChain(client.chain)
  return {
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? chain.contracts.fwss.address,
    extraData: options.extraData ?? (await signPullExtraData(client, options)),
    dataSetId: isExistingDataSet(options) ? options.dataSetId : undefined,
    pieces: toPullPieces(options.pieces),
    signal: options.signal,
  }
}

/**
 * Pull pieces from external storage providers into a data set.
 *
 * Handles EIP-712 signing for authorization and calls the
 * Curio POST /pdp/piece/pull endpoint. Curio verifies the client can pay
 * by running an estimateGas on the resulting contract call.
 *
 * The endpoint is idempotent - calling with the same extraData returns
 * the status of the existing request rather than creating duplicates.
 *
 * @param client - The viem client with account for signing.
 * @param options - {@link pullPieces.OptionsType}
 * @returns The current status of the pull operation. {@link pullPieces.ReturnType}
 * @throws Errors {@link pullPieces.ErrorType}
 */
export async function pullPieces(
  client: Client<Transport, Chain, Account>,
  options: pullPieces.OptionsType
): Promise<pullPieces.ReturnType> {
  return pullPiecesApiRequest(await resolvePullParams(client, options))
}

export namespace waitForPullPieces {
  /**
   * Options for waiting for pull pieces completion.
   */
  export type OptionsType = pullPieces.OptionsType & {
    /** Callback invoked on each poll with current status. */
    onStatus?: (response: pullPieces.ReturnType) => void
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }

  export type ReturnType = pullPiecesApiRequest.ReturnType

  export type ErrorType = pullPieces.ErrorType
}

/**
 * Wait for pull pieces completion.
 *
 * Repeatedly calls the pull endpoint until all pieces are complete or any piece fails.
 * Since the endpoint is idempotent, this effectively polls for status updates.
 *
 * @param client - The viem client with account for signing.
 * @param options - {@link waitForPullPieces.OptionsType}
 * @returns The final status when complete or failed. {@link waitForPullPieces.ReturnType}
 * @throws Errors {@link waitForPullPieces.ErrorType}
 */
export async function waitForPullPieces(
  client: Client<Transport, Chain, Account>,
  options: waitForPullPieces.OptionsType
): Promise<waitForPullPieces.ReturnType> {
  const params = await resolvePullParams(client, options)
  return waitForPullPiecesApiRequest({
    ...params,
    onStatus: options.onStatus,
    timeout: options.timeout,
    pollInterval: options.pollInterval,
  })
}
