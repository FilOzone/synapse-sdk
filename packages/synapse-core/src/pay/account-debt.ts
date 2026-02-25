import { getAccountInfoIfSettled } from './get-account-info-if-settled.ts'

export namespace calculateAccountDebt {
  export type ParamsType = {
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    currentEpoch: bigint
  }

  export type OutputType = {
    /** max(0, totalOwed - funds) */
    debt: bigint
    /** max(0, funds - totalOwed) */
    availableFunds: bigint
    /** Epoch when account runs out (maxUint256 if lockupRate == 0) */
    fundedUntilEpoch: bigint
  }
}

/**
 * Compute account debt — the amount the on-chain `getAccountInfoIfSettled` hides via clamping.
 *
 * @param params - Raw account fields + current epoch
 * @returns debt, availableFunds, fundedUntilEpoch
 */
export function calculateAccountDebt(params: calculateAccountDebt.ParamsType): calculateAccountDebt.OutputType {
  const { funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch } = params

  const settled = getAccountInfoIfSettled({ funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch })

  // Total owed = lockupCurrent + lockupRate * elapsed
  const elapsed = currentEpoch - lockupLastSettledAt
  const totalOwed = lockupCurrent + lockupRate * elapsed

  // debt = max(0, totalOwed - funds)
  const debt = totalOwed > funds ? totalOwed - funds : 0n

  return {
    debt,
    availableFunds: settled.availableFunds,
    fundedUntilEpoch: settled.fundedUntilEpoch,
  }
}
