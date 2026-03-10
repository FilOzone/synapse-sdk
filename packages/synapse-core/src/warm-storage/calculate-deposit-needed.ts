import { DEFAULT_BUFFER_EPOCHS, DEFAULT_RUNWAY_EPOCHS } from '../utils/constants.ts'
import { calculateAdditionalLockupRequired } from './calculate-additional-lockup-required.ts'

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
    /** From resolveAccountState().fundedUntilEpoch. */
    fundedUntilEpoch: bigint
    /** Current epoch (block number). */
    currentEpoch: bigint
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
  const { rawDepositNeeded, netRateAfterUpload, fundedUntilEpoch, currentEpoch, availableFunds, bufferEpochs } = params

  if (rawDepositNeeded > 0n) {
    // Deposit is needed — add buffer so it's sufficient at T_exec
    return netRateAfterUpload * bufferEpochs
  }

  if (fundedUntilEpoch <= currentEpoch + bufferEpochs) {
    // No new lockup needed, but account expires within buffer window
    const bufferCost = netRateAfterUpload * bufferEpochs
    const needed = bufferCost - availableFunds
    return needed > 0n ? needed : 0n
  }

  // Account has sufficient runway — no buffer needed
  return 0n
}

export namespace calculateDepositNeeded {
  export type ParamsType = {
    // Upload parameters (passed to calculateAdditionalLockupRequired)
    dataSize: bigint
    currentDataSetSize: bigint
    pricePerTiBPerMonth: bigint
    minimumPricePerMonth: bigint
    /** Epochs per month. Defaults to EPOCHS_PER_MONTH (86400). */
    epochsPerMonth?: bigint
    /** Lockup period in epochs. Defaults to LOCKUP_PERIOD (30 days). */
    lockupEpochs?: bigint
    isNewDataSet: boolean
    withCDN: boolean

    // Runway parameters
    currentLockupRate: bigint
    /** Extra runway epochs beyond the required lockup. Defaults to DEFAULT_RUNWAY_EPOCHS (0). */
    extraRunwayEpochs?: bigint

    // Account debt + resolved state
    debt: bigint
    availableFunds: bigint
    fundedUntilEpoch: bigint

    // Buffer parameters
    currentEpoch: bigint
    /** Safety margin in epochs for tx execution delay. Defaults to DEFAULT_BUFFER_EPOCHS (5). */
    bufferEpochs?: bigint
  }
}

/**
 * Orchestrate lockup + runway + debt + buffer to compute total deposit needed.
 *
 * @param params - {@link calculateDepositNeeded.ParamsType}
 * @returns The total deposit needed in token base units (0n if already sufficient)
 */
export function calculateDepositNeeded(params: calculateDepositNeeded.ParamsType): bigint {
  const lockup = calculateAdditionalLockupRequired({
    dataSize: params.dataSize,
    currentDataSetSize: params.currentDataSetSize,
    pricePerTiBPerMonth: params.pricePerTiBPerMonth,
    minimumPricePerMonth: params.minimumPricePerMonth,
    epochsPerMonth: params.epochsPerMonth,
    lockupEpochs: params.lockupEpochs,
    isNewDataSet: params.isNewDataSet,
    withCDN: params.withCDN,
  })

  const netRateAfterUpload = params.currentLockupRate + lockup.rateDeltaPerEpoch
  const extraRunwayEpochs = params.extraRunwayEpochs ?? DEFAULT_RUNWAY_EPOCHS
  const bufferEpochs = params.bufferEpochs ?? DEFAULT_BUFFER_EPOCHS

  const runway = calculateRunwayAmount({
    netRateAfterUpload,
    extraRunwayEpochs,
  })

  const rawDepositNeeded = lockup.total + runway + params.debt - params.availableFunds

  // Skip buffer when no existing rails are draining and this is a new dataset.
  // The deposit lands before any rail is created, so nothing consumes funds
  // between balance check and tx execution.
  const skipBuffer = params.currentLockupRate === 0n && params.isNewDataSet

  const buffer = skipBuffer
    ? 0n
    : calculateBufferAmount({
        rawDepositNeeded,
        netRateAfterUpload,
        fundedUntilEpoch: params.fundedUntilEpoch,
        currentEpoch: params.currentEpoch,
        availableFunds: params.availableFunds,
        bufferEpochs,
      })

  const clamped = rawDepositNeeded > 0n ? rawDepositNeeded : 0n
  return clamped + buffer
}
