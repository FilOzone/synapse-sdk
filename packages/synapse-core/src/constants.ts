/**
 * Time and size constants
 */
export const TIME_CONSTANTS = {
  /**
   * Duration of each epoch in seconds on Filecoin
   */
  EPOCH_DURATION: 30,

  /**
   * Number of epochs in a day (24 hours * 60 minutes * 2 epochs per minute)
   */
  EPOCHS_PER_DAY: 2880n,

  /**
   * Number of epochs in a month (30 days)
   */
  EPOCHS_PER_MONTH: 86400n, // 30 * 2880

  /**
   * Number of days in a month (used for pricing calculations)
   */
  DAYS_PER_MONTH: 30n,

  /**
   * Default lockup period in days
   */
  DEFAULT_LOCKUP_DAYS: 10n,
} as const

/**
 * Data size constants
 */
export const SIZE_CONSTANTS = {
  /**
   * Bytes in 1 KiB
   */
  KiB: 1024n,

  /**
   * Bytes in 1 MiB
   */
  MiB: 1n << 20n,

  /**
   * Bytes in 1 GiB
   */
  GiB: 1n << 30n,

  /**
   * Bytes in 1 TiB
   */
  TiB: 1n << 40n,

  /**
   * Bytes in 1 PiB
   */
  PiB: 1n << 50n,

  /**
   * Maximum upload size (200 MiB)
   * Current limitation for PDP uploads
   */
  MAX_UPLOAD_SIZE: 200 * 1024 * 1024,

  /**
   * Minimum upload size (127 bytes)
   * PieceCIDv2 calculation requires at least 127 bytes payload
   */
  MIN_UPLOAD_SIZE: 127,

  /**
   * Default number of uploads to batch together in a single addPieces transaction
   * This balances gas efficiency with reasonable transaction sizes
   */
  DEFAULT_UPLOAD_BATCH_SIZE: 32,
} as const

export const LOCKUP_PERIOD = 10n * TIME_CONSTANTS.EPOCHS_PER_DAY
