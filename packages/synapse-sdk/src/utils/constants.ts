/**
 * Constants for the Synapse SDK
 */

export { SIZE_CONSTANTS, TIME_CONSTANTS } from '@filoz/synapse-core/utils'

/**
 * Token identifiers
 */
export const TOKENS = {
  USDFC: 'USDFC' as const,
  FIL: 'FIL' as const,
} as const

/**
 * Common metadata keys
 */
export const METADATA_KEYS = {
  /**
   * Key used to request that CDN services should be enabled for a data set. The presence of this
   * key does not strictly guarantee that CDN services will be provided, but the Warm Storage
   * contract will attempt to enable payment for CDN services if this key is present.
   *
   * The value for this key is always an empty string.
   *
   * Only valid for *data set* metadata.
   */
  WITH_CDN: 'withCDN',

  /**
   * Key used to request that a PDP server perform IPFS indexing and announcing to IPNI should be
   * enabled for all pieces in a data set. The contents of the associated data sets are assumed to
   * be indexable (i.e. a CAR or a PoDSI container) and the PDP server will be requested to perform
   * best-effort indexing. The presence of this key does not guarantee that indexing will be
   * performed or succeed.
   *
   * The value for this key is always an empty string.
   *
   * Only valid for *data set* metadata.
   */
  WITH_IPFS_INDEXING: 'withIPFSIndexing',

  /**
   * Key used to indicate a root CID of an IPLD DAG contained within the associated piece.
   * Advisory only: do not treat as proof that the CID is valid, that IPLD blocks are present, or
   * that the referenced DAG is fully present or retrievable. Intended as a secondary identifier
   * provided by the data producer; not interpreted by contracts.
   *
   * The value for this key should be a valid CID string.
   *
   * Only valid for *piece* metadata.
   */
  IPFS_ROOT_CID: 'ipfsRootCID',
} as const

/**
 * Timing constants for blockchain operations
 */
export const TIMING_CONSTANTS = {
  /**
   * How long to wait for a transaction to appear on the network
   * This is used when we have a transaction hash but need to fetch the transaction object
   * Filecoin has 30-second epochs, so this gives six full epochs for propagation
   * Matches viem's standard timeout for transaction receipt (180s)
   */
  TRANSACTION_PROPAGATION_TIMEOUT_MS: 180000, // 180 seconds (3 minutes, 6 epochs)

  /**
   * How often to poll when waiting for a transaction to appear
   */
  TRANSACTION_PROPAGATION_POLL_INTERVAL_MS: 2000, // 2 seconds

  /**
   * Maximum time to wait for a data set creation to complete
   * This includes transaction mining and the data set becoming live on-chain
   */
  DATA_SET_CREATION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for data set creation status
   */
  DATA_SET_CREATION_POLL_INTERVAL_MS: 2000, // 2 seconds

  /**
   * Maximum time to wait for a piece to be parked (uploaded) to storage
   * This is typically slower than blockchain operations as it involves data transfer
   */
  PIECE_PARKING_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for piece parking status
   * Less frequent than blockchain polling as uploads take longer
   */
  PIECE_PARKING_POLL_INTERVAL_MS: 5000, // 5 seconds

  /**
   * Number of confirmations to wait for when calling transaction.wait()
   * Set to 1 by default to ensure the transaction is mined, could be increased
   * in the future, or aligned to F3 expectations
   */
  TRANSACTION_CONFIRMATIONS: 1,

  /**
   * Default expiry time for EIP-2612 permit signatures (in seconds)
   * Permits are time-limited approvals that expire after this duration
   */
  PERMIT_DEADLINE_DURATION: 3600, // 1 hour

  /**
   * Maximum time to wait for a piece addition to be confirmed and acknowledged
   * This includes transaction confirmation and server verification
   */
  PIECE_ADDITION_TIMEOUT_MS: 7 * 60 * 1000, // 7 minutes

  /**
   * How often to poll for piece addition status
   */
  PIECE_ADDITION_POLL_INTERVAL_MS: 1000, // 1 second
} as const
