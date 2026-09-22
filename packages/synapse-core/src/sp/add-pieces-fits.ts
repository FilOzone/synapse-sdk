import { encodeAbiParameters, encodeFunctionData, type Hex, size, toHex, zeroAddress } from 'viem'
import { pdpVerifierAbi } from '../abis/generated.ts'
import { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../errors/pdp.ts'
import { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPiecesAbiParameters } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSetAbiParameters } from '../typed-data/sign-create-dataset.ts'
import { signcreateDataSetAndAddPiecesAbiParameters } from '../typed-data/sign-create-dataset-add-pieces.ts'
import { compactPieceMetadata } from '../utils/compact-piece-metadata.ts'
import { SIZE_CONSTANTS } from '../utils/constants.ts'
import { datasetMetadataObjectToEntry, type MetadataObject, pieceMetadataObjectToEntry } from '../utils/metadata.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'

/** Dummy secp256k1 signature used only to size extraData. */
const DUMMY_SIGNATURE = `0x${'00'.repeat(65)}` as Hex

export type LimiterPiece = {
  pieceCid: PieceCID
  metadata?: MetadataObject
}

export type LimiterOptions =
  | {
      kind: 'addPieces'
      /** Data set supplied to custom batch limiters. */
      dataSet?: PdpDataSet
      /** Target data set ID. Defaults to `dataSet.dataSetId`. */
      dataSetId?: bigint
      /** Chain's compact-storage cutoff. Without it or a data set ID, the legacy count check is skipped. */
      legacyPieceStorageIdLimit?: bigint
      pieces: LimiterPiece[]
    }
  | {
      kind: 'createDataSetAndAddPieces'
      metadata?: MetadataObject
      cdn?: boolean
      pieces: LimiterPiece[]
    }

/** Whether an existing data set uses legacy piece storage. */
function isLegacyDataSet(options: LimiterOptions): boolean {
  if (options.kind !== 'addPieces') return false
  const dataSetId = options.dataSetId ?? options.dataSet?.dataSetId
  return dataSetId != null && options.legacyPieceStorageIdLimit != null && dataSetId < options.legacyPieceStorageIdLimit
}

/** `true` if `pieces` still fit in one addPieces / createAndAdd operation. */
export type Limiter = (options: LimiterOptions) => boolean

export namespace addPiecesFits {
  export type OptionsType = LimiterOptions
  export type OutputType = boolean
}

/**
 * Whether a candidate piece list fits in one addPieces / createAndAdd message.
 *
 * Checks estimated encoded-params size against {@link SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE}.
 * Legacy data sets also have an 80-piece cap when their ID and chain cutoff are supplied.
 * Empty `pieces` does not fit.
 *
 * @param options - {@link addPiecesFits.OptionsType}
 * @returns Whether the pieces fit {@link addPiecesFits.OutputType}
 *
 * @example
 * ```ts
 * import { addPiecesFits } from '@filoz/synapse-core/sp'
 *
 * const fits = addPiecesFits({
 *   kind: 'addPieces',
 *   dataSetId,
 *   legacyPieceStorageIdLimit,
 *   pieces: [{ pieceCid }],
 * })
 * ```
 */
export function addPiecesFits(options: addPiecesFits.OptionsType): addPiecesFits.OutputType {
  if (options.pieces.length < 1) {
    return false
  }
  if (isLegacyDataSet(options) && options.pieces.length > SIZE_CONSTANTS.MAX_LEGACY_ADD_PIECES_BATCH_SIZE) {
    return false
  }
  return estimateAddPiecesCalldataSize(options) <= SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE
}

/**
 * Throw if a PieceCID's encoded raw size is outside Curio's upload bounds
 * ({@link SIZE_CONSTANTS.MIN_UPLOAD_SIZE}–{@link SIZE_CONSTANTS.MAX_UPLOAD_SIZE}).
 *
 * @throws {@link InvalidUploadSizeError}
 */
export function assertPieceCidSize(pieceCid: PieceCID): void {
  const pieceSize = pieceCid.size
  if (pieceSize < SIZE_CONSTANTS.MIN_UPLOAD_SIZE || pieceSize > SIZE_CONSTANTS.MAX_UPLOAD_SIZE) {
    throw new InvalidUploadSizeError(pieceSize)
  }
}

/**
 * Throw if `pieces` is empty, a PieceCID is outside Curio's size bounds, or the
 * list does not fit in one addPieces / createAndAdd message.
 *
 * @param options - {@link LimiterOptions}
 * @throws {@link AtLeastOnePieceRequiredError} when `pieces` is empty
 * @throws {@link InvalidUploadSizeError} when a PieceCID size is below {@link SIZE_CONSTANTS.MIN_UPLOAD_SIZE} or above {@link SIZE_CONSTANTS.MAX_UPLOAD_SIZE}
 * @throws {@link AddPiecesBatchTooLargeError} when a piece-count or message-size limit is exceeded
 */
export function assertAddPiecesFit(options: LimiterOptions): void {
  if (options.pieces.length < 1) {
    throw new AtLeastOnePieceRequiredError()
  }
  for (const piece of options.pieces) {
    assertPieceCidSize(piece.pieceCid)
  }
  if (!addPiecesFits(options)) {
    throw new AddPiecesBatchTooLargeError(options.pieces.length)
  }
}

/**
 * Estimated on-chain calldata size in bytes for the given piece list.
 */
export function estimateAddPiecesCalldataSize(options: LimiterOptions): number {
  const extraData = dummyExtraData(options)
  const pieceData = options.pieces.map((piece) => ({ data: toHex(piece.pieceCid.bytes) }))
  const calldata = encodeFunctionData({
    abi: pdpVerifierAbi,
    functionName: 'addPieces',
    args: [0n, zeroAddress, pieceData, extraData],
  })
  return size(calldata)
}

function dummyExtraData(options: LimiterOptions): Hex {
  const addPiecesExtraData = dummyAddPiecesExtraData(options.pieces)
  if (options.kind === 'addPieces') {
    return addPiecesExtraData
  }
  const createEntries = datasetMetadataObjectToEntry(options.metadata, { cdn: options.cdn ?? false })
  const createExtraData = encodeAbiParameters(signCreateDataSetAbiParameters, [
    zeroAddress,
    0n,
    createEntries.map((entry) => entry.key),
    createEntries.map((entry) => entry.value),
    DUMMY_SIGNATURE,
  ])
  return encodeAbiParameters(signcreateDataSetAndAddPiecesAbiParameters, [createExtraData, addPiecesExtraData])
}

function dummyAddPiecesExtraData(pieces: LimiterPiece[]): Hex {
  const metadataKV = compactPieceMetadata(pieces.map((piece) => pieceMetadataObjectToEntry(piece.metadata)))
  const keys = metadataKV.map((entries) => entries.map((entry) => entry.key))
  const values = metadataKV.map((entries) => entries.map((entry) => entry.value))
  return encodeAbiParameters(signAddPiecesAbiParameters, [0n, keys, values, DUMMY_SIGNATURE])
}
