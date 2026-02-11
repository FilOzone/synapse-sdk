/**
 * Constants for the Synapse SDK
 */

import { calibration } from '@filoz/synapse-core/chains'

export { SIZE_CONSTANTS, TIME_CONSTANTS } from '@filoz/synapse-core/utils'

export const DEFAULT_CHAIN = calibration

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
