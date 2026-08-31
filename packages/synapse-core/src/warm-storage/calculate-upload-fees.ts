import { validatePieceSizes } from '../utils/pdp-size.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateUploadFees {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    isNewDataSet: boolean
    /** Exact raw payload size of every piece planned for upload, in bytes. */
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
 * Runtime batch boundaries depend on encoded message size, metadata, and
 * upload timing, none of which can be inferred from raw sizes alone. To avoid
 * underestimating required funding, each supplied piece is conservatively
 * priced as its own add-pieces operation. Actual fees can be lower when pieces
 * are submitted together in a batch.
 *
 * @param params - {@link calculateUploadFees.ParamsType}
 * @returns {@link calculateUploadFees.OutputType}
 * @throws {@link ValidationError} when `pieceSizes` is invalid
 */
export function calculateUploadFees(params: calculateUploadFees.ParamsType): calculateUploadFees.OutputType {
  validatePieceSizes(params.pieceSizes)
  const pieceCount = BigInt(params.pieceSizes.length)
  const createDataSetFee = params.isNewDataSet ? params.priceList.fees.createDataSetFee : 0n
  const addPiecesFee =
    (params.priceList.fees.addPiecesBaseFee + params.priceList.fees.addPiecesPerPieceFee) * pieceCount

  return {
    createDataSetFee,
    addPiecesFee,
    total: createDataSetFee + addPiecesFee,
  }
}
