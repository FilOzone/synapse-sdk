import type { Account, Address, Chain, Client, Hex, Transport } from 'viem'
import * as z from 'zod'
import { asChain } from '../chains.ts'
import { ZodValidationError } from '../errors/base.ts'
import { from as pieceCidFrom } from '../piece/parse.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPieces } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSetAndAddPieces } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { throwIfAborted } from '../utils/abort.ts'
import { assertAddPiecesFit } from '../utils/add-pieces-fits.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import { getPayerAddress } from '../utils/payer.ts'
import { randU256 } from '../utils/rand.ts'
import { zAddressLoose, zHex, zPieceCidString } from '../utils/schemas.ts'
import { addPiecesApiRequest } from './add-pieces.ts'
import { createDataSetAndAddPiecesApiRequest } from './create-dataset-add-pieces.ts'

/** One piece of a {@link Commit}, in JSON-safe form. */
export type CommitPiece = {
  /** The PieceCID string. */
  pieceCid: string
  /** The piece metadata that was signed. */
  metadata?: MetadataObject
}

/**
 * A signed add pieces commit from {@link prepareAddPieces}, ready for {@link submitCommit}.
 *
 * JSON-safe: `JSON.parse(JSON.stringify(commit))` gives back an equal value. Ids and the nonce are decimal strings.
 */
export type AddPiecesCommit = {
  kind: 'addPieces'
  /** Data set id as a decimal string. */
  dataSetId: string
  /** Client data set id as a decimal string. */
  clientDataSetId: string
  /** Add pieces signature nonce as a decimal string. */
  nonce: string
  /** The payer of the data set. Pass it to `waitForAddPieces` or `getAddPiecesResult`. */
  payer: Address
  /** The pieces in submission order. */
  pieces: CommitPiece[]
  /** The signed extra data. */
  extraData: Hex
}

/**
 * A signed create data set and add pieces commit from {@link prepareCreateDataSetAndAddPieces}, ready for
 * {@link submitCommit}.
 *
 * JSON-safe: `JSON.parse(JSON.stringify(commit))` gives back an equal value. Ids and the nonce are decimal strings.
 */
export type CreateDataSetAndAddPiecesCommit = {
  kind: 'createDataSetAndAddPieces'
  /** Client data set id as a decimal string. */
  clientDataSetId: string
  /** Add pieces signature nonce as a decimal string. */
  nonce: string
  /** The address that receives payments (service provider). */
  payee: Address
  /** The address that pays for the storage. */
  payer: Address
  /** The data set metadata that was signed, without the CDN flag. */
  metadata?: MetadataObject
  /** Whether the data set uses CDN. */
  cdn: boolean
  /** The pieces in submission order. */
  pieces: CommitPiece[]
  /** The signed extra data. */
  extraData: Hex
}

/** A signed commit, saved before sending so it can be resubmitted or recovered after a crash. */
export type Commit = AddPiecesCommit | CreateDataSetAndAddPiecesCommit

const zDecimalString = z.string().regex(/^(0|[1-9][0-9]*)$/, 'Expected a decimal integer string')
const zMetadataObject = z.record(z.string(), z.string())
const zCommitPiece = z.object({ pieceCid: zPieceCidString, metadata: zMetadataObject.optional() })

/** Schema for a {@link Commit} loaded from storage. */
const zCommit = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('addPieces'),
    dataSetId: zDecimalString,
    clientDataSetId: zDecimalString,
    nonce: zDecimalString,
    payer: zAddressLoose,
    pieces: z.array(zCommitPiece).min(1),
    extraData: zHex,
  }),
  z.object({
    kind: z.literal('createDataSetAndAddPieces'),
    clientDataSetId: zDecimalString,
    nonce: zDecimalString,
    payee: zAddressLoose,
    payer: zAddressLoose,
    metadata: zMetadataObject.optional(),
    cdn: z.boolean(),
    pieces: z.array(zCommitPiece).min(1),
    extraData: zHex,
  }),
])

type PieceInput = { pieceCid: PieceCID; metadata?: MetadataObject }

/**
 * Copy the pieces and their metadata, so a caller mutating its input after prepare can't change what the commit
 * says was signed.
 */
function snapshotPieces(pieces: PieceInput[]): PieceInput[] {
  return pieces.map((piece) =>
    piece.metadata == null
      ? { pieceCid: piece.pieceCid }
      : { pieceCid: piece.pieceCid, metadata: { ...piece.metadata } }
  )
}

function toCommitPieces(pieces: PieceInput[]): CommitPiece[] {
  return pieces.map((piece) =>
    piece.metadata == null
      ? { pieceCid: piece.pieceCid.toString() }
      : { pieceCid: piece.pieceCid.toString(), metadata: { ...piece.metadata } }
  )
}

function toSignPieces(pieces: PieceInput[]) {
  return pieces.map((piece) => ({
    pieceCid: piece.pieceCid,
    metadata: pieceMetadataObjectToEntry(piece.metadata),
  }))
}

export namespace prepareAddPieces {
  export type OptionsType = {
    /** The ID of the data set. */
    dataSetId: bigint
    /** The ID of the client data set. */
    clientDataSetId: bigint
    /** The pieces to add. */
    pieces: PieceInput[]
    /** The nonce for the add pieces signature. Defaults to a random 256-bit value. */
    nonce?: bigint
    /** The payer of the data set. Defaults to the root address for a session key client, otherwise the client address. */
    payer?: Address
  }
  export type OutputType = AddPiecesCommit
  export type ErrorType = assertAddPiecesFit.ErrorType | asChain.ErrorType | signAddPieces.ErrorType
}

/**
 * Sign an add pieces commit and return it as JSON-safe data, without sending it.
 *
 * Checks the pieces fit in one message first, so a commit that can't be sent fails before it is saved. Save the
 * commit, then send it with {@link submitCommit}. Resubmitting the same commit can never add the pieces twice:
 * FWSS rejects a reused nonce.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * import * as Piece from '@filoz/synapse-core/piece'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: calibration,
 *   transport: http(),
 * })
 * const serviceURL = 'https://pdp.example.com'
 * const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
 *
 * const commit = await SP.prepareAddPieces(client, {
 *   dataSetId: 1n,
 *   clientDataSetId: 1n,
 *   pieces: [{ pieceCid, metadata: { name: 'photo.jpg' } }],
 * })
 *
 * // Save the commit before sending it, so it can be resubmitted after a crash.
 * const saved = JSON.stringify(commit)
 *
 * const result = await SP.submitCommit(client, { serviceURL, commit: JSON.parse(saved) })
 * const { pieceIds } = await SP.waitForAddPieces({ client, payer: commit.payer, ...result })
 * console.log(pieceIds)
 * ```
 *
 * @param client - The client that signs the commit.
 * @param options - {@link prepareAddPieces.OptionsType}
 * @returns The signed commit {@link prepareAddPieces.OutputType}
 * @throws Errors {@link prepareAddPieces.ErrorType}
 */
export async function prepareAddPieces(
  client: Client<Transport, Chain, Account>,
  options: prepareAddPieces.OptionsType
): Promise<prepareAddPieces.OutputType> {
  const pieces = snapshotPieces(options.pieces)
  assertAddPiecesFit({
    kind: 'addPieces',
    dataSetId: options.dataSetId,
    legacyPieceStorageIdLimit: asChain(client.chain).legacyPieceStorageIdLimit,
    pieces,
  })
  const nonce = options.nonce ?? randU256()
  const extraData = await signAddPieces(client, {
    clientDataSetId: options.clientDataSetId,
    nonce,
    pieces: toSignPieces(pieces),
  })
  return {
    kind: 'addPieces',
    dataSetId: options.dataSetId.toString(),
    clientDataSetId: options.clientDataSetId.toString(),
    nonce: nonce.toString(),
    payer: options.payer ?? getPayerAddress(client.account),
    pieces: toCommitPieces(pieces),
    extraData,
  }
}

export namespace prepareCreateDataSetAndAddPieces {
  export type OptionsType = {
    /** The address that will receive payments (service provider). */
    payee: Address
    /** The pieces to add to the new data set. */
    pieces: PieceInput[]
    /** The address that will pay for the storage. Defaults to the root address for a session key client, otherwise the client address. */
    payer?: Address
    /** The metadata for the data set. */
    metadata?: MetadataObject
    /** Whether the data set should use CDN. Defaults to false. */
    cdn?: boolean
    /** The client data set id. Must be unique for each data set. Defaults to a random 256-bit value. */
    clientDataSetId?: bigint
    /** The nonce for the add pieces signature. Defaults to a random 256-bit value. */
    nonce?: bigint
  }
  export type OutputType = CreateDataSetAndAddPiecesCommit
  export type ErrorType = assertAddPiecesFit.ErrorType | signCreateDataSetAndAddPieces.ErrorType
}

/**
 * Sign a create data set and add pieces commit and return it as JSON-safe data, without sending it.
 *
 * Checks the pieces and data set metadata fit in one message first, so a commit that can't be sent fails before it
 * is saved. Save the commit, then send it with {@link submitCommit}. Resubmitting the same commit can never create
 * the data set twice: FWSS rejects a reused client data set id.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * import * as Piece from '@filoz/synapse-core/piece'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: calibration,
 *   transport: http(),
 * })
 * const serviceURL = 'https://pdp.example.com'
 * const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
 *
 * const commit = await SP.prepareCreateDataSetAndAddPieces(client, {
 *   payee: '0x1234567890123456789012345678901234567890', // the provider's service address
 *   metadata: { project: 'photos' },
 *   pieces: [{ pieceCid }],
 * })
 *
 * // Save the commit before sending it, so it can be resubmitted after a crash.
 * const saved = JSON.stringify(commit)
 *
 * const result = await SP.submitCommit(client, { serviceURL, commit: JSON.parse(saved) })
 * const { dataSetId, pieceIds } = await SP.waitForCreateDataSetAddPieces({ client, ...result })
 * console.log(dataSetId, pieceIds)
 * ```
 *
 * @param client - The client that signs the commit.
 * @param options - {@link prepareCreateDataSetAndAddPieces.OptionsType}
 * @returns The signed commit {@link prepareCreateDataSetAndAddPieces.OutputType}
 * @throws Errors {@link prepareCreateDataSetAndAddPieces.ErrorType}
 */
export async function prepareCreateDataSetAndAddPieces(
  client: Client<Transport, Chain, Account>,
  options: prepareCreateDataSetAndAddPieces.OptionsType
): Promise<prepareCreateDataSetAndAddPieces.OutputType> {
  const cdn = options.cdn ?? false
  const pieces = snapshotPieces(options.pieces)
  const metadata = options.metadata == null ? undefined : { ...options.metadata }
  assertAddPiecesFit({
    kind: 'createDataSetAndAddPieces',
    metadata,
    cdn,
    pieces,
  })
  const clientDataSetId = options.clientDataSetId ?? randU256()
  const nonce = options.nonce ?? randU256()
  const payer = options.payer ?? getPayerAddress(client.account)
  const extraData = await signCreateDataSetAndAddPieces(client, {
    clientDataSetId,
    nonce,
    payee: options.payee,
    payer,
    metadata: datasetMetadataObjectToEntry(metadata, { cdn }),
    pieces: toSignPieces(pieces),
  })
  const commit: CreateDataSetAndAddPiecesCommit = {
    kind: 'createDataSetAndAddPieces',
    clientDataSetId: clientDataSetId.toString(),
    nonce: nonce.toString(),
    payee: options.payee,
    payer,
    cdn,
    pieces: toCommitPieces(pieces),
    extraData,
  }
  if (metadata != null) {
    commit.metadata = { ...metadata }
  }
  return commit
}

export namespace submitCommit {
  export type OptionsType = {
    /** The service URL of the PDP API. */
    serviceURL: string
    /** The commit from {@link prepareAddPieces} or {@link prepareCreateDataSetAndAddPieces}. */
    commit: Commit
    /** The record keeper for a `createDataSetAndAddPieces` commit. Defaults to the Warm Storage contract address. */
    recordKeeper?: Address
    /** The signal to abort the request. */
    signal?: AbortSignal
    /** The number of retries. Defaults to 2. */
    retryCount?: number
    /** The delay with exponential backoff between retries in milliseconds. */
    retryDelay?: number
  }
  /** Same as `addPiecesApiRequest` and `createDataSetAndAddPiecesApiRequest`: pass it to the matching waiter. */
  export type OutputType = addPiecesApiRequest.OutputType
  export type ErrorType =
    | addPiecesApiRequest.ErrorType
    | createDataSetAndAddPiecesApiRequest.ErrorType
    | asChain.ErrorType
    | ZodValidationError
}

/**
 * Send a commit from {@link prepareAddPieces} or {@link prepareCreateDataSetAndAddPieces} to the PDP API.
 *
 * The commit carries everything the request needs, so it can be loaded from storage after a crash and sent as is.
 * It is validated first, so a corrupted or edited commit throws {@link ZodValidationError} before any request is
 * sent. If nothing landed, sending the same commit again is safe.
 *
 * @example
 * ```ts
 * import * as SP from '@filoz/synapse-core/sp'
 * import * as Piece from '@filoz/synapse-core/piece'
 * import { calibration } from '@filoz/synapse-core/chains'
 * import { createWalletClient, http } from 'viem'
 * import { privateKeyToAccount } from 'viem/accounts'
 *
 * const client = createWalletClient({
 *   account: privateKeyToAccount('0x...'),
 *   chain: calibration,
 *   transport: http(),
 * })
 * const serviceURL = 'https://pdp.example.com'
 * const pieceCid = Piece.from('bafkzcibcaabffs4jcd4iheeo5wisbmurjb7l4xgpmzgyzrenebvjjhsbwgx4smy')
 *
 * const commit = await SP.prepareAddPieces(client, { dataSetId: 1n, clientDataSetId: 1n, pieces: [{ pieceCid }] })
 * const saved = JSON.stringify(commit)
 *
 * // After a restart, load the saved commit and send it. Resending it is safe if nothing landed.
 * const loaded: SP.Commit = JSON.parse(saved)
 * const result = await SP.submitCommit(client, { serviceURL, commit: loaded })
 * console.log(result.txHash)
 * ```
 *
 * @param client - The client whose chain sets the default record keeper.
 * @param options - {@link submitCommit.OptionsType}
 * @returns Hash, extra data and piece count {@link submitCommit.OutputType}
 * @throws Errors {@link submitCommit.ErrorType}
 */
export async function submitCommit(
  client: Client<Transport, Chain>,
  options: submitCommit.OptionsType
): Promise<submitCommit.OutputType> {
  throwIfAborted(options.signal)
  const parsed = zCommit.safeParse(options.commit)
  if (!parsed.success) {
    throw new ZodValidationError(parsed.error, 'Invalid commit.')
  }
  const commit = parsed.data
  const pieces = commit.pieces.map((piece) => pieceCidFrom(piece.pieceCid))
  if (commit.kind === 'addPieces') {
    return addPiecesApiRequest({
      serviceURL: options.serviceURL,
      dataSetId: BigInt(commit.dataSetId),
      pieces,
      extraData: commit.extraData,
      signal: options.signal,
      retryCount: options.retryCount,
      retryDelay: options.retryDelay,
    })
  }
  return createDataSetAndAddPiecesApiRequest({
    serviceURL: options.serviceURL,
    recordKeeper: options.recordKeeper ?? asChain(client.chain).contracts.fwss.address,
    pieces,
    extraData: commit.extraData,
    signal: options.signal,
    retryCount: options.retryCount,
    retryDelay: options.retryDelay,
  })
}
