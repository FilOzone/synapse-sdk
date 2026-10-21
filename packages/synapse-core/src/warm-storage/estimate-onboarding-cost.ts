import { ValidationError } from '../errors/base.ts'
import { estimateStorageCost } from './estimate-storage-cost.ts'
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
     * streaming lockup (rate x defaultLockupPeriod) plus the lifecycle reserve,
     * including the replenishments the add-pieces fees will trigger. Fees are
     * paid out of the reserve, so they are not added on top of this.
     * Storage time is priced by {@link estimateStorageCost}.
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

  const streamingLockup = estimateStorageCost({
    priceList,
    sizeInBytes,
    copies,
    durationInEpochs: priceList.lockups.defaultLockupPeriod,
  }).total
  const lastCallPieces = pieceCount - piecesPerCall * (addPiecesCalls - 1n)
  const lifecycleReserve =
    (priceList.lockups.lifecycleReserveTarget +
      estimateReplenishment({
        target: priceList.lockups.lifecycleReserveTarget,
        threshold: priceList.lockups.replenishThreshold,
        firstFlush:
          priceList.fees.createDataSetFee +
          priceList.fees.addPiecesBaseFee +
          priceList.fees.addPiecesPerPieceFee * (addPiecesCalls === 1n ? lastCallPieces : piecesPerCall),
        callFee: priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee * piecesPerCall,
        lastCallFee: priceList.fees.addPiecesBaseFee + priceList.fees.addPiecesPerPieceFee * lastCallPieces,
        calls: addPiecesCalls,
      })) *
    copies

  return {
    addPiecesCalls,
    fees: { createDataSet, addPieces, total: createDataSet + addPieces },
    deposit: { streamingLockup, lifecycleReserve, total: streamingLockup + lifecycleReserve },
  }
}

/**
 * Lockup added by reserve replenishments over `calls` fee flushes, as
 * {@link calculateLifecycleReserveFunding} computes per piece: before a flush
 * of `pending`, a reserve below `pending + threshold` is refilled to
 * `target + pending`. Every refill leaves the reserve at `target`, so the
 * middle calls repeat in cycles that are skipped whole instead of simulated.
 */
function estimateReplenishment(params: {
  target: bigint
  threshold: bigint
  firstFlush: bigint
  callFee: bigint
  lastCallFee: bigint
  calls: bigint
}): bigint {
  const { target, threshold, firstFlush, callFee, lastCallFee, calls } = params
  let reserve = target
  let lockup = 0n
  const flush = (pending: bigint) => {
    if (reserve < pending + threshold) {
      lockup += target + pending - reserve
      reserve = target + pending
    }
    reserve -= pending
  }
  flush(firstFlush)
  if (calls === 1n) return lockup
  let middle = calls - 2n
  const cycle = callFee > 0n ? (target - threshold) / callFee + 1n : 0n
  while (middle > 0n) {
    if (reserve === target && cycle > 0n && middle >= cycle) {
      const cycles = middle / cycle
      lockup += cycles * cycle * callFee
      middle -= cycles * cycle
      continue
    }
    flush(callFee)
    middle -= 1n
  }
  flush(lastCallFee)
  return lockup
}
