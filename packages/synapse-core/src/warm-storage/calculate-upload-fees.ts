import { SIZE_CONSTANTS } from '../utils/constants.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateUploadFees {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    isNewDataSet: boolean
    pieceCount?: bigint
    /**
     * Number of addPieces operations the upload is split across. Defaults to
     * `ceil(pieceCount / MAX_ADD_PIECES_BATCH_SIZE)`, since a single addPieces
     * call cannot exceed the batch limit and pieces beyond it span more calls.
     */
    addPiecesOperationCount?: bigint
  }

  export type OutputType = {
    createDataSetFee: bigint
    addPiecesFee: bigint
    total: bigint
  }
}

/**
 * Compute the one-time fees an upload incurs.
 *
 * Scope is intentionally limited to upload-time fees: create-data-set (new
 * datasets only) and add-pieces. Schedule-removals, terminate, and delete are
 * post-upload lifecycle operations and are not part of an upload cost preview.
 *
 * When `addPiecesOperationCount` is omitted it is derived from `pieceCount` and
 * the `MAX_ADD_PIECES_BATCH_SIZE` batch limit: a batch of `pieceCount` pieces
 * is split into `ceil(pieceCount / MAX_ADD_PIECES_BATCH_SIZE)` addPieces calls,
 * each charged the base fee.
 *
 * @param params - {@link calculateUploadFees.ParamsType}
 * @returns {@link calculateUploadFees.OutputType}
 */
export function calculateUploadFees(params: calculateUploadFees.ParamsType): calculateUploadFees.OutputType {
  const pieceCount = params.pieceCount ?? 1n
  const maxBatch = BigInt(SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE)
  const derivedOperationCount = (pieceCount + maxBatch - 1n) / maxBatch
  const addPiecesOperationCount = params.addPiecesOperationCount ?? derivedOperationCount
  const createDataSetFee = params.isNewDataSet ? params.priceList.fees.createDataSetFee : 0n
  const addPiecesFee =
    params.priceList.fees.addPiecesBaseFee * addPiecesOperationCount +
    params.priceList.fees.addPiecesPerPieceFee * pieceCount

  return {
    createDataSetFee,
    addPiecesFee,
    total: createDataSetFee + addPiecesFee,
  }
}
