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
