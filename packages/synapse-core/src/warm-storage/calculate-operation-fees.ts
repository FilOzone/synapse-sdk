import type { getPriceList } from './price-list.ts'

export namespace calculateOperationFees {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    isNewDataSet: boolean
    pieceCount?: bigint
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
 */
export function calculateOperationFees(params: calculateOperationFees.ParamsType): calculateOperationFees.OutputType {
  const pieceCount = params.pieceCount ?? 1n
  const addPiecesOperationCount = params.addPiecesOperationCount ?? 1n
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
