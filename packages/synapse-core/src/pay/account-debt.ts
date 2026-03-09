export namespace calculateAccountDebt {
  export type ParamsType = {
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    currentEpoch: bigint
  }
}

/**
 * Compute account debt — the unsettled lockup amount exceeding available funds.
 *
 * @param params - Raw account fields + current epoch
 * @returns The debt amount (0n if account is healthy)
 */
export function calculateAccountDebt(params: calculateAccountDebt.ParamsType): bigint {
  const { funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch } = params

  // Total owed = lockupCurrent + lockupRate * elapsed
  const elapsed = currentEpoch - lockupLastSettledAt
  const totalOwed = lockupCurrent + lockupRate * elapsed

  // debt = max(0, totalOwed - funds)
  return totalOwed > funds ? totalOwed - funds : 0n
}
