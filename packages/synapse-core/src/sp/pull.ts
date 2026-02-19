import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import { asChain } from '../chains.ts'
import type { PieceCID } from '../piece.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import type { MetadataEntry } from '../typed-data/type-definitions.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { randU256 } from '../utils/rand.ts'
import * as PDP from './sp.ts'

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
type BasePullPiecesOptions = {
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

  export type ReturnType = PDP.PullResponse

  export type ErrorType =
    | PDP.pullPieces.ErrorType
    | signAddPieces.ErrorType
    | signCreateDataSetAndAddPieces.ErrorType
    | asChain.ErrorType
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
function toPullPieces(pieces: PullPieceInput[]): PDP.PullPieceInput[] {
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
): Promise<PDP.pullPieces.OptionsType> {
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
  return PDP.pullPieces(await resolvePullParams(client, options))
}

export namespace waitForPullStatus {
  /**
   * Options for waiting for pull completion.
   */
  export type OptionsType = pullPieces.OptionsType & {
    /** Callback invoked on each poll with current status. */
    onStatus?: (response: PDP.PullResponse) => void
    /** The timeout in milliseconds. Defaults to 5 minutes. */
    timeout?: number
    /** The polling interval in milliseconds. Defaults to 4 seconds. */
    pollInterval?: number
  }

  export type ReturnType = PDP.PullResponse

  export type ErrorType = pullPieces.ErrorType
}

/**
 * Wait for pull completion.
 *
 * Repeatedly calls the pull endpoint until all pieces are complete or any piece fails.
 * Since the endpoint is idempotent, this effectively polls for status updates.
 *
 * @param client - The viem client with account for signing.
 * @param options - {@link waitForPullStatus.OptionsType}
 * @returns The final status when complete or failed. {@link waitForPullStatus.ReturnType}
 * @throws Errors {@link waitForPullStatus.ErrorType}
 */
export async function waitForPullStatus(
  client: Client<Transport, Chain, Account>,
  options: waitForPullStatus.OptionsType
): Promise<waitForPullStatus.ReturnType> {
  const params = await resolvePullParams(client, options)
  return PDP.waitForPullStatus({
    ...params,
    onStatus: options.onStatus,
    timeout: options.timeout,
    pollInterval: options.pollInterval,
  })
}
