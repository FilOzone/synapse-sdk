import { maxUint256 } from 'viem'

export namespace getAccountInfoIfSettled {
  export type ParamsType = {
    funds: bigint
    lockupCurrent: bigint
    lockupRate: bigint
    lockupLastSettledAt: bigint
    currentEpoch: bigint
  }

  export type OutputType = {
    fundedUntilEpoch: bigint
    currentFunds: bigint
    availableFunds: bigint
    currentLockupRate: bigint
  }
}

/**
 * Pure implementation mirroring the on-chain `getAccountInfoIfSettled`.
 *
 * Takes raw account fields from `accounts()` + currentEpoch.
 * No RPC call — computed entirely client-side.
 *
 * @param params - Raw account fields + current epoch
 * @returns Settled account info including fundedUntilEpoch
 */
export function getAccountInfoIfSettled(
  params: getAccountInfoIfSettled.ParamsType
): getAccountInfoIfSettled.OutputType {
  const { funds, lockupCurrent, lockupRate, lockupLastSettledAt, currentEpoch } = params

  // Mirror on-chain: lockupRate == 0 → infinite funding
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
    currentFunds: funds,
    availableFunds,
    currentLockupRate: lockupRate,
  }
}
