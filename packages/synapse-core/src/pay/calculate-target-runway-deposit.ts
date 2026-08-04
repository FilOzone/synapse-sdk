export namespace calculateTargetRunwayDeposit {
  export type ParamsType = {
    /** Unreserved account funds available toward the requested runway. */
    availableFunds: bigint
    /** Outstanding account debt that must be cleared by the deposit. */
    debt: bigint
    /** Current aggregate account spend rate in token base units per epoch. */
    lockupRatePerEpoch: bigint
    /** Requested runway in epochs, including any caller-selected buffer. */
    targetRunwayInEpochs: bigint
  }
}

/**
 * Calculate the additional deposit required to clear current debt and reach a target runway.
 *
 * Uses token base units throughout and does not add an implicit epoch buffer. Callers should
 * include any desired buffer in `targetRunwayInEpochs`.
 *
 * @param params - {@link calculateTargetRunwayDeposit.ParamsType}
 * @returns Additional deposit in token base units, or `0n` when the target is already covered
 */
export function calculateTargetRunwayDeposit(params: calculateTargetRunwayDeposit.ParamsType): bigint {
  const requiredBalance = params.debt + params.lockupRatePerEpoch * params.targetRunwayInEpochs
  const depositNeeded = requiredBalance - params.availableFunds

  return depositNeeded > 0n ? depositNeeded : 0n
}
