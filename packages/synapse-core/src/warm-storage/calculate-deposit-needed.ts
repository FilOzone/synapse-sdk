import { DEFAULT_BUFFER_EPOCHS, DEFAULT_RUNWAY_EPOCHS } from '../utils/constants.ts'
import { calculateAdditionalLockupRequired } from './calculate-additional-lockup-required.ts'
import { calculateUploadFees } from './calculate-upload-fees.ts'
import type { getPriceList } from './price-list.ts'

export namespace calculateRunwayAmount {
  export type ParamsType = {
    /** Projected account rate after this upload: currentLockupRate + rateDeltaPerEpoch. */
    netRateAfterUpload: bigint
    /** Extra runway epochs beyond the required lockup. 0n if not requested. */
    extraRunwayEpochs: bigint
  }
}

/**
 * Calculate extra funds to ensure the account stays funded beyond the lockup period.
 *
 * Uses the net rate (current + delta from this upload) so the runway covers
 * the full drain rate after the new rail is created.
 *
 * @param params - {@link calculateRunwayAmount.ParamsType}
 * @returns The runway amount in token base units
 */
export function calculateRunwayAmount(params: calculateRunwayAmount.ParamsType): bigint {
  return params.netRateAfterUpload * params.extraRunwayEpochs
}

export namespace calculateBufferAmount {
  export type ParamsType = {
    /** additionalLockup + runwayAmount + debt - availableFunds (before clamping to 0). */
    rawDepositNeeded: bigint
    /** Projected account rate after this upload: currentLockupRate + rateDeltaPerEpoch. */
    netRateAfterUpload: bigint
    /** From resolveAccountState().runwayInEpochs. */
    runwayInEpochs: bigint
    /** From resolveAccountState().availableFunds. */
    availableFunds: bigint
    /** Safety margin in epochs. */
    bufferEpochs: bigint
  }
}

/**
 * Calculate safety margin for epoch drift between balance check and tx execution.
 *
 * Uses the net rate (current + delta) because in multi-context uploads, earlier
 * contexts create rails that start ticking before later contexts execute.
 *
 * @param params - {@link calculateBufferAmount.ParamsType}
 * @returns The buffer amount in token base units
 */
export function calculateBufferAmount(params: calculateBufferAmount.ParamsType): bigint {
  const { rawDepositNeeded, netRateAfterUpload, runwayInEpochs, availableFunds, bufferEpochs } = params

  if (rawDepositNeeded > 0n) {
    // Deposit is needed, add buffer so it's sufficient at T_exec
    return netRateAfterUpload * bufferEpochs
  }

  if (runwayInEpochs <= bufferEpochs) {
    // No new lockup needed, but account expires within buffer window.
    // (runwayInEpochs is maxUint256 when lockupRate is 0n, so this branch
    // is only entered for actively-draining accounts.)
    const bufferCost = netRateAfterUpload * bufferEpochs
    const needed = bufferCost - availableFunds
    return needed > 0n ? needed : 0n
  }

  // Account has sufficient runway, no buffer needed
  return 0n
}

export namespace calculateDepositNeeded {
  export type ParamsType = {
    // Upload parameters (passed to calculateAdditionalLockupRequired)
    dataSize: bigint
    currentDataSetSize: bigint
    priceList: getPriceList.OutputType
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to priceList.lockups.defaultLockupPeriod. */
    lockupEpochs?: bigint
    isNewDataSet: boolean
    withCDN: boolean
    pieceCount?: bigint
    addPiecesOperationCount?: bigint

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
    lockup: calculateAdditionalLockupRequired.OutputType
    /** Operation fee breakdown the deposit was computed from. */
    fees: calculateUploadFees.OutputType
  }
}

/**
 * Orchestrate lockup + runway + debt + buffer to compute total deposit needed.
 *
 * Returns the deposit together with the lockup and fee breakdowns it was
 * computed from, so callers can reuse them without recomputing.
 *
 * @param params - {@link calculateDepositNeeded.ParamsType}
 * @returns {@link calculateDepositNeeded.OutputType}
 */
export function calculateDepositNeeded(params: calculateDepositNeeded.ParamsType): calculateDepositNeeded.OutputType {
  const lockup = calculateAdditionalLockupRequired({
    dataSize: params.dataSize,
    currentDataSetSize: params.currentDataSetSize,
    priceList: params.priceList,
    epochsPerMonth: params.epochsPerMonth,
    lockupEpochs: params.lockupEpochs,
    isNewDataSet: params.isNewDataSet,
    withCDN: params.withCDN,
  })
  const fees = calculateUploadFees({
    priceList: params.priceList,
    isNewDataSet: params.isNewDataSet,
    pieceCount: params.pieceCount,
    addPiecesOperationCount: params.addPiecesOperationCount,
  })

  const netRateAfterUpload = params.currentLockupRate + lockup.rateDeltaPerEpoch
  const extraRunwayEpochs = params.extraRunwayEpochs ?? DEFAULT_RUNWAY_EPOCHS
  const bufferEpochs = params.bufferEpochs ?? DEFAULT_BUFFER_EPOCHS

  const runway = calculateRunwayAmount({
    netRateAfterUpload,
    extraRunwayEpochs,
  })

  const rawDepositNeeded = lockup.total + fees.total + runway + params.debt - params.availableFunds

  // Skip buffer when no existing rails are draining and this is a new dataset.
  // The deposit lands before any rail is created, so nothing consumes funds
  // between balance check and tx execution.
  const skipBuffer = params.currentLockupRate === 0n && params.isNewDataSet

  const buffer = skipBuffer
    ? 0n
    : calculateBufferAmount({
        rawDepositNeeded,
        netRateAfterUpload,
        runwayInEpochs: params.runwayInEpochs,
        availableFunds: params.availableFunds,
        bufferEpochs,
      })

  const clamped = rawDepositNeeded > 0n ? rawDepositNeeded : 0n
  return { depositNeeded: clamped + buffer, lockup, fees }
}
