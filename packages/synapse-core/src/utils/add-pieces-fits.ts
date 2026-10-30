import { encodeAbiParameters, encodeFunctionData, type Hex, size, toHex, zeroAddress } from 'viem'
import { pdpVerifierAbi } from '../abis/generated.ts'
import { AddPiecesBatchTooLargeError, InvalidUploadSizeError } from '../errors/pdp.ts'
import { AtLeastOnePieceRequiredError } from '../errors/warm-storage.ts'
import type { PieceCID } from '../piece/piece-cid.ts'
import { signAddPiecesAbiParameters } from '../typed-data/sign-add-pieces.ts'
import { signCreateDataSetAbiParameters } from '../typed-data/sign-create-dataset.ts'
import { signcreateDataSetAndAddPiecesAbiParameters } from '../typed-data/sign-create-dataset-add-pieces.ts'
import type { PdpDataSet } from '../warm-storage/types.ts'
import { compactPieceMetadata } from './compact-piece-metadata.ts'
import { SIZE_CONSTANTS } from './constants.ts'
import {
  datasetMetadataObjectToEntry,
  type MetadataEntry,
  type MetadataObject,
  pieceMetadataObjectToEntry,
} from './metadata.ts'

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

/** Why a piece list does not fit in one addPieces / createAndAdd message. */
export type AddPiecesFitResult =
  | { fits: true }
  | { fits: false; reason: 'empty' | 'legacy-count' | 'too-large' }
  | {
      fits: false
      reason: 'invalid-metadata'
      /** Index of the first piece with invalid metadata. Undefined when the data set metadata is invalid. */
      index?: number
      /** The validation error. */
      cause: unknown
    }

export namespace checkAddPiecesFit {
  export type OptionsType = LimiterOptions
  export type OutputType = AddPiecesFitResult
}

/**
 * Whether a candidate piece list fits in one addPieces / createAndAdd message, and why not.
 *
 * Same checks as {@link addPiecesFits}, but returns the failure reason. Invalid metadata is
 * reported with the index of the first bad piece instead of throwing.
 *
 * @param options - {@link checkAddPiecesFit.OptionsType}
 * @returns The fit result {@link checkAddPiecesFit.OutputType}
 *
 * @example
 * ```ts
 * import { checkAddPiecesFit } from '@filoz/synapse-core/utils'
 *
 * const result = checkAddPiecesFit({ kind: 'addPieces', dataSetId, pieces })
 * if (!result.fits && result.reason === 'invalid-metadata') {
 *   console.log('bad piece at', result.index)
 * }
 * ```
 */
export function checkAddPiecesFit(options: checkAddPiecesFit.OptionsType): checkAddPiecesFit.OutputType {
  if (options.pieces.length < 1) {
    return { fits: false, reason: 'empty' }
  }
  if (isLegacyDataSet(options) && options.pieces.length > SIZE_CONSTANTS.MAX_LEGACY_ADD_PIECES_BATCH_SIZE) {
    return { fits: false, reason: 'legacy-count' }
  }
  const prepared = prepare(options)
  if (prepared.invalid != null) {
    return { fits: false, reason: 'invalid-metadata', index: prepared.invalid.index, cause: prepared.invalid.cause }
  }
  if (estimatePreparedSize(prepared, options.pieces.length) > SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE) {
    return { fits: false, reason: 'too-large' }
  }
  return { fits: true }
}

export namespace addPiecesFits {
  export type OptionsType = LimiterOptions
  export type OutputType = boolean
}

/**
 * Whether a candidate piece list fits in one addPieces / createAndAdd message.
 *
 * Checks estimated encoded-params size against {@link SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE}.
 * Legacy data sets also have an 80-piece cap when their ID and chain cutoff are supplied.
 * Empty `pieces` or invalid metadata does not fit. Never throws; use {@link checkAddPiecesFit}
 * for the reason.
 *
 * @param options - {@link addPiecesFits.OptionsType}
 * @returns Whether the pieces fit {@link addPiecesFits.OutputType}
 *
 * @example
 * ```ts
 * import { addPiecesFits } from '@filoz/synapse-core/utils'
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
  return checkAddPiecesFit(options).fits
}

export namespace maxFittingPieces {
  export type OptionsType = LimiterOptions
  export type OutputType = number
}

/**
 * Length of the longest prefix of `options.pieces` that fits in one addPieces / createAndAdd message.
 *
 * Equivalent to the largest `n` for which {@link addPiecesFits} returns `true` on `pieces.slice(0, n)`,
 * or `0` if none fit. Stops before the first piece with invalid metadata. Binary searches the prefix
 * length, encoding the calldata O(log n) times instead of once per piece. Never throws.
 *
 * @param options - {@link maxFittingPieces.OptionsType}
 * @returns Number of leading pieces that fit {@link maxFittingPieces.OutputType}
 *
 * @example
 * ```ts
 * import { maxFittingPieces } from '@filoz/synapse-core/utils'
 *
 * const count = maxFittingPieces({ kind: 'addPieces', dataSetId, legacyPieceStorageIdLimit, pieces })
 * const batch = pieces.slice(0, count)
 * ```
 */
export function maxFittingPieces(options: maxFittingPieces.OptionsType): maxFittingPieces.OutputType {
  const prepared = prepare(options)
  let hi = prepared.pieceMetadata.length
  if (isLegacyDataSet(options)) {
    hi = Math.min(hi, SIZE_CONSTANTS.MAX_LEGACY_ADD_PIECES_BATCH_SIZE)
  }
  // Calldata size never shrinks as the prefix grows, so the fitting prefixes are contiguous from 0.
  const fits = (count: number) => estimatePreparedSize(prepared, count) <= SIZE_CONSTANTS.MAX_ADD_PIECES_MESSAGE_SIZE
  if (hi === 0 || fits(hi)) {
    return hi
  }
  // Invariant: prefix `lo` fits (or lo = 0), prefix `hi + 1` does not.
  let lo = 0
  hi -= 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (fits(mid)) {
      lo = mid
    } else {
      hi = mid - 1
    }
  }
  return lo
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
 * Throw if a piece can never be added: its PieceCID size is outside Curio's upload bounds or its
 * metadata exceeds the contract limits. Use it to reject bad pieces before any network work.
 *
 * @param piece - The piece to check.
 * @throws {@link InvalidUploadSizeError} when the PieceCID size is below {@link SIZE_CONSTANTS.MIN_UPLOAD_SIZE} or above {@link SIZE_CONSTANTS.MAX_UPLOAD_SIZE}
 * @throws Error when the piece metadata exceeds the contract limits
 */
export function assertPieceValid(piece: LimiterPiece): void {
  assertPieceCidSize(piece.pieceCid)
  pieceMetadataObjectToEntry(piece.metadata)
}

/**
 * Throw if `pieces` is empty, a PieceCID is outside Curio's size bounds, or the
 * list does not fit in one addPieces / createAndAdd message.
 *
 * @param options - {@link LimiterOptions}
 * @throws {@link AtLeastOnePieceRequiredError} when `pieces` is empty
 * @throws {@link InvalidUploadSizeError} when a PieceCID size is below {@link SIZE_CONSTANTS.MIN_UPLOAD_SIZE} or above {@link SIZE_CONSTANTS.MAX_UPLOAD_SIZE}
 * @throws {@link AddPiecesBatchTooLargeError} when a piece-count or message-size limit is exceeded
 * @throws Error when data set or piece metadata exceeds the contract limits
 */
export function assertAddPiecesFit(options: LimiterOptions): void {
  if (options.pieces.length < 1) {
    throw new AtLeastOnePieceRequiredError()
  }
  for (const piece of options.pieces) {
    assertPieceCidSize(piece.pieceCid)
  }
  const result = checkAddPiecesFit(options)
  if (!result.fits) {
    if (result.reason === 'invalid-metadata') {
      throw result.cause
    }
    throw new AddPiecesBatchTooLargeError(options.pieces.length)
  }
}

/**
 * Estimated on-chain calldata size in bytes for the given piece list.
 *
 * @throws Error when data set or piece metadata exceeds the contract limits
 */
export function estimateAddPiecesCalldataSize(options: LimiterOptions): number {
  const prepared = prepare(options)
  if (prepared.invalid != null) {
    throw prepared.invalid.cause
  }
  return estimatePreparedSize(prepared, options.pieces.length)
}

/** Encoded inputs reused across size estimates for different prefix lengths. */
type PreparedPieces = {
  /** Encoded create-data-set extraData. Undefined for `addPieces`. */
  createExtraData?: Hex
  /** Piece data for the valid prefix. */
  pieceData: { data: Hex }[]
  /** Metadata entries for the valid prefix (pieces before the first invalid one). */
  pieceMetadata: MetadataEntry[][]
  invalid?: { index?: number; cause: unknown }
}

/** Validate metadata and encode what does not depend on the prefix length. Never throws. */
function prepare(options: LimiterOptions): PreparedPieces {
  let createExtraData: Hex | undefined
  if (options.kind === 'createDataSetAndAddPieces') {
    let createEntries: MetadataEntry[]
    try {
      createEntries = datasetMetadataObjectToEntry(options.metadata, { cdn: options.cdn ?? false })
    } catch (cause) {
      return { pieceData: [], pieceMetadata: [], invalid: { cause } }
    }
    createExtraData = encodeAbiParameters(signCreateDataSetAbiParameters, [
      zeroAddress,
      0n,
      createEntries.map((entry) => entry.key),
      createEntries.map((entry) => entry.value),
      DUMMY_SIGNATURE,
    ])
  }
  const pieceData: { data: Hex }[] = []
  const pieceMetadata: MetadataEntry[][] = []
  for (const [index, piece] of options.pieces.entries()) {
    try {
      pieceMetadata.push(pieceMetadataObjectToEntry(piece.metadata))
    } catch (cause) {
      return { createExtraData, pieceData, pieceMetadata, invalid: { index, cause } }
    }
    pieceData.push({ data: toHex(piece.pieceCid.bytes) })
  }
  return { createExtraData, pieceData, pieceMetadata }
}

/** Calldata size for the first `count` prepared pieces. */
function estimatePreparedSize(prepared: PreparedPieces, count: number): number {
  const extraData = dummyExtraData(prepared, count)
  const calldata = encodeFunctionData({
    abi: pdpVerifierAbi,
    functionName: 'addPieces',
    args: [0n, zeroAddress, prepared.pieceData.slice(0, count), extraData],
  })
  return size(calldata)
}

function dummyExtraData(prepared: PreparedPieces, count: number): Hex {
  const metadataKV = compactPieceMetadata(prepared.pieceMetadata.slice(0, count))
  const keys = metadataKV.map((entries) => entries.map((entry) => entry.key))
  const values = metadataKV.map((entries) => entries.map((entry) => entry.value))
  const addPiecesExtraData = encodeAbiParameters(signAddPiecesAbiParameters, [0n, keys, values, DUMMY_SIGNATURE])
  if (prepared.createExtraData == null) {
    return addPiecesExtraData
  }
  return encodeAbiParameters(signcreateDataSetAndAddPiecesAbiParameters, [prepared.createExtraData, addPiecesExtraData])
}
