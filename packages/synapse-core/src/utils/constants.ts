/**
 * Time and size constants
 */
export const TIME_CONSTANTS = {
  /**
   * Duration of each epoch in seconds on Filecoin
   */
  EPOCH_DURATION: 30,

  /**
   * Number of epochs in an hour (60 minutes * 2 epochs per minute)
   */
  EPOCHS_PER_HOUR: 120n,

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

  /**
   * Bytes per leaf in the PDP merkle tree.
   * The FWSS contract converts leaf counts to bytes via `totalBytes = leafCount * BYTES_PER_LEAF`.
   */
  BYTES_PER_LEAF: 32n,
} as const

export const LOCKUP_PERIOD = TIME_CONSTANTS.DEFAULT_LOCKUP_DAYS * TIME_CONSTANTS.EPOCHS_PER_DAY

/**
 * Default safety margin in epochs when calculating deposit amounts.
 * Accounts for epoch drift between balance check and on-chain execution.
 */
export const DEFAULT_BUFFER_EPOCHS = 5n

/**
 * Default extra runway in epochs beyond the required lockup.
 * 0n means no additional runway beyond the lockup period.
 */
export const DEFAULT_RUNWAY_EPOCHS = 0n

/**
 * CDN fixed lockup amounts charged at dataset creation time.
 * These are one-time lockups for CDN egress and cache miss egress rails.
 */
export const CDN_FIXED_LOCKUP = {
  /** CDN egress rail fixed lockup: 0.7 USDFC */
  cdn: 700_000_000_000_000_000n,
  /** Cache miss egress rail fixed lockup: 0.3 USDFC */
  cacheMiss: 300_000_000_000_000_000n,
  /** Total: 1.0 USDFC */
  total: 1_000_000_000_000_000_000n,
} as const

/**
 * USDFC sybil fee charged on new dataset creation.
 * Extracted from client funds into the payments auction pool to prevent state-growth spam.
 * Matches PDPVerifier.USDFC_SYBIL_FEE (immutable, only changes with contract upgrade).
 */
export const USDFC_SYBIL_FEE = 100_000_000_000_000_000n // 0.1 USDFC

export const RETRY_CONSTANTS = {
  RETRIES: Infinity,
  FACTOR: 1,
  DELAY_TIME: 4000, // 4 seconds in milliseconds between retries
  MAX_RETRY_TIME: 1000 * 60 * 5, // 5 minutes in milliseconds
} as const
