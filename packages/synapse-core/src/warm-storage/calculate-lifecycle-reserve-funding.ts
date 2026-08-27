import { ValidationError } from '../errors/base.ts'
import { validatePieceSizes } from '../utils/pdp-size.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateLifecycleReserveFunding {
  export type ParamsType = {
    /** Canonical warm storage price list. */
    priceList: getPriceList.OutputType
    /** Whether this upload creates a new data set and its initial reserve. */
    isNewDataSet: boolean
    /** Exact raw payload size of every piece added by this operation, in bytes. */
    pieceSizes: readonly bigint[]
    /** Current lifecycle reserve balance. Required for an existing data set. */
    currentReserveBalance?: bigint
    /** Pending one-time payments already queued on the data set. Defaults to 0. */
    pendingOneTimePayments?: bigint
  }

  export type OutputType = {
    /** Initial reserve target locked when a new data set is created. */
    initialLockup: bigint
    /** Additional fixed lockup needed by reserve replenishments during the planned upload. */
    replenishmentLockup: bigint
    /** initialLockup + replenishmentLockup. */
    total: bigint
    /** Expected reserve balance after all planned add-pieces fees are flushed. */
    finalReserveBalance: bigint
  }
}

/**
 * Calculate lifecycle-reserve funding for an upload.
 *
 * FWSS pays operation fees from the PDP rail's fixed lifecycle reserve. Before
 * the fee flush it replenishes an active reserve when the remaining balance
 * would fall below `replenishThreshold`. `pieceSizes` represents one
 * add-pieces operation and therefore one fee flush.
 *
 * Operation fees remain real charges, but they must not also be added directly
 * to the deposit: paying a fee reduces account funds and fixed lockup by the
 * same amount. Only initial reserve creation and conditional replenishments
 * require additional funding.
 *
 * @param params - {@link calculateLifecycleReserveFunding.ParamsType}
 * @returns Lifecycle funding and expected final balance {@link calculateLifecycleReserveFunding.OutputType}
 * @throws {@link ValidationError} when counts or existing reserve state are invalid
 */
export function calculateLifecycleReserveFunding(
  params: calculateLifecycleReserveFunding.ParamsType
): calculateLifecycleReserveFunding.OutputType {
  validatePieceSizes(params.pieceSizes)
  const pieceCount = BigInt(params.pieceSizes.length)

  const pendingAtStart = params.pendingOneTimePayments ?? 0n
  if (pendingAtStart < 0n) {
    throw new ValidationError('pendingOneTimePayments cannot be negative')
  }

  const target = params.priceList.lockups.lifecycleReserveTarget
  const threshold = params.priceList.lockups.replenishThreshold
  const initialLockup = params.isNewDataSet ? target : 0n

  let reserveBalance: bigint
  if (params.isNewDataSet) {
    reserveBalance = target
  } else if (params.currentReserveBalance == null) {
    throw new ValidationError('currentReserveBalance is required for an existing data set')
  } else {
    if (params.currentReserveBalance < 0n) {
      throw new ValidationError('currentReserveBalance cannot be negative')
    }
    reserveBalance = params.currentReserveBalance
  }

  let pending = pendingAtStart + (params.isNewDataSet ? params.priceList.fees.createDataSetFee : 0n)
  pending += params.priceList.fees.addPiecesBaseFee + params.priceList.fees.addPiecesPerPieceFee * pieceCount

  let replenishmentLockup = 0n
  if (reserveBalance < pending + threshold) {
    const replenishedBalance = target + pending
    replenishmentLockup = replenishedBalance - reserveBalance
    reserveBalance = replenishedBalance
  }
  reserveBalance -= pending

  return {
    initialLockup,
    replenishmentLockup,
    total: initialLockup + replenishmentLockup,
    finalReserveBalance: reserveBalance,
  }
}
