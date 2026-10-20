import { ValidationError } from '../errors/base.ts'
import { TIME_CONSTANTS } from '../utils/constants.ts'
import { calculateEffectiveRate } from './calculate-effective-rate.ts'
import type { getPriceList } from './price-list.ts'

export namespace estimateOnboardingCost {
  export type ParamsType = {
    priceList: getPriceList.OutputType
    /** Total raw payload size of one copy, in bytes. */
    sizeInBytes: bigint
    /** Number of pieces the payload is split into. */
    pieceCount: bigint
    /**
     * Pieces submitted per add-pieces call. Defaults to 1n, which matches the
     * conservative assumption in {@link calculateUploadFees}.
     */
    piecesPerAddPiecesCall?: bigint
    /** Number of copies, each stored in its own new data set. Defaults to 1n. */
    copies?: bigint
  }

  export type OutputType = {
    /** Number of add-pieces calls per copy. */
    addPiecesCalls: bigint
    /** One-time operation fees across all copies. */
    fees: {
      createDataSet: bigint
      addPieces: bigint
      total: bigint
    }
    /**
     * Funds that must be deposited before uploading, across all copies: the
     * streaming lockup (rate x defaultLockupPeriod) plus the lifecycle reserve.
     * This is locked, not spent; storage time is priced by {@link estimateStorageCost}.
     */
    deposit: {
      streamingLockup: bigint
      lifecycleReserve: bigint
      total: bigint
    }
  }
}

/**
 * Estimate what it costs to bring data onto FWSS, without a wallet or account state.
 *
 * Every copy is a new data set, so each copy pays the create-data-set fee and
 * the add-pieces fees for all of its pieces. Unlike {@link calculateUploadFees},
 * this takes a piece count rather than a list of sizes, so it scales to
 * payloads with millions of pieces, and it can model batched add-pieces calls.
 *
 * @param params - {@link estimateOnboardingCost.ParamsType}
 * @returns {@link estimateOnboardingCost.OutputType}
 * @throws {@link ValidationError} when sizes or counts are not positive
 */
export function estimateOnboardingCost(params: estimateOnboardingCost.ParamsType): estimateOnboardingCost.OutputType {
  const { priceList, sizeInBytes, pieceCount } = params
  const piecesPerCall = params.piecesPerAddPiecesCall ?? 1n
  const copies = params.copies ?? 1n
  if (sizeInBytes <= 0n || pieceCount <= 0n || piecesPerCall <= 0n || copies <= 0n) {
    throw new ValidationError('sizeInBytes, pieceCount, piecesPerAddPiecesCall and copies must be positive')
  }

  const addPiecesCalls = (pieceCount + piecesPerCall - 1n) / piecesPerCall
  const createDataSet = priceList.fees.createDataSetFee * copies
  const addPieces =
    (priceList.fees.addPiecesBaseFee * addPiecesCalls + priceList.fees.addPiecesPerPieceFee * pieceCount) * copies

  const { ratePerEpoch } = calculateEffectiveRate({
    sizeInBytes,
    storagePerTibPerMonth: priceList.rates.storagePerTibPerMonth,
    datasetFeePerMonth: priceList.rates.datasetFeePerMonth,
    epochsPerMonth: TIME_CONSTANTS.EPOCHS_PER_MONTH,
  })
  const streamingLockup = ratePerEpoch * priceList.lockups.defaultLockupPeriod * copies
  const lifecycleReserve = priceList.lockups.lifecycleReserveTarget * copies

  return {
    addPiecesCalls,
    fees: { createDataSet, addPieces, total: createDataSet + addPieces },
    deposit: { streamingLockup, lifecycleReserve, total: streamingLockup + lifecycleReserve },
  }
}
