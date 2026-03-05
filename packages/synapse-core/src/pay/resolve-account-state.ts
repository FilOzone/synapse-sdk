import { maxUint256 } from 'viem'

export namespace resolveAccountState {
  export type ParamsType = {
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    currentEpoch: bigint
  }

  export type OutputType = {
    fundedUntilEpoch: bigint
    availableFunds: bigint
  }
}

/**
 * Project account state forward to `currentEpoch` by simulating settlement locally.
 *
 * Pure function — no RPC call. Takes raw account fields from `accounts()` + currentEpoch
 * and computes what the account state would be if settlement happened now.
 *
 * @param params - Raw account fields + current epoch
 * @returns fundedUntilEpoch and availableFunds after simulated settlement
 */
export function resolveAccountState(params: resolveAccountState.ParamsType): resolveAccountState.OutputType {
  const { funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch } = params

  const fundedUntilEpoch = lockupRate === 0n ? maxUint256 : lockupLastSettledAt + (funds - lockupCurrent) / lockupRate

  // simulatedSettledAt = min(fundedUntilEpoch, currentEpoch)
  const simulatedSettledAt = fundedUntilEpoch < currentEpoch ? fundedUntilEpoch : currentEpoch

  // simulatedLockupCurrent = lockupCurrent + lockupRate * (simulatedSettledAt - lockupLastSettledAt)
  const simulatedLockupCurrent = lockupCurrent + lockupRate * (simulatedSettledAt - lockupLastSettledAt)

  // availableFunds = max(0, funds - simulatedLockupCurrent)
  const rawAvailable = funds - simulatedLockupCurrent
  const availableFunds = rawAvailable > 0n ? rawAvailable : 0n

  return {
    fundedUntilEpoch,
    availableFunds,
  }
}
