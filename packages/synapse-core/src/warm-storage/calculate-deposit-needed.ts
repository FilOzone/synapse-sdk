import { calculateUploadCosts } from '../utils/calculate-upload-costs.ts'
import { resolveUploadDataSet } from '../utils/resolve-upload-data-set.ts'
import type { calculateAdditionalLockupRequired } from './calculate-additional-lockup-required.ts'
import type { calculateUploadFees } from './calculate-upload-fees.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateDepositNeeded {
  export type ParamsType = {
    // Upload parameters (passed to calculateAdditionalLockupRequired)
    /** Exact raw payload size of every piece planned for upload, in bytes. */
    pieceSizes: readonly bigint[]
    /** Aggregate leaf count reported by PDP Verifier. 0n for new data sets. */
    dataSetLeafCount: bigint
    priceList: getPriceList.OutputType
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to priceList.lockups.defaultLockupPeriod. */
    lockupEpochs?: bigint
    isNewDataSet: boolean
    withCDN: boolean
    /** Current lifecycle reserve balance. Required when isNewDataSet is false. */
    currentLifecycleReserveBalance?: bigint
    /** One-time fees already pending on an existing data set. Defaults to 0. */
    pendingOneTimePayments?: bigint
    /** Epoch at which the PDP payment rail ends. Required for an existing data set; must be 0n. */
    pdpEndEpoch?: bigint

    // Runway parameters
    currentLockupRate: bigint
    /** Extra runway epochs beyond the required lockup. Defaults to DEFAULT_RUNWAY_EPOCHS (0). */
    extraRunwayEpochs?: bigint

    // Account debt + resolved state
    debt: bigint
    availableFunds: bigint
    runwayInEpochs: bigint

    // Buffer parameters
    /** Safety margin in epochs for tx execution delay. Defaults to DEFAULT_BUFFER_EPOCHS (5). */
    bufferEpochs?: bigint
  }

  export type OutputType = {
    /** Total deposit needed in token base units (0n if already sufficient). */
    depositNeeded: bigint
    /** Lockup breakdown the deposit was computed from. */
    lockup: calculateAdditionalLockupRequired.OutputType & {
      /** Additional fixed lockup needed to replenish an existing or newly drained lifecycle reserve. */
      reserveReplenishment: bigint
    }
    /** Conservative operation fees paid from the lifecycle reserve and reported as upload costs. */
    fees: calculateUploadFees.OutputType
  }
}

/**
 * Orchestrate lockup + lifecycle-reserve replenishment + runway + debt + buffer
 * to compute total deposit needed.
 *
 * This compatibility helper adapts one data set to the shared pure
 * `calculateUploadCosts` utility, so its funding result stays aligned with the
 * single-context and multi-context top-level APIs.
 *
 * Operation fees are returned as costs but are not added directly to the
 * deposit. FWSS pays them from the lifecycle reserve, reducing account funds
 * and fixed lockup together. The deposit includes only the initial reserve and
 * any fixed-lockup increase needed when the reserve crosses its replenish
 * threshold.
 *
 * @param params - {@link calculateDepositNeeded.ParamsType}
 * @returns {@link calculateDepositNeeded.OutputType}
 * @throws When existing-data-set state or piece sizes are invalid, or the data-set service is terminated
 */
export function calculateDepositNeeded(params: calculateDepositNeeded.ParamsType): calculateDepositNeeded.OutputType {
  const dataSet = resolveUploadDataSet({
    isNewDataSet: params.isNewDataSet,
    dataSetLeafCount: params.dataSetLeafCount,
    currentLifecycleReserveBalance: params.currentLifecycleReserveBalance,
    pendingOneTimePayments: params.pendingOneTimePayments,
    pdpEndEpoch: params.pdpEndEpoch,
  })
  const costs = calculateUploadCosts({
    contexts: [{ pieceSizes: params.pieceSizes, withCDN: params.withCDN, dataSet }],
    priceList: params.priceList,
    account: {
      currentLockupRate: params.currentLockupRate,
      debt: params.debt,
      availableFunds: params.availableFunds,
      runwayInEpochs: params.runwayInEpochs,
      fwssMaxApproved: true,
    },
    epochsPerMonth: params.epochsPerMonth,
    lockupEpochs: params.lockupEpochs,
    extraRunwayEpochs: params.extraRunwayEpochs,
    bufferEpochs: params.bufferEpochs,
  })

  return {
    depositNeeded: costs.depositNeeded,
    lockup: {
      rateDeltaPerEpoch: costs.lockups.rateDeltaPerEpoch,
      lifecycleLockup: costs.lockups.lifecycleLockup,
      reserveReplenishment: costs.lockups.reserveReplenishment,
      streamingLockup: costs.lockups.streamingLockup,
      cdnLockup: costs.lockups.cdnLockup,
      cacheMissLockup: costs.lockups.cacheMissLockup,
      total: costs.lockups.total,
    },
    fees: costs.fees,
  }
}
