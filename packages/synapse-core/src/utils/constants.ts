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

/**
 * Limits mirrored from
 * [ServiceProviderRegistry.sol](https://github.com/FilOzone/filecoin-services/blob/main/service_contracts/src/ServiceProviderRegistry.sol).
 * Sync with `VERSION` in that contract (currently `1.1.0`) when upgrading.
 */
export const SERVICE_PROVIDER_REGISTRY = {
  /** Maximum UTF-8 byte length for `ServiceProviderInfo.name`. */
  MAX_NAME_LENGTH: 128,

  /** Maximum UTF-8 byte length for `ServiceProviderInfo.description`. */
  MAX_DESCRIPTION_LENGTH: 256,

  /**
   * Maximum UTF-8 byte length for the `location` capability value.
   *
   * Declared on-chain but not currently enforced in a dedicated require — the
   * stricter `MAX_CAPABILITY_VALUE_LENGTH` already covers it.
   */
  MAX_LOCATION_LENGTH: 128,

  /** Maximum UTF-8 byte length for each capability key. */
  MAX_CAPABILITY_KEY_LENGTH: 32,

  /** Maximum byte length for each capability value (raw bytes, not hex chars). */
  MAX_CAPABILITY_VALUE_LENGTH: 128,

  /** Maximum number of capability key/value pairs per product. */
  MAX_CAPABILITIES: 24,

  /**
   * Registration fee in attoFIL (5 FIL) required by `registerProvider`.
   *
   * Callers that pass `value` explicitly are validated against this value.
   * Callers that omit `value` fetch the live `REGISTRATION_FEE()` from the contract.
   */
  REGISTRATION_FEE_WEI: 5_000_000_000_000_000_000n,
} as const
