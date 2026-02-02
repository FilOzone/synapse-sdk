/* globals describe it */

import { assert } from 'chai'
import { calibration, mainnet } from '../src/chains.ts'
import { TIME_CONSTANTS } from '../src/utils/constants.ts'
import { calculateLastProofDate, dateToEpoch, epochToDate, timeUntilEpoch } from '../src/utils/epoch.ts'

describe('Epoch Utilities', () => {
  describe('epochToDate', () => {
    it('should convert epoch 0 to genesis timestamp for mainnet', () => {
      const date = epochToDate(0, mainnet.genesisTimestamp)
      assert.equal(date.getTime(), mainnet.genesisTimestamp * 1000)
    })

    it('should convert epoch 0 to genesis timestamp for calibration', () => {
      const date = epochToDate(0, calibration.genesisTimestamp)
      assert.equal(date.getTime(), calibration.genesisTimestamp * 1000)
    })

    it('should calculate correct date for future epochs', () => {
      const epochsPerDay = 24 * 60 * 2 // 2880 epochs per day
      const date = epochToDate(epochsPerDay, mainnet.genesisTimestamp)
      const expectedTime = (mainnet.genesisTimestamp + epochsPerDay * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date.getTime(), expectedTime)
    })

    it('should handle large epoch numbers', () => {
      const largeEpoch = 1000000
      const date = epochToDate(largeEpoch, calibration.genesisTimestamp)
      const expectedTime = (calibration.genesisTimestamp + largeEpoch * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date.getTime(), expectedTime)
    })
  })

  describe('dateToEpoch', () => {
    it('should convert genesis date to epoch 0 for mainnet', () => {
      const genesisDate = new Date(mainnet.genesisTimestamp * 1000)
      const epoch = dateToEpoch(genesisDate, mainnet.genesisTimestamp)
      assert.equal(epoch, 0)
    })

    it('should convert genesis date to epoch 0 for calibration', () => {
      const genesisDate = new Date(calibration.genesisTimestamp * 1000)
      const epoch = dateToEpoch(genesisDate, calibration.genesisTimestamp)
      assert.equal(epoch, 0)
    })

    it('should calculate correct epoch for future dates', () => {
      const futureDate = new Date((mainnet.genesisTimestamp + 3600) * 1000) // 1 hour after genesis
      const epoch = dateToEpoch(futureDate, mainnet.genesisTimestamp)
      assert.equal(epoch, 120) // 3600 seconds / 30 seconds per epoch
    })

    it('should round down to nearest epoch', () => {
      const partialEpochDate = new Date((calibration.genesisTimestamp + 45) * 1000) // 1.5 epochs
      const epoch = dateToEpoch(partialEpochDate, calibration.genesisTimestamp)
      assert.equal(epoch, 1) // Should round down
    })
  })

  describe('timeUntilEpoch', () => {
    it('should calculate correct time difference', () => {
      const currentEpoch = 1000
      const futureEpoch = 1120 // 120 epochs in the future = 1 hour
      const result = timeUntilEpoch(futureEpoch, currentEpoch)

      assert.equal(result.epochs, 120)
      assert.equal(result.seconds, 3600)
      assert.equal(result.minutes, 60)
      assert.equal(result.hours, 1)
      assert.equal(result.days, 1 / 24)
    })

    it('should handle same epoch', () => {
      const result = timeUntilEpoch(1000, 1000)

      assert.equal(result.epochs, 0)
      assert.equal(result.seconds, 0)
      assert.equal(result.minutes, 0)
      assert.equal(result.hours, 0)
      assert.equal(result.days, 0)
    })

    it('should handle negative differences (past epochs)', () => {
      const result = timeUntilEpoch(1000, 1120)

      assert.equal(result.epochs, -120)
      assert.equal(result.seconds, -3600)
      assert.equal(result.minutes, -60)
      assert.equal(result.hours, -1)
      assert.equal(result.days, -1 / 24)
    })
  })

  describe('calculateLastProofDate', () => {
    it('should return null when nextChallengeEpoch is 0', () => {
      const result = calculateLastProofDate(0, 2880, mainnet.genesisTimestamp)
      assert.isNull(result)
    })

    it('should return null when in first proving period', () => {
      const result = calculateLastProofDate(100, 2880, mainnet.genesisTimestamp)
      assert.isNull(result)
    })

    it('should calculate correct last proof date', () => {
      const nextChallengeEpoch = 5760 // 2 days worth of epochs
      const maxProvingPeriod = 2880 // 1 day
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, mainnet.genesisTimestamp)

      assert.isNotNull(result)
      // Last proof should be at epoch 2880 (5760 - 2880)
      const expectedDate = epochToDate(2880, mainnet.genesisTimestamp)
      assert.equal(result?.getTime(), expectedDate.getTime())
    })

    it('should handle edge case at proving period boundary', () => {
      const nextChallengeEpoch = 2880
      const maxProvingPeriod = 2880
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, mainnet.genesisTimestamp)

      // Should return null since lastProofEpoch would be 0
      assert.isNull(result)
    })
  })
})
