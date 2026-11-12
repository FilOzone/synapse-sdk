/**
 * Epoch to date conversion utilities for Filecoin networks
 */

import { maxUint256 } from 'viem'
import { TIME_CONSTANTS } from './constants.ts'

/**
 * Convert a Filecoin epoch to a JavaScript Date
 *
 * @param epoch - The epoch to convert
 * @param genesisTimestamp - The genesis timestamp of the chain in seconds (Unix timestamp)
 * @returns Date of the epoch, or `null` when it is past the `Date` range
 * (e.g. the `maxUint256` "never" sentinel used by `runwayInEpochs`)
 */
export function epochToDate(epoch: bigint, genesisTimestamp: number): Date | null {
  const ms = (BigInt(genesisTimestamp) + epoch * BigInt(TIME_CONSTANTS.EPOCH_DURATION)) * 1000n
  const date = new Date(Number(ms))
  return Number.isNaN(date.getTime()) ? null : date
}

/**
 * Convert a JavaScript Date to a Filecoin epoch
 * @param date - The date to convert
 * @param genesisTimestamp - The genesis timestamp of the chain in seconds (Unix timestamp)
 * @returns The epoch (rounded down to nearest epoch)
 */
export function dateToEpoch(date: Date, genesisTimestamp: number): bigint {
  const secondsSinceGenesis = Math.floor(date.getTime() / 1000) - genesisTimestamp
  return BigInt(Math.floor(secondsSinceGenesis / TIME_CONSTANTS.EPOCH_DURATION))
}

/**
 * Calculate the time until a future epoch
 * @param futureEpoch - The future epoch
 * @param currentEpoch - The current epoch
 * @returns Object with time until the epoch in various units
 */
export function timeUntilEpoch(
  futureEpoch: bigint,
  currentEpoch: bigint
): {
  epochs: bigint
  seconds: number
  minutes: number
  hours: number
  days: number
} {
  const epochDifference = futureEpoch - currentEpoch
  const seconds = Number(epochDifference) * TIME_CONSTANTS.EPOCH_DURATION

  return {
    epochs: epochDifference,
    seconds,
    minutes: seconds / 60,
    hours: seconds / 3600,
    days: seconds / 86400,
  }
}

/**
 * Convert a number of epochs to whole hours (floor division).
 *
 * Each Filecoin epoch is 30 seconds, so 120 epochs = 1 hour.
 *
 * Passes `maxUint256` through unchanged so callers can use it as an
 * "infinite" sentinel (e.g. `resolveAccountState().runwayInEpochs` when
 * `lockupRate` is 0n).
 *
 * @param epochs - The number of epochs to convert
 * @returns The number of whole hours
 *
 * @example
 * ```ts
 * import { epochsToHours } from '@filoz/synapse-core/utils'
 *
 * epochsToHours(240n)   // 2n
 * epochsToHours(2880n)  // 24n
 * ```
 */
export function epochsToHours(epochs: bigint): bigint {
  if (epochs === maxUint256) return maxUint256
  return epochs / TIME_CONSTANTS.EPOCHS_PER_HOUR
}

/**
 * Convert a number of epochs to whole days (floor division).
 *
 * Each Filecoin epoch is 30 seconds, so 2880 epochs = 1 day.
 *
 * Passes `maxUint256` through unchanged so callers can use it as an
 * "infinite" sentinel (e.g. `resolveAccountState().runwayInEpochs` when
 * `lockupRate` is 0n).
 *
 * @param epochs - The number of epochs to convert
 * @returns The number of whole days
 *
 * @example
 * ```ts
 * import { epochsToDays } from '@filoz/synapse-core/utils'
 *
 * epochsToDays(2880n)  // 1n
 * epochsToDays(8640n)  // 3n
 * ```
 */
export function epochsToDays(epochs: bigint): bigint {
  if (epochs === maxUint256) return maxUint256
  return epochs / TIME_CONSTANTS.EPOCHS_PER_DAY
}

/**
 * Calculate when the last proof should have been submitted based on current time
 * @param nextChallengeEpoch - The next challenge epoch from the data set
 * @param maxProvingPeriod - The maximum proving period in epochs
 * @param genesisTimestamp - The genesis timestamp of the chain in seconds (Unix timestamp)
 * @returns Date when the last proof should have been submitted, or null if no proof submitted yet
 */
export function calculateLastProofDate(
  nextChallengeEpoch: bigint,
  maxProvingPeriod: bigint,
  genesisTimestamp: number
): Date | null {
  // If nextChallengeEpoch is 0, no proofs scheduled
  if (nextChallengeEpoch === 0n) {
    return null
  }

  // The last proof should have been submitted before the current proving period started
  // Current proving period starts at nextChallengeEpoch - maxProvingPeriod
  const lastProofEpoch = nextChallengeEpoch - maxProvingPeriod

  // If this is negative, we're in the first proving period
  if (lastProofEpoch <= 0n) {
    return null
  }

  return epochToDate(lastProofEpoch, genesisTimestamp)
}
