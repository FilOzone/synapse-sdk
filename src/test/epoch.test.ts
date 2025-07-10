/* globals describe it */
import { assert } from 'chai'
import {
  epochToDate,
  dateToEpoch,
  getGenesisTimestamp,
  timeUntilEpoch,
  calculateLastProofDate
} from '../utils/epoch.js'
import { GENESIS_TIMESTAMPS, TIME_CONSTANTS } from '../utils/constants.js'

describe('Epoch Utilities', () => {
  describe('epochToDate', () => {
    it('should convert epoch 0 to genesis timestamp for mainnet', () => {
      const date = epochToDate(0, 'mainnet')
      assert.equal(date.getTime(), GENESIS_TIMESTAMPS.mainnet * 1000)
    })

    it('should convert epoch 0 to genesis timestamp for calibration', () => {
      const date = epochToDate(0, 'calibration')
      assert.equal(date.getTime(), GENESIS_TIMESTAMPS.calibration * 1000)
    })

    it('should calculate correct date for future epochs', () => {
      const epochsPerDay = 24 * 60 * 2 // 2880 epochs per day
      const date = epochToDate(epochsPerDay, 'mainnet')
      const expectedTime = (GENESIS_TIMESTAMPS.mainnet + epochsPerDay * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date.getTime(), expectedTime)
    })

    it('should handle large epoch numbers', () => {
      const largeEpoch = 1000000
      const date = epochToDate(largeEpoch, 'calibration')
      const expectedTime = (GENESIS_TIMESTAMPS.calibration + largeEpoch * TIME_CONSTANTS.EPOCH_DURATION) * 1000
      assert.equal(date.getTime(), expectedTime)
    })
  })

  describe('dateToEpoch', () => {
    it('should convert genesis date to epoch 0 for mainnet', () => {
      const genesisDate = new Date(GENESIS_TIMESTAMPS.mainnet * 1000)
      const epoch = dateToEpoch(genesisDate, 'mainnet')
      assert.equal(epoch, 0)
    })

    it('should convert genesis date to epoch 0 for calibration', () => {
      const genesisDate = new Date(GENESIS_TIMESTAMPS.calibration * 1000)
      const epoch = dateToEpoch(genesisDate, 'calibration')
      assert.equal(epoch, 0)
    })

    it('should calculate correct epoch for future dates', () => {
      const futureDate = new Date((GENESIS_TIMESTAMPS.mainnet + 3600) * 1000) // 1 hour after genesis
      const epoch = dateToEpoch(futureDate, 'mainnet')
      assert.equal(epoch, 120) // 3600 seconds / 30 seconds per epoch
    })

    it('should round down to nearest epoch', () => {
      const partialEpochDate = new Date((GENESIS_TIMESTAMPS.calibration + 45) * 1000) // 1.5 epochs
      const epoch = dateToEpoch(partialEpochDate, 'calibration')
      assert.equal(epoch, 1) // Should round down
    })
  })

  describe('getGenesisTimestamp', () => {
    it('should return correct timestamp for mainnet', () => {
      const timestamp = getGenesisTimestamp('mainnet')
      assert.equal(timestamp, GENESIS_TIMESTAMPS.mainnet)
    })

    it('should return correct timestamp for calibration', () => {
      const timestamp = getGenesisTimestamp('calibration')
      assert.equal(timestamp, GENESIS_TIMESTAMPS.calibration)
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
      const result = calculateLastProofDate(0, 2880, 'mainnet')
      assert.isNull(result)
    })

    it('should return null when in first proving period', () => {
      const result = calculateLastProofDate(100, 2880, 'mainnet')
      assert.isNull(result)
    })

    it('should calculate correct last proof date', () => {
      const nextChallengeEpoch = 5760 // 2 days worth of epochs
      const maxProvingPeriod = 2880 // 1 day
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, 'mainnet')

      assert.isNotNull(result)
      // Last proof should be at epoch 2880 (5760 - 2880)
      const expectedDate = epochToDate(2880, 'mainnet')
      assert.equal(result?.getTime(), expectedDate.getTime())
    })

    it('should handle edge case at proving period boundary', () => {
      const nextChallengeEpoch = 2880
      const maxProvingPeriod = 2880
      const result = calculateLastProofDate(nextChallengeEpoch, maxProvingPeriod, 'mainnet')

      // Should return null since lastProofEpoch would be 0
      assert.isNull(result)
    })
  })
})
