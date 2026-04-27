import { maxUint256 } from 'viem'
import type { AccountState } from './types.ts'

export namespace resolveAccountState {
  export type ParamsType = AccountState

  export type OutputType = {
    /**
     * Absolute epoch at which funds run out at the current lockup rate.
     * `maxUint256` when `lockupRate` is 0n.
     */
    fundedUntilEpoch: bigint
    /** Funds available after accounting for all lockup (fixed + rate) at `currentEpoch`. */
    availableFunds: bigint
    /**
     * Number of epochs that can pass from `currentEpoch` (on the input params) before the account
     * runs out of funds at the current lockup rate — i.e. how long until the
     * user needs to deposit more funds.
     *
     * `maxUint256` when `lockupRate` is 0n (no drain), `0n` when the account
     * is already insolvent.
     */
    runwayInEpochs: bigint
  }
}

/**
 * Project account state forward to `currentEpoch` by simulating settlement locally.
 *
 * Pure function — no RPC call. Takes raw account fields from `accounts()` +
 * currentEpoch and computes:
 *
 * - `fundedUntilEpoch` — the absolute epoch at which
 *   `lockupCurrent + lockupRate × elapsed === funds`. Past this point,
 *   settlement stops advancing and the payer must deposit more funds (or
 *   have rails terminated) to keep services running.
 * - `availableFunds` — funds minus all lockup (fixed + rate) at `currentEpoch`.
 * - `runwayInEpochs` — `fundedUntilEpoch - currentEpoch`, clamped to `0n`
 *   when insolvent and `maxUint256` when `lockupRate` is 0n.
 *
 * Note: `funds` already includes fixed lockup from rails (it's reflected in
 * `lockupCurrent`), so runway accounts for both fixed lockup and rate-based
 * lockup automatically.
 *
 * @param params - Raw account fields + current epoch
 * @returns The projected account state {@link resolveAccountState.OutputType}
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

  // runwayInEpochs = fundedUntilEpoch - currentEpoch, with edge cases:
  // - lockupRate === 0n → maxUint256 (already the value of fundedUntilEpoch)
  // - insolvent (fundedUntilEpoch <= currentEpoch) → 0n
  const runwayInEpochs =
    fundedUntilEpoch === maxUint256
      ? maxUint256
      : fundedUntilEpoch > currentEpoch
        ? fundedUntilEpoch - currentEpoch
        : 0n

  return {
    fundedUntilEpoch,
    availableFunds,
    runwayInEpochs,
  }
}
