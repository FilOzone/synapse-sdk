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
  DEFAULT_LOCKUP_DAYS: 30n,

  /**
   * Default expiry time for EIP-2612 permit signatures (in seconds)
   * Permits are time-limited approvals that expire after this duration
   */
  PERMIT_DEADLINE_DURATION: 3600, // 1 hour
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
   * Maximum upload size currently supported by PDP servers.
   *
   * 1 GiB adjusted for fr32 expansion: 1 GiB * (127/128) = 1,065,353,216 bytes
   *
   * Fr32 encoding adds 2 bits of padding per 254 bits of data, resulting in 128 bytes
   * of padded data for every 127 bytes of raw data.
   *
   * Note: While it's technically possible to upload pieces this large as Uint8Array,
   * streaming via AsyncIterable is strongly recommended for non-trivial sizes.
   * See SIZE_CONSTANTS.MAX_UPLOAD_SIZE in synapse-sdk for detailed guidance.
   */
  MAX_UPLOAD_SIZE: 1_065_353_216, // 1 GiB * 127/128

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

export const LOCKUP_PERIOD = TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS * TIME_CONSTANTS.EPOCHS_PER_DAY

export const RETRY_CONSTANTS = {
  RETRIES: Infinity,
  FACTOR: 1,
  DELAY_TIME: 4000, // 4 seconds in milliseconds between retries
  MAX_RETRY_TIME: 1000 * 60 * 5, // 5 minutes in milliseconds
} as const
