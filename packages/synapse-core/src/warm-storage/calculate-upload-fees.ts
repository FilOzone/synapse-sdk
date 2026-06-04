import { SIZE_CONSTANTS } from '../utils/constants.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateUploadFees {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    isNewDataSet: boolean
    /** Number of pieces added by this upload. Defaults to 1. */
    pieceCount?: bigint
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
 * The number of addPieces operations is derived from `pieceCount` and the
 * `MAX_ADD_PIECES_BATCH_SIZE` batch limit: a single addPieces call cannot
 * exceed the limit, so `pieceCount` pieces span `ceil(pieceCount / limit)`
 * calls, each charged the base fee.
 *
 * @param params - {@link calculateUploadFees.ParamsType}
 * @returns {@link calculateUploadFees.OutputType}
 */
export function calculateUploadFees(params: calculateUploadFees.ParamsType): calculateUploadFees.OutputType {
  const pieceCount = params.pieceCount ?? 1n
  const maxBatch = BigInt(SIZE_CONSTANTS.MAX_ADD_PIECES_BATCH_SIZE)
  const addPiecesOperationCount = (pieceCount + maxBatch - 1n) / maxBatch
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
