import { maxUint256 } from 'viem'
import type { AccountState } from './types.ts'

export namespace resolveAccountState {
  export type ParamsType = AccountState

  export type OutputType = {
    /**
     * Funds available for withdrawal or new rail commitments at
     * `currentEpoch`. Equal to `funds - lockupCurrent` once lockup is
     * simulated forward to `currentEpoch`. The "unreserved" portion of
     * `funds` described on {@link runwayInEpochs}.
     */
    availableFunds: bigint
    /**
     * Epochs from `currentEpoch` until this account enters deficit and the
     * standard payment flow to providers halts. Treat as "when must the user
     * act?".
     *
     * The account holds a reserve in `lockupCurrent`, set aside as a payment
     * guarantee for the providers this account is paying. Each rail
     * contributes its own piece of the reserve under its own terms (typically
     * a streaming guarantee tied to that rail's payment period). Active
     * payments draw from the *unreserved* portion of `funds`
     * (`funds - lockupCurrent`). Once the unreserved portion is exhausted,
     * the account is in deficit: standard settlement of active rails halts
     * and providers stop being paid for new epochs even though `funds` is
     * still positive. The reserve is not automatically spent. It becomes
     * claimable only after a provider terminates the rail (settlement then
     * proceeds up to one `lockupPeriod` from the last solvent epoch,
     * drawing from the reserve). Providers may keep serving for a while in
     * deficit (their choice), but reaching this point means service is at
     * risk and the user should top up promptly.
     *
     * - `maxUint256` when `lockupRate` is 0n (nothing is being spent).
     * - `0n` when the account is already past this point (in deficit).
     *
     * To get the absolute epoch form, add `currentEpoch` (skip when this is
     * `maxUint256`).
     */
    runwayInEpochs: bigint
    /**
     * Total spend the account's `funds` would cover at `lockupRate`,
     * calculated as `funds / lockupRate`. Treat as "how much coverage has
     * the user prepaid in total?".
     *
     * Always >= {@link runwayInEpochs}, typically by roughly the size of
     * the reserve held in `lockupCurrent`. `runwayInEpochs` accounts for
     * the reserve as a floor that halts settlement; `grossCoverageInEpochs`
     * treats `funds` as a single bucket without modeling whether the
     * reserve is actually flowing as ongoing payment.
     *
     * Useful as a complement to `runwayInEpochs` in user-facing displays,
     * e.g. "your deposit covers ~X days of storage in total; you have ~Y
     * days before you need to top up to keep paying".
     *
     * - `maxUint256` when `lockupRate` is 0n (nothing is being spent;
     *   takes precedence over `funds === 0n`).
     * - `0n` when `funds` is 0n and `lockupRate` is positive.
     */
    grossCoverageInEpochs: bigint
  }
}

/**
 * Project account state forward to `currentEpoch` by simulating settlement locally.
 *
 * Pure function, no RPC call. Takes raw account fields from `accounts()` plus
 * `currentEpoch` and returns `availableFunds`, `runwayInEpochs`, and
 * `grossCoverageInEpochs`. See {@link resolveAccountState.OutputType} for
 * each field's full semantics.
 *
 * Worked examples (in token units, with `lockupRate = 1 token / day`):
 *
 *   Healthy account: funds=100, lockupCurrent=30
 *     runwayInEpochs        ~= 70 days  (unreserved 70 / 1)
 *     grossCoverageInEpochs  = 100 days (100 / 1)
 *
 *   In deficit: funds=10, lockupCurrent=30
 *     runwayInEpochs         = 0 days   (already past the trigger)
 *     grossCoverageInEpochs  = 10 days  (10 / 1)
 *
 * The reserve in `lockupCurrent` is the sum of each rail's contribution; its
 * size depends on the operators and rails configured for this account.
 * `funds` already includes fixed lockup (it's reflected in `lockupCurrent`),
 * so both numbers account for fixed and rate-based lockup automatically.
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
  // - lockupRate === 0n -> maxUint256 (already the value of fundedUntilEpoch)
  // - in deficit (fundedUntilEpoch <= currentEpoch) -> 0n
  const runwayInEpochs =
    fundedUntilEpoch === maxUint256
      ? maxUint256
      : fundedUntilEpoch > currentEpoch
        ? fundedUntilEpoch - currentEpoch
        : 0n

  // grossCoverageInEpochs = funds / lockupRate. Total horizon the deposit
  // covers at the current rate, treating funds as a single bucket. Always
  // >= runwayInEpochs.
  const grossCoverageInEpochs = lockupRate === 0n ? maxUint256 : funds / lockupRate

  return {
    availableFunds,
    runwayInEpochs,
    grossCoverageInEpochs,
  }
}
