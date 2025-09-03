/**
 * Epoch to date conversion utilities for Filecoin networks
 */

import type { ethers } from 'ethers'
import type { FilecoinNetworkType } from '../types.ts'
import { GENESIS_TIMESTAMPS, TIME_CONSTANTS } from './constants.ts'
import { createError } from './errors.ts'

/**
 * Convert a Filecoin epoch to a JavaScript Date
 * @param epoch - The epoch number to convert
 * @param network - The Filecoin network (mainnet or calibration)
 * @returns Date object representing the epoch time
 */
export function epochToDate(epoch: number, network: FilecoinNetworkType): Date {
  const genesisTimestamp = GENESIS_TIMESTAMPS[network]
  const epochDuration = TIME_CONSTANTS.EPOCH_DURATION
  const timestampSeconds = genesisTimestamp + epoch * epochDuration
  return new Date(timestampSeconds * 1000) // Convert to milliseconds
}

/**
 * Convert a JavaScript Date to a Filecoin epoch
 * @param date - The date to convert
 * @param network - The Filecoin network (mainnet or calibration)
 * @returns The epoch number (rounded down to nearest epoch)
 */
export function dateToEpoch(date: Date, network: FilecoinNetworkType): number {
  const genesisTimestamp = GENESIS_TIMESTAMPS[network]
  const epochDuration = TIME_CONSTANTS.EPOCH_DURATION
  const timestampSeconds = Math.floor(date.getTime() / 1000)
  const secondsSinceGenesis = timestampSeconds - genesisTimestamp
  return Math.floor(secondsSinceGenesis / epochDuration)
}

/**
 * Get the genesis timestamp for a network
 * @param network - The Filecoin network
 * @returns Genesis timestamp in seconds (Unix timestamp)
 */
export function getGenesisTimestamp(network: FilecoinNetworkType): number {
  return GENESIS_TIMESTAMPS[network]
}

/**
 * Calculate the time until a future epoch
 * @param futureEpoch - The future epoch number
 * @param currentEpoch - The current epoch number
 * @returns Object with time until the epoch in various units
 */
export function timeUntilEpoch(
  futureEpoch: number,
  currentEpoch: number
): {
  epochs: number
  seconds: number
  minutes: number
  hours: number
  days: number
} {
  const epochDifference = futureEpoch - currentEpoch
  const seconds = epochDifference * TIME_CONSTANTS.EPOCH_DURATION

  return {
    epochs: epochDifference,
    seconds,
    minutes: seconds / 60,
    hours: seconds / 3600,
    days: seconds / 86400,
  }
}

/**
 * Calculate when the last proof should have been submitted based on current time
 * @param nextChallengeEpoch - The next challenge epoch from the data set
 * @param maxProvingPeriod - The maximum proving period in epochs
 * @param network - The Filecoin network
 * @returns Date when the last proof should have been submitted, or null if no proof submitted yet
 */
export function calculateLastProofDate(
  nextChallengeEpoch: number,
  maxProvingPeriod: number,
  network: FilecoinNetworkType
): Date | null {
  // If nextChallengeEpoch is 0, no proofs scheduled
  if (nextChallengeEpoch === 0) {
    return null
  }

  // The last proof should have been submitted before the current proving period started
  // Current proving period starts at nextChallengeEpoch - maxProvingPeriod
  const lastProofEpoch = nextChallengeEpoch - maxProvingPeriod

  // If this is negative, we're in the first proving period
  if (lastProofEpoch <= 0) {
    return null
  }

  return epochToDate(lastProofEpoch, network)
}

/**
 * Get the current epoch from the blockchain
 * @internal This is an internal utility, not part of the public API
 * @param provider - The ethers provider to query
 * @returns The current epoch as a bigint
 */
export async function getCurrentEpoch(provider: ethers.Provider): Promise<bigint> {
  const block = await provider.getBlock('latest')
  if (block == null) {
    throw createError('epoch', 'getCurrentEpoch', 'Failed to get latest block')
  }
  // In Filecoin, the block number is the epoch
  return BigInt(block.number)
}
