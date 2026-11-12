/* globals describe it */

import { assert } from 'chai'
import { maxUint256 } from 'viem'
import { calibration, mainnet } from '../src/chains.ts'
import { TIME_CONSTANTS } from '../src/utils/constants.ts'
import {
  calculateLastProofDate,
  dateToEpoch,
  epochsToDays,
  epochsToHours,
  epochToDate,
  timeUntilEpoch,
} from '../src/utils/epoch.ts'

describe('Epoch Utilities', () => {
  describe('epochToDate', () => {
    it('should convert epoch 0 to genesis timestamp for mainnet', () => {
      const date = epochToDate(0n, mainnet.genesisTimestamp)
      assert.equal(date?.getTime(), mainnet.genesisTimestamp * 1000)
    })

    it('should convert epoch 0 to genesis timestamp for calibration', () => {
      const date = epochToDate(0n, calibration.genesisTimestamp)
      assert.equal(date?.getTime(), calibration.genesisTimestamp * 1000)
    })

    it('should calculate correct date for future epochs', () => {
      const date = epochToDate(TIME_CONSTANTS.EPOCHS_PER_DAY, mainnet.genesisTimestamp)
      const expectedTime = (mainnet.genesisTimestamp + 2880 * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date?.getTime(), expectedTime)
    })

    it('should handle large epoch numbers', () => {
      const date = epochToDate(1000000n, calibration.genesisTimestamp)
      const expectedTime = (calibration.genesisTimestamp + 1000000 * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date?.getTime(), expectedTime)
    })

    it('should return null for maxUint256', () => {
      assert.isNull(epochToDate(maxUint256, mainnet.genesisTimestamp))
      assert.isNull(epochToDate(maxUint256 + 1000n, mainnet.genesisTimestamp))
    })

    it('should return null when the date is out of range', () => {
      assert.isNull(epochToDate(10n ** 12n, mainnet.genesisTimestamp))
      assert.isNull(epochToDate(-(10n ** 12n), mainnet.genesisTimestamp))
    })

    it('should return the last representable date at the boundary', () => {
      const maxEpoch = (8_640_000_000_000n - BigInt(mainnet.genesisTimestamp)) / 30n
      assert.instanceOf(epochToDate(maxEpoch, mainnet.genesisTimestamp), Date)
      assert.isNull(epochToDate(maxEpoch + 1n, mainnet.genesisTimestamp))
    })
  })

  describe('dateToEpoch', () => {
    it('should convert genesis date to epoch 0 for mainnet', () => {
      const genesisDate = new Date(mainnet.genesisTimestamp * 1000)
      const epoch = dateToEpoch(genesisDate, mainnet.genesisTimestamp)
      assert.equal(epoch, 0n)
    })

    it('should convert genesis date to epoch 0 for calibration', () => {
      const genesisDate = new Date(calibration.genesisTimestamp * 1000)
      const epoch = dateToEpoch(genesisDate, calibration.genesisTimestamp)
      assert.equal(epoch, 0n)
    })

    it('should calculate correct epoch for future dates', () => {
      const futureDate = new Date((mainnet.genesisTimestamp + 3600) * 1000) // 1 hour after genesis
      const epoch = dateToEpoch(futureDate, mainnet.genesisTimestamp)
      assert.equal(epoch, 120n) // 3600 seconds / 30 seconds per epoch
    })

    it('should round down to nearest epoch', () => {
      const partialEpochDate = new Date((calibration.genesisTimestamp + 45) * 1000) // 1.5 epochs
      const epoch = dateToEpoch(partialEpochDate, calibration.genesisTimestamp)
      assert.equal(epoch, 1n) // Should round down
    })
  })

  describe('timeUntilEpoch', () => {
    it('should calculate correct time difference', () => {
      const currentEpoch = 1000n
      const futureEpoch = 1120n // 120 epochs in the future = 1 hour
      const result = timeUntilEpoch(futureEpoch, currentEpoch)

      assert.equal(result.epochs, 120n)
      assert.equal(result.seconds, 3600)
      assert.equal(result.minutes, 60)
      assert.equal(result.hours, 1)
      assert.equal(result.days, 1 / 24)
    })

    it('should handle same epoch', () => {
      const result = timeUntilEpoch(1000n, 1000n)

      assert.equal(result.epochs, 0n)
      assert.equal(result.seconds, 0)
      assert.equal(result.minutes, 0)
      assert.equal(result.hours, 0)
      assert.equal(result.days, 0)
    })

    it('should handle negative differences (past epochs)', () => {
      const result = timeUntilEpoch(1000n, 1120n)

      assert.equal(result.epochs, -120n)
      assert.equal(result.seconds, -3600)
      assert.equal(result.minutes, -60)
      assert.equal(result.hours, -1)
      assert.equal(result.days, -1 / 24)
    })
  })

  describe('epochsToHours', () => {
    it('should convert exact multiples of EPOCHS_PER_HOUR', () => {
      assert.equal(epochsToHours(0n), 0n)
      assert.equal(epochsToHours(TIME_CONSTANTS.EPOCHS_PER_HOUR), 1n)
      assert.equal(epochsToHours(240n), 2n)
      assert.equal(epochsToHours(TIME_CONSTANTS.EPOCHS_PER_DAY), 24n)
    })

    it('should floor non-exact values', () => {
      // 119 epochs is less than 1 hour
      assert.equal(epochsToHours(119n), 0n)
      // 121 epochs is 1 hour + 1 epoch
      assert.equal(epochsToHours(121n), 1n)
    })

    it('should pass maxUint256 through unchanged', () => {
      assert.equal(epochsToHours(maxUint256), maxUint256)
    })
  })

  describe('epochsToDays', () => {
    it('should convert exact multiples of EPOCHS_PER_DAY', () => {
      assert.equal(epochsToDays(0n), 0n)
      assert.equal(epochsToDays(TIME_CONSTANTS.EPOCHS_PER_DAY), 1n)
      assert.equal(epochsToDays(8640n), 3n)
      assert.equal(epochsToDays(TIME_CONSTANTS.EPOCHS_PER_MONTH), 30n)
    })

    it('should floor non-exact values', () => {
      // 2879 epochs is less than 1 day
      assert.equal(epochsToDays(2879n), 0n)
      // 2881 epochs is 1 day + 1 epoch
      assert.equal(epochsToDays(2881n), 1n)
    })

    it('should pass maxUint256 through unchanged', () => {
      assert.equal(epochsToDays(maxUint256), maxUint256)
    })
  })

  describe('calculateLastProofDate', () => {
    it('should return null when nextChallengeEpoch is 0', () => {
      const result = calculateLastProofDate(0n, 2880n, mainnet.genesisTimestamp)
      assert.isNull(result)
    })

    it('should return null when in first proving period', () => {
      const result = calculateLastProofDate(100n, 2880n, mainnet.genesisTimestamp)
      assert.isNull(result)
    })

    it('should calculate correct last proof date', () => {
      const nextChallengeEpoch = 5760n // 2 days worth of epochs
      const maxProvingPeriod = 2880n // 1 day
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, mainnet.genesisTimestamp)

      assert.isNotNull(result)
      // Last proof should be at epoch 2880 (5760 - 2880)
      const expectedDate = epochToDate(2880n, mainnet.genesisTimestamp)
      assert.equal(result?.getTime(), expectedDate?.getTime())
    })

    it('should handle edge case at proving period boundary', () => {
      const nextChallengeEpoch = 2880n
      const maxProvingPeriod = 2880n
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, mainnet.genesisTimestamp)

      // Should return null since lastProofEpoch would be 0
      assert.isNull(result)
    })
  })
})
