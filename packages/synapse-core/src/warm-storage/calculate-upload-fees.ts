import { validatePieceSizes } from '../utils/pdp-size.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateUploadFees {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    isNewDataSet: boolean
    /** Exact raw payload size of every piece added by this operation, in bytes. */
    pieceSizes: readonly bigint[]
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
 * The length of `pieceSizes` determines the per-piece fee and the calculation
 * includes one add-pieces base fee. Execution batch limits are intentionally
 * not enforced here because they are independent of fee calculation.
 *
 * @param params - {@link calculateUploadFees.ParamsType}
 * @returns {@link calculateUploadFees.OutputType}
 * @throws {@link ValidationError} when `pieceSizes` is invalid
 */
export function calculateUploadFees(params: calculateUploadFees.ParamsType): calculateUploadFees.OutputType {
  validatePieceSizes(params.pieceSizes)
  const pieceCount = BigInt(params.pieceSizes.length)
  const createDataSetFee = params.isNewDataSet ? params.priceList.fees.createDataSetFee : 0n
  const addPiecesFee = params.priceList.fees.addPiecesBaseFee + params.priceList.fees.addPiecesPerPieceFee * pieceCount

  return {
    createDataSetFee,
    addPiecesFee,
    total: createDataSetFee + addPiecesFee,
  }
}
