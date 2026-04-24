/**
 * Rail information
 */
export type RailInfo = {
  /** The rail ID */
  railId: bigint
  /** Whether the rail is terminated */
  isTerminated: boolean
  /** End epoch (0 for active rails, > 0 for terminated rails) */
  endEpoch: bigint
}

/**
 * Raw account fields (from `accounts()`) + the current epoch.
 *
 * Shared input shape for pure account-state helpers like
 * {@link resolveAccountState} and {@link calculateAccountDebt}.
 */
export type AccountState = {
  /** Total funds deposited by the account (from `accounts()`). */
  funds: bigint
  /** Lockup amount at `lockupLastSettledAt` (fixed lockup + rate lockup accrued so far). */
  lockupCurrent: bigint
  /** Aggregate per-epoch lockup rate across all active rails. */
  lockupRate: bigint
  /** Epoch when lockup was last settled. */
  lockupLastSettledAt: bigint
  /** Current epoch (block number on Filecoin). */
  currentEpoch: bigint
}
